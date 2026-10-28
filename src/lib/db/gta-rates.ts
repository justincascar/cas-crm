import type { DatabaseSync } from "node:sqlite";
import { londonTodayIso, nowUtcIso } from "../dates";
import {
  GTA_MARKUP_PERCENT_DEFAULT,
  GTA_RATE_EFFECTIVE_FROM,
  GTA_RATE_PERIOD_LABEL,
  GTA_REFERENCE_RATES_PENCE,
  standardDailyRatePence,
} from "../documents/gta";
import { all, get, getDb, newId, run } from "./connection";

/** The uplift % in Settings (key gta_markup_percent). Read here to avoid a loop with hire-agreement. */
function upliftPercent(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = 'gta_markup_percent'`);
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 0 && n <= 500 ? n : GTA_MARKUP_PERCENT_DEFAULT;
}

/**
 * GTA tables kept in Settings. Each has the date it applies from and where the figures came from.
 * A hire stores the rate it was given, so adding a new table never changes an existing hire.
 * Figures are typed from the published table. None are invented here.
 */

export const SUPPLIED_GTA_SOURCE = `Supplied GTA table for hires from ${GTA_RATE_PERIOD_LABEL} (ceilings excluding VAT). Copied into Settings from the figures already in the CRM on 28/10/2026.`;

export type GtaTable = {
  id: string;
  effectiveFrom: string;
  source: string;
  rates: Record<string, number>;
  createdAt: string;
  createdByName: string | null;
};

/** Creates the table and copies the supplied 2026–27 figures once, when Settings has no GTA table yet. */
export function ensureGtaTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gta_rate_tables (
      id TEXT PRIMARY KEY,
      effective_from TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      rates_json TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const any = db.prepare(`SELECT id FROM gta_rate_tables LIMIT 1`).get();
  if (any) return;
  db.prepare(`INSERT INTO gta_rate_tables(id, effective_from, source, rates_json, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?)`).run(
    "gta-2026-07-01",
    GTA_RATE_EFFECTIVE_FROM,
    SUPPLIED_GTA_SOURCE,
    JSON.stringify(GTA_REFERENCE_RATES_PENCE),
    nowUtcIso(),
  );
}

type Row = { id: string; effective_from: string; source: string; rates_json: string; created_at: string; name: string | null };

function toTable(row: Row): GtaTable {
  return {
    id: String(row.id),
    effectiveFrom: String(row.effective_from),
    source: String(row.source),
    rates: JSON.parse(String(row.rates_json)) as Record<string, number>,
    createdAt: String(row.created_at),
    createdByName: row.name ? String(row.name) : null,
  };
}

export function listGtaTables(): GtaTable[] {
  ensureGtaTables(getDb());
  return all<Row>(
    `SELECT t.id, t.effective_from, t.source, t.rates_json, t.created_at, s.name
     FROM gta_rate_tables t LEFT JOIN staff s ON s.id = t.created_by
     ORDER BY t.effective_from DESC`,
  ).map(toTable);
}

/** The table in force on that London day: the latest one that applies from on or before it. */
export function gtaTableFor(day = londonTodayIso()): GtaTable | null {
  ensureGtaTables(getDb());
  const row = get<Row>(
    `SELECT t.id, t.effective_from, t.source, t.rates_json, t.created_at, s.name
     FROM gta_rate_tables t LEFT JOIN staff s ON s.id = t.created_by
     WHERE t.effective_from <= ? ORDER BY t.effective_from DESC LIMIT 1`,
    [day],
  );
  return row ? toTable(row) : null;
}

/** A group code that is in the table in force. Anything else is not a group. */
export function settingsGtaGroup(value: string | null | undefined, day = londonTodayIso()): string | null {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return null;
  return gtaTableFor(day)?.rates[code] != null ? code : null;
}

export function settingsGtaGroups(day = londonTodayIso()): string[] {
  return Object.keys(gtaTableFor(day)?.rates || {});
}

/** GTA ceiling for the group from the table in force, plus the uplift % in Settings. Null when either is missing. */
export function settingsDailyRatePence(group: string | null | undefined, day = londonTodayIso()): number | null {
  const table = gtaTableFor(day);
  if (!table) return null;
  return standardDailyRatePence(group, upliftPercent(), table.rates);
}

/**
 * Lines such as "S1 42.32" or "S1, 42.32", one group per line, in pounds excluding VAT.
 * Refuses anything it cannot read rather than guessing.
 */
export function parseGtaFigures(text: string): Record<string, number> {
  const rates: Record<string, number> = {};
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = /^([A-Za-z]{1,2}\d{0,2})[\s,:;\t]+£?\s*(\d+(?:\.\d{1,2})?)$/.exec(line);
    if (!match) throw new Error(`This line could not be read: "${line}". Use a group and a figure in pounds, for example S1 42.32.`);
    const code = match[1].toUpperCase();
    if (rates[code] != null) throw new Error(`Group ${code} is listed twice.`);
    const pence = Math.round(Number(match[2]) * 100);
    if (!(pence > 0)) throw new Error(`Group ${code} needs a figure above £0.`);
    rates[code] = pence;
  }
  if (Object.keys(rates).length === 0) throw new Error("Type the figures from the published table, one group per line.");
  return rates;
}

export function saveGtaTable(input: { effectiveFrom: string; source: string; figures: string; actorId: string }): GtaTable {
  const effectiveFrom = input.effectiveFrom.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error("Enter the date the table applies from.");
  const source = input.source.trim();
  if (!source) throw new Error("Say where the figures came from, for example the published GTA table and its date.");
  if (source.length > 500) throw new Error("Keep the source short.");
  const rates = parseGtaFigures(input.figures);
  const clash = get<{ id: string }>(`SELECT id FROM gta_rate_tables WHERE effective_from = ?`, [effectiveFrom]);
  if (clash) throw new Error("A GTA table already applies from that date. Tables are kept as they were entered.");
  const id = newId("gta");
  run(`INSERT INTO gta_rate_tables(id, effective_from, source, rates_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    id,
    effectiveFrom,
    source,
    JSON.stringify(rates),
    input.actorId,
    nowUtcIso(),
  ]);
  return listGtaTables().find((table) => table.id === id)!;
}

import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, londonDateIso, londonTodayIso, nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";

/** The dated facts that show whether storage was needed, and for how long. */
export const STORAGE_CHRONOLOGY_KINDS = [
  { value: "inspection_access", label: "Inspection access" },
  { value: "repair_authorised", label: "Repair authorised" },
  { value: "total_loss_decision", label: "Total-loss decision" },
  { value: "uplift_request", label: "Uplift request" },
  { value: "salvage_instruction", label: "Salvage instructions" },
  { value: "earliest_move", label: "Earliest date the car could reasonably have been moved" },
] as const;
export type StorageChronologyKind = (typeof STORAGE_CHRONOLOGY_KINDS)[number]["value"];

export type StorageChronologyEntry = {
  id: string;
  kind: StorageChronologyKind;
  label: string;
  occurredOn: string;
  note: string;
  source: "entered" | "file";
};

export function ensureStorageChronology(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_chronology (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      note TEXT,
      recorded_by TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_storage_chronology_claim ON storage_chronology(claim_id, occurred_on);
  `);
}

function labelFor(kind: string): string {
  return STORAGE_CHRONOLOGY_KINDS.find((item) => item.value === kind)?.label || kind;
}

export function addStorageChronologyEntry(input: { claimId: string; actorId: string; kind: string; occurredOn: string; note: string }) {
  const kind = STORAGE_CHRONOLOGY_KINDS.find((item) => item.value === input.kind.trim());
  if (!kind) throw new Error("Choose what happened.");
  const day = input.occurredOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Enter the date.");
  if (day > londonTodayIso()) throw new Error("The date cannot be in the future.");
  const note = input.note.trim();
  if (kind.value === "earliest_move" && !note) throw new Error("Say why the car could have been moved from that date.");
  run(
    `INSERT INTO storage_chronology(id, claim_id, kind, occurred_on, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("stc"), input.claimId, kind.value, day, note || null, input.actorId, nowUtcIso()],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_chronology_entry",
    occurredAt: `${day}T12:00:00.000Z`,
    actorId: input.actorId,
    details: `${kind.label}: ${formatUkDate(day)}.${note ? ` ${note}` : ""}`,
    source: "staff",
  });
}

/**
 * Entries typed by staff, with the matching dates already on the file (repair authorised, salvage collected) added so the chronology reads in one place. Oldest first.
 */
export function listStorageChronology(claimId: string): StorageChronologyEntry[] {
  const entered = all<{ id: string; kind: string; occurred_on: string; note: string | null }>(
    `SELECT id, kind, occurred_on, note FROM storage_chronology WHERE claim_id = ? ORDER BY occurred_on, recorded_at`,
    [claimId],
  ).map((row) => ({
    id: row.id,
    kind: row.kind as StorageChronologyKind,
    label: labelFor(row.kind),
    occurredOn: row.occurred_on,
    note: String(row.note || ""),
    source: "entered" as const,
  }));
  const fromFile = all<{ id: string; event_type: string; occurred_at: string }>(
    `SELECT id, event_type, occurred_at FROM claim_events
     WHERE claim_id = ? AND event_type IN ('repairs_authorised', 'salvage_collected')
     ORDER BY occurred_at`,
    [claimId],
  ).map((row) => {
    const kind: StorageChronologyKind = row.event_type === "repairs_authorised" ? "repair_authorised" : "salvage_instruction";
    return {
      id: row.id,
      kind,
      label: row.event_type === "salvage_collected" ? "Salvage collected" : labelFor(kind),
      occurredOn: londonDateIso(new Date(row.occurred_at)),
      note: "From the file history.",
      source: "file" as const,
    };
  });
  return [...entered, ...fromFile].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
}

/** The latest typed earliest-move date, used for the proposed storage end. */
export function earliestMoveDayFor(claimId: string): string | null {
  try {
    const row = get<{ occurred_on: string }>(
      `SELECT occurred_on FROM storage_chronology WHERE claim_id = ? AND kind = 'earliest_move' ORDER BY recorded_at DESC LIMIT 1`,
      [claimId],
    );
    return row?.occurred_on || null;
  } catch {
    return null;
  }
}

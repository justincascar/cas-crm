import type { DatabaseSync } from "node:sqlite";
import { EXPORT_AND_AUDIT } from "../auth/roles";
import { formatUkDateTime, nowUtcIso, requireLondonDateTime } from "../dates";
import { all, get, getDb, newId, run } from "./connection";
import { listStaffPermissions } from "./permissions";

/**
 * Breach log (J15). Justin records a suspected personal data breach: when it was discovered, what happened, whose
 * data, the decision on whether to report it to the ICO, and the actions taken. A report to the ICO is due within
 * 72 hours of discovery, so a clock shows until a decision is recorded. The CRM does not decide; it records.
 */

export const ICO_HOURS = 72;

export const ICO_DECISIONS = [
  { value: "undecided", label: "Not decided yet" },
  { value: "report", label: "Report to the ICO" },
  { value: "reported", label: "Reported to the ICO" },
  { value: "not_report", label: "Not reportable (reason recorded)" },
] as const;

export function ensureBreachTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS breaches (
      id TEXT PRIMARY KEY,
      discovered_at TEXT NOT NULL,
      what_happened TEXT NOT NULL,
      whose_data TEXT NOT NULL,
      ico_decision TEXT NOT NULL DEFAULT 'undecided',
      decision_reason TEXT,
      decided_at TEXT,
      actions TEXT,
      recorded_by TEXT,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function ready() {
  ensureBreachTable(getDb());
}

export function canUseBreachLog(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(EXPORT_AND_AUDIT);
}

function guard(staffId: string) {
  if (!canUseBreachLog(staffId)) throw new Error("Only Justin can use the breach log.");
}

function required(value: string, what: string): string {
  const text = value.trim();
  if (!text) throw new Error(`Enter ${what}.`);
  return text.slice(0, 4000);
}

export function recordBreach(input: { actorId: string; discoveredAt: string; whatHappened: string; whoseData: string; actions: string }): string {
  ready();
  guard(input.actorId);
  const discovered = requireLondonDateTime(String(input.discoveredAt || "").trim());
  if (discovered > nowUtcIso()) throw new Error("The discovery time cannot be in the future.");
  const id = newId("breach");
  const now = nowUtcIso();
  run(
    `INSERT INTO breaches(id, discovered_at, what_happened, whose_data, actions, recorded_by, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, discovered, required(input.whatHappened, "what happened"), required(input.whoseData, "whose data was involved"), input.actions.trim().slice(0, 4000) || null, input.actorId, now, now],
  );
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'breach_recorded', 'breach', ?, ?)`, [
    newId("audit"),
    now,
    input.actorId,
    id,
    `Suspected breach recorded, discovered ${formatUkDateTime(discovered)}`,
  ]);
  return id;
}

export function updateBreach(input: { actorId: string; breachId: string; decision: string; reason: string; actions: string }) {
  ready();
  guard(input.actorId);
  if (!ICO_DECISIONS.some((item) => item.value === input.decision)) throw new Error("Choose the decision.");
  if (input.decision === "not_report" && !input.reason.trim()) throw new Error("Record why it is not reportable.");
  const now = nowUtcIso();
  run(
    `UPDATE breaches SET ico_decision = ?, decision_reason = ?, decided_at = CASE WHEN ? = 'undecided' THEN NULL ELSE COALESCE(decided_at, ?) END, actions = ?, updated_at = ? WHERE id = ?`,
    [input.decision, input.reason.trim().slice(0, 2000) || null, input.decision, now, input.actions.trim().slice(0, 4000) || null, now, input.breachId],
  );
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'breach_updated', 'breach', ?, ?)`, [
    newId("audit"),
    now,
    input.actorId,
    input.breachId,
    `Decision: ${ICO_DECISIONS.find((item) => item.value === input.decision)?.label}`,
  ]);
}

export type BreachView = {
  id: string;
  discoveredAt: string;
  whatHappened: string;
  whoseData: string;
  decision: string;
  decisionLabel: string;
  reason: string;
  actions: string;
  deadline: string;
  /** "Report by 02/11/2026 14:00 · 31 hours left", or the decision once made. */
  clock: string;
  overdue: boolean;
};

export function listBreaches(actorId: string, nowMs = Date.now()): BreachView[] {
  ready();
  guard(actorId);
  return all<{ id: string; discovered_at: string; what_happened: string; whose_data: string; ico_decision: string; decision_reason: string | null; actions: string | null }>(
    `SELECT id, discovered_at, what_happened, whose_data, ico_decision, decision_reason, actions FROM breaches ORDER BY discovered_at DESC`,
  ).map((row) => {
    const deadlineMs = new Date(row.discovered_at).getTime() + ICO_HOURS * 3_600_000;
    const deadline = new Date(deadlineMs).toISOString();
    const undecided = row.ico_decision === "undecided" || row.ico_decision === "report";
    const hours = Math.floor((deadlineMs - nowMs) / 3_600_000);
    const label = ICO_DECISIONS.find((item) => item.value === row.ico_decision)?.label || row.ico_decision;
    return {
      id: String(row.id),
      discoveredAt: String(row.discovered_at),
      whatHappened: String(row.what_happened),
      whoseData: String(row.whose_data),
      decision: String(row.ico_decision),
      decisionLabel: label,
      reason: String(row.decision_reason || ""),
      actions: String(row.actions || ""),
      deadline,
      clock: undecided
        ? hours >= 0
          ? `Report to the ICO by ${formatUkDateTime(deadline)} · ${hours} hour${hours === 1 ? "" : "s"} left`
          : `The 72 hours ended ${formatUkDateTime(deadline)} · ${-hours} hour${hours === -1 ? "" : "s"} over`
        : label,
      overdue: undecided && hours < 0,
    };
  });
}

export function openBreachCount(): number {
  ready();
  return Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM breaches WHERE ico_decision IN ('undecided', 'report')`)?.n || 0);
}

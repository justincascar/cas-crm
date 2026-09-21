import type { DatabaseSync } from "node:sqlite";
import {
  ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT,
  ENGINEER_INSTRUCTION_CHASE_RULE,
  ENGINEER_REPORT_CHASE_DUE_LABEL,
  ENGINEER_REPORT_CHASE_TEMPLATE,
  SETTING_ENGINEER_CHASE_INTERVAL_DAYS,
} from "../constants";
import { addCalendarDaysIso, nowUtcIso } from "../dates";
import {
  engineerInstructionChaseDecision,
  laterIso,
  parseChaseIntervalDays,
  type EngineerChaseDecision,
  type EngineerChaseHandlerState,
} from "../domain/engineer-chase";
import { SEEDED_ENGINEER } from "./engineers";
import { get, run, all, newId } from "./connection";

export type EngineerChaseView = EngineerChaseDecision & {
  claimId: string;
  fileReference?: string;
  clientName?: string | null;
  handlerName?: string | null;
  engineerName: string;
  engineerEmail: string;
  frozenIntervalDays: number;
};

function handlerStateFromRow(row: { status: string; paused: number } | undefined): EngineerChaseHandlerState {
  if (!row) return "tracking";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "paused" || Number(row.paused) === 1) return "paused";
  return "tracking";
}

export function ensureEngineerChaseIntervalSetting(db: DatabaseSync) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTING_ENGINEER_CHASE_INTERVAL_DAYS) as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(
      SETTING_ENGINEER_CHASE_INTERVAL_DAYS,
      String(ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT),
    );
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_claim_rule
    ON automations(claim_id, rule_key);
  `);
}

export function getEngineerChaseIntervalDays(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_ENGINEER_CHASE_INTERVAL_DAYS]);
  return parseChaseIntervalDays(row?.value, ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT);
}

export function setEngineerChaseIntervalDays(value: string | number) {
  const days = parseChaseIntervalDays(value, 0);
  if (days < 1) throw new Error("Enter the chase interval as a whole number of days, at least 1.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [SETTING_ENGINEER_CHASE_INTERVAL_DAYS]);
  if (existing) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [String(days), SETTING_ENGINEER_CHASE_INTERVAL_DAYS]);
  } else {
    run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_ENGINEER_CHASE_INTERVAL_DAYS, String(days)]);
  }
}

export function latestIsoForEvent(claimId: string, eventType: string): string | null {
  const row = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1`,
    [claimId, eventType],
  );
  return row?.occurred_at ? String(row.occurred_at) : null;
}

function latestMarkedSentAt(claimId: string, templateKey: string): string | null {
  const correspondence = get<{ created_at: string }>(
    `SELECT created_at FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = 'handler_marked_sent'
     ORDER BY created_at DESC LIMIT 1`,
    [claimId, templateKey],
  );
  return correspondence?.created_at ? String(correspondence.created_at) : null;
}

function chaseRow(claimId: string) {
  return get<{
    id: string;
    status: string;
    paused: number;
    interval_days: number;
    reason: string | null;
  }>(
    `SELECT id, status, paused, interval_days, reason FROM automations WHERE claim_id = ? AND rule_key = ?`,
    [claimId, ENGINEER_INSTRUCTION_CHASE_RULE],
  );
}

export function instructionMarkedSentAt(claimId: string): string | null {
  return laterIso(latestMarkedSentAt(claimId, "engineer_instruction"), latestIsoForEvent(claimId, "engineer_instructed"));
}

function lastChaserMarkedSentAt(claimId: string): string | null {
  return laterIso(
    latestMarkedSentAt(claimId, ENGINEER_REPORT_CHASE_TEMPLATE),
    latestIsoForEvent(claimId, "engineer_report_chase_sent"),
  );
}

function engineerForClaim(claimId: string): { name: string; email: string } {
  const row = get<{ name: string | null; email: string | null }>(
    `SELECT e.name, e.email FROM claims c LEFT JOIN engineers e ON e.id = c.engineer_id WHERE c.id = ?`,
    [claimId],
  );
  const name = String(row?.name || "").trim();
  const email = String(row?.email || "").trim();
  if (name && email) return { name, email };
  return { name: SEEDED_ENGINEER.name, email: SEEDED_ENGINEER.email };
}

export function engineerChaseForClaim(claimId: string, asAt: string = nowUtcIso()): EngineerChaseView | null {
  const row = chaseRow(claimId);
  if (!row) return null;
  const instructedAt = instructionMarkedSentAt(claimId);
  const handlerState = handlerStateFromRow(row);
  const trackingInterval = getEngineerChaseIntervalDays();
  const frozenIntervalDays = parseChaseIntervalDays(row?.interval_days, trackingInterval);
  const intervalDays = handlerState === "tracking" ? trackingInterval : frozenIntervalDays;
  const decision = engineerInstructionChaseDecision({
    instructionMarkedSentAt: instructedAt,
    lastChaserMarkedSentAt: lastChaserMarkedSentAt(claimId),
    latestReportReceivedAt: latestIsoForEvent(claimId, "engineer_report_received"),
    latestReportClearedAt: latestIsoForEvent(claimId, "engineer_report_received_cleared"),
    handlerState,
    intervalDays,
    asAt,
  });
  const engineer = engineerForClaim(claimId);
  return {
    ...decision,
    claimId,
    engineerName: engineer.name,
    engineerEmail: engineer.email,
    frozenIntervalDays,
  };
}

export function listDueEngineerInstructionChases(asAt: string = nowUtcIso()): EngineerChaseView[] {
  const rows = all<{
    claim_id: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
  }>(
    `SELECT a.claim_id, c.file_reference, p.full_name AS client_name, s.name AS handler_name
     FROM automations a
     JOIN claims c ON c.id = a.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE a.rule_key = ?`,
    [ENGINEER_INSTRUCTION_CHASE_RULE],
  );
  const due: EngineerChaseView[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.claim_id)) continue;
    seen.add(row.claim_id);
    const view = engineerChaseForClaim(row.claim_id, asAt);
    if (!view?.due) continue;
    due.push({
      ...view,
      fileReference: row.file_reference,
      clientName: row.client_name,
      handlerName: row.handler_name,
    });
  }
  return due;
}

export function startEngineerInstructionChase(claimId: string, clockAt: string) {
  const interval = getEngineerChaseIntervalDays();
  const nextRun = addCalendarDaysIso(clockAt, interval);
  const existing = chaseRow(claimId);
  if (existing) {
    run(
      `UPDATE automations SET next_run_at = ?, interval_days = ?, interval_unit = 'calendar_days', paused = 0,
              last_outcome = 'instruction_marked_sent', reason = ?, status = 'tracking' WHERE id = ?`,
      [nextRun, interval, "Waiting for the engineer's report. Reminder only — not auto-sent.", existing.id],
    );
    return existing.id;
  }
  const id = newId("auto");
  run(
    `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, last_outcome, reason, status)
     VALUES (?, ?, ?, 'engineer_instruction', ?, ?, 'calendar_days', 0, 'instruction_marked_sent', ?, 'tracking')`,
    [
      id,
      claimId,
      ENGINEER_INSTRUCTION_CHASE_RULE,
      nextRun,
      interval,
      "Waiting for the engineer's report. Reminder only — not auto-sent.",
    ],
  );
  return id;
}

export function restartEngineerInstructionChaseClock(claimId: string, clockAt: string) {
  const interval = getEngineerChaseIntervalDays();
  const existing = chaseRow(claimId);
  if (!existing) {
    startEngineerInstructionChase(claimId, clockAt);
    return;
  }
  if (existing.status === "cancelled" || existing.status === "paused" || Number(existing.paused) === 1) {
    return;
  }
  run(
    `UPDATE automations SET next_run_at = ?, interval_days = ?, last_outcome = 'chase_marked_sent', reason = ? WHERE id = ?`,
    [
      addCalendarDaysIso(clockAt, interval),
      interval,
      "Chaser marked as sent. Interval restarted. Reminder only — not auto-sent.",
      existing.id,
    ],
  );
}

function requireChaseRow(claimId: string) {
  const row = chaseRow(claimId);
  if (!row) throw new Error("There is no engineer-report chase on this file yet. Instruct the engineer and mark it as sent first.");
  return row;
}

export function pauseEngineerInstructionChase(claimId: string) {
  const row = requireChaseRow(claimId);
  if (row.status === "cancelled") throw new Error("This chase has been cancelled.");
  run(
    `UPDATE automations SET paused = 1, status = 'paused', last_outcome = 'paused', reason = ? WHERE id = ?`,
    ["Handler pause — do not show as due. Reminder only — not auto-sent.", row.id],
  );
}

export function resumeEngineerInstructionChase(claimId: string) {
  const row = requireChaseRow(claimId);
  if (row.status === "cancelled") throw new Error("This chase has been cancelled. Instruct the engineer again to start a new chase.");
  const interval = getEngineerChaseIntervalDays();
  const clock = chaseClockAtForClaim(claimId);
  run(
    `UPDATE automations SET paused = 0, status = 'tracking', interval_days = ?, next_run_at = ?, last_outcome = 'resumed', reason = ? WHERE id = ?`,
    [
      interval,
      clock ? addCalendarDaysIso(clock, interval) : null,
      "Chase resumed. Interval follows the current Settings value.",
      row.id,
    ],
  );
}

export function cancelEngineerInstructionChase(claimId: string) {
  const row = requireChaseRow(claimId);
  run(
    `UPDATE automations SET paused = 1, status = 'cancelled', last_outcome = 'cancelled', reason = ? WHERE id = ?`,
    ["Handler cancelled this chase. It will not show as due unless the engineer is instructed again.", row.id],
  );
}

function chaseClockAtForClaim(claimId: string): string | null {
  const instructed = instructionMarkedSentAt(claimId);
  if (!instructed) return null;
  const chased = lastChaserMarkedSentAt(claimId);
  if (chased && chased >= instructed) return chased;
  return instructed;
}

export function countEngineerInstructionChaseRows(claimId: string): number {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM automations WHERE claim_id = ? AND rule_key = ?`,
    [claimId, ENGINEER_INSTRUCTION_CHASE_RULE],
  );
  return Number(row?.c || 0);
}

export function findPreparedEngineerReportChase(claimId: string) {
  return get<{
    id: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    sent_status: string | null;
    created_at: string;
  }>(
    `SELECT id, subject, to_address, body, sent_status, created_at
     FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = 'prepared_not_sent'
     ORDER BY created_at DESC
     LIMIT 1`,
    [claimId, ENGINEER_REPORT_CHASE_TEMPLATE],
  );
}

/** Live database: put TEST-0005 on the chase so staff can see a due reminder without reseeding. */
export function ensureDemoEngineerInstructionChase(db: DatabaseSync) {
  const claim = db.prepare(`SELECT id, engineer_id FROM claims WHERE id = 'c5'`).get() as
    | { id: string; engineer_id: string | null }
    | undefined;
  if (!claim) return;
  const andy = db.prepare(`SELECT id FROM engineers WHERE id = ?`).get(SEEDED_ENGINEER.id) as { id: string } | undefined;
  if (andy && !claim.engineer_id) {
    db.prepare(`UPDATE claims SET engineer_id = ? WHERE id = 'c5'`).run(SEEDED_ENGINEER.id);
  }
  const existing = db
    .prepare(`SELECT id FROM automations WHERE claim_id = 'c5' AND rule_key = ?`)
    .get(ENGINEER_INSTRUCTION_CHASE_RULE) as { id: string } | undefined;
  if (existing) return;
  const interval = ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT;
  const instructed = db
    .prepare(
      `SELECT occurred_at FROM claim_events WHERE claim_id = 'c5' AND event_type = 'engineer_instructed' ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get() as { occurred_at: string } | undefined;
  const clock = instructed?.occurred_at || nowUtcIso();
  db.prepare(
    `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, last_outcome, reason, status)
     VALUES (?, 'c5', ?, 'engineer_instruction', ?, ?, 'calendar_days', 0, 'instruction_marked_sent', ?, 'tracking')`,
  ).run(
    "auto-c5-eng-chase",
    ENGINEER_INSTRUCTION_CHASE_RULE,
    addCalendarDaysIso(clock, interval),
    interval,
    "Waiting for the engineer's report. Reminder only — not auto-sent.",
  );
}

export { ENGINEER_REPORT_CHASE_DUE_LABEL };

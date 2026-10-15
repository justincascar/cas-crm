import type { DatabaseSync } from "node:sqlite";
import { isMechanicRole, isOfficeRole } from "../auth/roles";
import { formatUkDate, nowUtcIso, utcFromLondonDateTime } from "../dates";
import { eventLabel } from "../domain/events";
import {
  REPAIR_PROGRESS_GAP_DAYS_DEFAULT,
  REPAIR_PROGRESS_GAP_DAYS_PREVIOUS_DEFAULT,
  REPAIR_PROGRESS_GAP_SETTING,
  STRUCTURED_REPAIR_RECORD_TYPES,
  gapFlagWording,
  isInspectionRepairStep,
  isOnceOnlyRepairStep,
  isWorkshopRepairStep,
  repairProgressGaps,
  type RepairGapExplanation,
  type RepairProgressEvent,
  type RepairProgressGap,
} from "../domain/repair-progress";
import { all, get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";

const RECORDABLE = new Set<string>([
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repairs_started",
  "repairs_complete",
]);

export function getRepairGapThresholdDays(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [REPAIR_PROGRESS_GAP_SETTING]);
  const parsed = Number.parseInt(String(row?.value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return REPAIR_PROGRESS_GAP_DAYS_DEFAULT;
  return parsed;
}

export function setRepairGapThresholdDays(raw: string) {
  const text = String(raw || "").trim();
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== text) {
    throw new Error("Enter the repair-progress gap as a whole number of days, at least 1. It is a review prompt, not a legal limit.");
  }
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [REPAIR_PROGRESS_GAP_SETTING]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(parsed), REPAIR_PROGRESS_GAP_SETTING]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [REPAIR_PROGRESS_GAP_SETTING, String(parsed)]);
}

export function ensureRepairGapSetting(db: DatabaseSync) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(REPAIR_PROGRESS_GAP_SETTING) as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(
      REPAIR_PROGRESS_GAP_SETTING,
      String(REPAIR_PROGRESS_GAP_DAYS_DEFAULT),
    );
    return;
  }
  // 15 was the code's proposed default. Justin confirmed 7 on 15/10/2026. A different stored number was chosen by a handler and is left as it is.
  if (String(existing.value).trim() === String(REPAIR_PROGRESS_GAP_DAYS_PREVIOUS_DEFAULT)) {
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(
      String(REPAIR_PROGRESS_GAP_DAYS_DEFAULT),
      REPAIR_PROGRESS_GAP_SETTING,
    );
  }
}

export function listRepairGapExplanations(claimId: string): RepairGapExplanation[] {
  const rows = all<{
    id: string;
    from_event_id: string;
    to_event_id: string;
    inclusive_days: number;
    note: string;
    recorded_at: string;
  }>(
    `SELECT id, from_event_id, to_event_id, inclusive_days, note, recorded_at
     FROM repair_gap_explanations WHERE claim_id = ? ORDER BY recorded_at ASC, id ASC`,
    [claimId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    fromEventId: String(row.from_event_id),
    toEventId: String(row.to_event_id),
    days: Number(row.inclusive_days),
    note: String(row.note),
    recordedAt: String(row.recorded_at),
  }));
}

export type RepairGapClaimRow = {
  claimId: string;
  fileReference: string;
  clientName: string;
  wording: string;
};

export function listRepairGapClaims(): RepairGapClaimRow[] {
  const threshold = getRepairGapThresholdDays();
  const claims = all<{
    id: string;
    file_reference: string;
    client_name: string | null;
    total_loss: number | null;
    later_declared_total_loss: number | null;
    repaired_vehicle_returned: number | null;
  }>(
    `SELECT c.id, c.file_reference, p.full_name AS client_name, c.total_loss, c.later_declared_total_loss,
            c.repaired_vehicle_returned
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     WHERE NOT EXISTS (
         SELECT 1 FROM claim_events closed
         WHERE closed.claim_id = c.id AND closed.event_type = 'case_closed'
       )
     ORDER BY c.file_reference`,
  );
  const events = all<RepairProgressEvent & { claim_id: string }>(
    `SELECT id, claim_id, event_type, title, details, occurred_at, recorded_at FROM claim_events`,
  );
  const notes = all<{
    claim_id: string;
    id: string;
    from_event_id: string;
    to_event_id: string;
    inclusive_days: number;
    note: string;
    recorded_at: string;
  }>(`SELECT id, claim_id, from_event_id, to_event_id, inclusive_days, note, recorded_at FROM repair_gap_explanations`);
  const byClaim = new Map<string, RepairProgressEvent[]>();
  for (const event of events) {
    const list = byClaim.get(String(event.claim_id)) ?? [];
    list.push(event);
    byClaim.set(String(event.claim_id), list);
  }
  const notesByClaim = new Map<string, RepairGapExplanation[]>();
  for (const note of notes) {
    const list = notesByClaim.get(String(note.claim_id)) ?? [];
    list.push({
      id: String(note.id),
      fromEventId: String(note.from_event_id),
      toEventId: String(note.to_event_id),
      days: Number(note.inclusive_days),
      note: String(note.note),
      recordedAt: String(note.recorded_at),
    });
    notesByClaim.set(String(note.claim_id), list);
  }
  const rows: RepairGapClaimRow[] = [];
  for (const claim of claims) {
    const totalLoss = Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1;
    const gaps = repairProgressGaps(byClaim.get(String(claim.id)) ?? [], {
      totalLoss,
      closed: false,
      returned: Number(claim.repaired_vehicle_returned) === 1,
      thresholdDays: threshold,
      explanations: notesByClaim.get(String(claim.id)) ?? [],
    }).filter((gap) => !gap.explained && !gap.historical);
    for (const gap of gaps) {
      rows.push({
        claimId: String(claim.id),
        fileReference: String(claim.file_reference),
        clientName: String(claim.client_name || "Unknown client"),
        wording: gapFlagWording(gap),
      });
    }
  }
  return rows;
}

export function recordRepairProgressStep(input: {
  claimId: string;
  actorId: string;
  role: string;
  step: string;
  occurredOn: string;
  note: string;
  recipient?: string;
  expectedOn?: string;
}) {
  const step = input.step.trim();
  if (!RECORDABLE.has(step)) throw new Error("That step is not recorded on this screen.");
  assertRepairStepRole(input.role, step);
  if (isOnceOnlyRepairStep(step)) assertStepNotRecorded(input.claimId, step);
  const occurredOn = requireDay(input.occurredOn, "the date this happened");
  const note = input.note.trim();
  if (!note) throw new Error("Enter a note.");
  const recipient = String(input.recipient || "").trim();
  if (step === "engineer_report_sent_to_insurer" && !recipient) {
    throw new Error("Enter who the engineer's report was sent to.");
  }
  const expectedOn = String(input.expectedOn || "").trim();
  if (step === "parts_delayed") {
    if (!expectedOn) throw new Error("Enter the new expected date.");
    requireDay(expectedOn, "the new expected date");
  } else if (expectedOn) {
    requireDay(expectedOn, "the expected delivery date");
  }
  const name = staffName(input.actorId);
  const details = stepDetails({ step, note, name, recipient, expectedOn });
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: step,
    occurredAt: atNine(occurredOn),
    details,
    actorId: input.actorId,
    channel: "system",
    source: "staff",
  });
}

export function recordRepairStepCorrection(input: {
  claimId: string;
  actorId: string;
  role: string;
  step: string;
  occurredOn: string;
  reason: string;
}) {
  const step = input.step.trim();
  if (!RECORDABLE.has(step)) throw new Error("Choose the step this correction is about.");
  assertRepairStepRole(input.role, step);
  const occurredOn = requireDay(input.occurredOn, "the date of this correction");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter the reason for the correction.");
  const name = staffName(input.actorId);
  const label = eventLabel(step);
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "repair_step_correction",
    occurredAt: atNine(occurredOn),
    details: `Correction of ${label}. ${reason} Recorded by ${name}. The original entry is unchanged.`,
    actorId: input.actorId,
    channel: "system",
    source: "staff",
  });
}

export function explainRepairProgressGap(input: {
  claimId: string;
  actorId: string;
  role: string;
  fromEventId: string;
  toEventId: string;
  note: string;
}) {
  if (!isOfficeRole(input.role)) throw new Error("You cannot explain a repair progress gap.");
  const note = input.note.trim();
  if (!note) throw new Error("Enter the explanation.");
  const events = claimProgressEvents(input.claimId);
  const closed = events.some((event) => event.event_type === "case_closed");
  const totalLoss = claimIsTotalLoss(input.claimId);
  const gaps = repairProgressGaps(events, {
    totalLoss,
    closed,
    thresholdDays: getRepairGapThresholdDays(),
    explanations: [],
  });
  const gap = gaps.find((item) => item.fromEventId === input.fromEventId && item.toEventId === input.toEventId);
  if (!gap) throw new Error("That gap is not on the file.");
  const id = newId("gap");
  run(
    `INSERT INTO repair_gap_explanations(
      id, claim_id, from_event_id, to_event_id, inclusive_days, note, actor_id, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, gap.fromEventId, gap.toEventId, gap.days, note, input.actorId, nowUtcIso()],
  );
  return id;
}

/** Generic file history must not collect these, and must not add a second copy of a once-only step. */
export function guardGenericHistoryRepairStep(claimId: string, eventType: string) {
  if ((STRUCTURED_REPAIR_RECORD_TYPES as readonly string[]).includes(eventType)) {
    throw new Error("Record this step on the engineering or repair screen.");
  }
  if (isOnceOnlyRepairStep(eventType) && stepAlreadyRecorded(claimId, eventType)) {
    throw new Error("This step is already recorded. Add a correction. The original entry is not changed.");
  }
}

export function assertRepairStepRole(role: string, step: string) {
  if (isOfficeRole(role)) return;
  if (isMechanicRole(role) && isWorkshopRepairStep(step)) return;
  if (isMechanicRole(role) && isInspectionRepairStep(step)) {
    throw new Error("Bodyshop / mechanic cannot record an inspection or an insurer step.");
  }
  throw new Error("You cannot record this step.");
}

export function gapsForClaim(claimId: string, totalLoss: boolean): RepairProgressGap[] {
  const events = claimProgressEvents(claimId);
  const closed = events.some((event) => event.event_type === "case_closed");
  const returned = get<{ repaired_vehicle_returned: number | null }>(
    `SELECT repaired_vehicle_returned FROM claims WHERE id = ?`,
    [claimId],
  );
  return repairProgressGaps(events, {
    totalLoss,
    closed,
    returned: Number(returned?.repaired_vehicle_returned) === 1,
    thresholdDays: getRepairGapThresholdDays(),
    explanations: listRepairGapExplanations(claimId),
  });
}

function assertStepNotRecorded(claimId: string, step: string) {
  if (stepAlreadyRecorded(claimId, step)) {
    throw new Error("This step is already recorded. Add a correction. The original entry is not changed.");
  }
}

function stepAlreadyRecorded(claimId: string, step: string): boolean {
  const row = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = ? LIMIT 1`,
    [claimId, step],
  );
  return Boolean(row?.id);
}

function claimProgressEvents(claimId: string): RepairProgressEvent[] {
  return all<RepairProgressEvent>(
    `SELECT id, event_type, title, details, occurred_at, recorded_at FROM claim_events WHERE claim_id = ?`,
    [claimId],
  );
}

function claimIsTotalLoss(claimId: string): boolean {
  const row = get<{ total_loss: number | null; later_declared_total_loss: number | null }>(
    `SELECT total_loss, later_declared_total_loss FROM claims WHERE id = ?`,
    [claimId],
  );
  return Number(row?.total_loss) === 1 || Number(row?.later_declared_total_loss) === 1;
}

function staffName(actorId: string): string {
  const row = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [actorId]);
  return String(row?.name || "").trim() || "Staff";
}

function stepDetails(input: {
  step: string;
  note: string;
  name: string;
  recipient: string;
  expectedOn: string;
}): string {
  const parts = [input.note];
  if (input.step === "engineer_report_sent_to_insurer") parts.unshift(`Sent to ${input.recipient}.`);
  if (input.expectedOn) {
    const label = input.step === "parts_delayed" ? "New expected date" : "Expected delivery";
    parts.push(`${label} ${uk(input.expectedOn)}.`);
  }
  parts.push(`Recorded by ${input.name}.`);
  return parts.join(" ");
}

function requireDay(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Enter ${label}.`);
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new Error(`Enter a real date for ${label}.`);
  }
  return day;
}

function atNine(day: string): string {
  return utcFromLondonDateTime(`${day}T09:00`);
}

function uk(day: string): string {
  return formatUkDate(`${day}T12:00:00.000Z`);
}

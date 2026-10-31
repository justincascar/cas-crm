import { isOfficeRole } from "../auth/roles";
import { faultInvoicePence, isClaimStepKey, type ClaimStepKey } from "../domain/claim-steps";
import { occurredOnDay, utcFromLondonDateTime } from "../dates";
import { formatUkDate, londonDateIso, londonTodayIso, nowUtcIso } from "../dates";
import { formatGbp } from "../money";
import { SHARED_HIRE_END, guardSharedFields, hireEndAt } from "./shared-fields";
import { poundsToPence } from "./intake";
import { get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { assertFaultCarReturn } from "./fault-return";

function requireDay(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Enter ${label}.`);
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new Error(`Enter ${label}.`);
  }
  return occurredOnDay(day);
}

function assertOffice(role: string) {
  if (!isOfficeRole(role)) throw new Error("You cannot change this step.");
}

/** A new history line. It does not edit an older event. */
export function recordStepNotNeeded(input: {
  claimId: string;
  actorId: string;
  role: string;
  step: string;
  reason: string;
  occurredOn: string;
}) {
  assertOffice(input.role);
  if (!isClaimStepKey(input.step)) throw new Error("That step is not on this file.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter a reason.");
  const occurredAt = requireDay(input.occurredOn, "the date");
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "step_not_needed",
    occurredAt,
    actorId: input.actorId,
    details: `Step ${input.step} marked not needed. Reason: ${reason}`,
    source: "staff",
  });
}

/**
 * The repair estimate agreed with the client.
 * No existing event means that. This writes only the history line. It does not change a figure.
 */
export function recordRepairEstimateAgreed(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  note: string;
}) {
  assertOffice(input.role);
  const note = input.note.trim();
  if (!note) throw new Error("Enter a note.");
  const occurredAt = requireDay(input.occurredOn, "the date this was agreed");
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "repair_estimate_agreed_with_client",
    occurredAt,
    actorId: input.actorId,
    details: `${note} Recorded by staff. The agreed figure was not changed.`,
    source: "staff",
  });
}

export type { ClaimStepKey };

function optionalPence(raw: string): number | null {
  if (!raw.trim()) return null;
  const pence = poundsToPence(raw);
  if (pence < 0) throw new Error("Enter an amount in pounds.");
  return pence;
}

function requiredPence(raw: string, label: string): number {
  if (!raw.trim()) throw new Error(`Enter the ${label}.`);
  const pence = poundsToPence(raw);
  if (pence < 0) throw new Error(`Enter the ${label}.`);
  return pence;
}

function reduction(penceRaw: string, noteRaw: string, label: string): { pence: number | null; note: string | null } {
  const note = noteRaw.trim();
  const pence = optionalPence(penceRaw);
  if (pence != null && !note) throw new Error(`Enter a note for the ${label}.`);
  return { pence, note: note || null };
}

export function recordRecoveryCompletedOnce(input: { claimId: string; actorId: string; occurredAt: string; details: string }) {
  const existing = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'recovery_completed' LIMIT 1`,
    [input.claimId],
  );
  if (existing) return null;
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "recovery_completed",
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    details: input.details,
    source: "staff",
  });
}

export function recordStorageEndedOnce(input: { claimId: string; actorId: string; occurredAt: string; details: string }) {
  const existing = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'storage_ended' LIMIT 1`,
    [input.claimId],
  );
  if (existing) return null;
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_ended",
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    details: input.details,
    source: "staff",
  });
}

export function recordHireDecision(input: { claimId: string; actorId: string; needsReplacement: boolean; occurredAt: string }) {
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_decision",
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    details: input.needsReplacement ? "Replacement vehicle: yes." : "Replacement vehicle: no.",
    source: "staff",
  });
}

export function recordInspectionRoute(input: {
  claimId: string;
  actorId: string;
  role: string;
  route: string;
  occurredOn: string;
}) {
  assertOffice(input.role);
  const route = input.route.trim();
  if (route !== "engineer" && route !== "audatex" && route !== "both") {
    throw new Error("Choose engineer, an Audatex estimate, or both.");
  }
  const occurredAt = requireDay(input.occurredOn, "the date");
  const words = route === "both" ? "engineer and an Audatex estimate" : route === "audatex" ? "an Audatex estimate" : "an engineer";
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "inspection_route_chosen",
    occurredAt,
    actorId: input.actorId,
    details: `Route: ${route}. Staff chose ${words}. There is no link to Audatex.`,
    source: "staff",
  });
}

type AudatexMoney = {
  reference: string;
  estimatePence: number;
  labourPence: number | null;
  partsPence: number | null;
  paintPence: number | null;
  authorisedPence: number | null;
  hourlyPence: number | null;
  hourlyNote: string | null;
  timesPence: number | null;
  timesNote: string | null;
  partsReductionPence: number | null;
  partsReductionNote: string | null;
  otherPence: number | null;
  otherNote: string | null;
  documentId: string | null;
};

function insertAudatex(claimId: string, actorId: string, sentOn: string | null, money: AudatexMoney) {
  run(
    `INSERT INTO audatex_estimates(
      id, claim_id, sent_on, reference, estimate_total_pence, labour_pence, parts_pence, paint_pence,
      authorised_total_pence, reduction_hourly_pence, reduction_hourly_note, reduction_times_pence, reduction_times_note,
      reduction_parts_pence, reduction_parts_note, reduction_other_pence, reduction_other_note, document_id, recorded_at, recorded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("audatex"),
      claimId,
      sentOn,
      money.reference,
      money.estimatePence,
      money.labourPence,
      money.partsPence,
      money.paintPence,
      money.authorisedPence,
      money.hourlyPence,
      money.hourlyNote,
      money.timesPence,
      money.timesNote,
      money.partsReductionPence,
      money.partsReductionNote,
      money.otherPence,
      money.otherNote,
      money.documentId,
      nowUtcIso(),
      actorId,
    ],
  );
}

function moneyFromForm(form: {
  reference: string;
  estimate: string;
  labour: string;
  parts: string;
  paint: string;
  authorised: string;
  hourly: string;
  hourlyNote: string;
  times: string;
  timesNote: string;
  partsReduction: string;
  partsNote: string;
  other: string;
  otherNote: string;
  documentId: string | null;
  requireAuthorised: boolean;
}): AudatexMoney {
  const reference = form.reference.trim();
  if (!reference) throw new Error("Enter the Audatex reference.");
  const hourly = reduction(form.hourly, form.hourlyNote, "hourly rate reduction");
  const times = reduction(form.times, form.timesNote, "repair time reduction");
  const partsReduction = reduction(form.partsReduction, form.partsNote, "parts reduction");
  const other = reduction(form.other, form.otherNote, "other reduction");
  return {
    reference,
    estimatePence: requiredPence(form.estimate, "estimate total"),
    labourPence: optionalPence(form.labour),
    partsPence: optionalPence(form.parts),
    paintPence: optionalPence(form.paint),
    authorisedPence: form.requireAuthorised ? requiredPence(form.authorised, "authorised total") : optionalPence(form.authorised),
    hourlyPence: hourly.pence,
    hourlyNote: hourly.note,
    timesPence: times.pence,
    timesNote: times.note,
    partsReductionPence: partsReduction.pence,
    partsReductionNote: partsReduction.note,
    otherPence: other.pence,
    otherNote: other.note,
    documentId: form.documentId,
  };
}

/** Records an Audatex estimate by hand. It does not change claimed, agreed or received. */
export function recordAudatexEstimate(input: {
  claimId: string;
  actorId: string;
  role: string;
  kind: "sent" | "received" | "authorised";
  occurredOn: string;
  reference: string;
  estimate: string;
  labour: string;
  parts: string;
  paint: string;
  authorised: string;
  hourly: string;
  hourlyNote: string;
  times: string;
  timesNote: string;
  partsReduction: string;
  partsNote: string;
  other: string;
  otherNote: string;
  documentId?: string | null;
}) {
  assertOffice(input.role);
  const occurredAt = requireDay(input.occurredOn, "the date");
  if (input.kind === "received") {
    return recordClaimEvent({
      claimId: input.claimId,
      eventType: "audatex_estimate_received",
      occurredAt,
      actorId: input.actorId,
      details: "Audatex estimate received. Recorded by hand. There is no link to Audatex.",
      source: "staff",
    });
  }
  const anyFigure = [input.reference, input.estimate, input.labour, input.parts, input.paint].some((value) => value.trim());
  if (input.kind === "sent" && !anyFigure) {
    // One click with a date. The reference and figures can follow with the authorisation.
    return recordClaimEvent({
      claimId: input.claimId,
      eventType: "audatex_estimate_sent",
      occurredAt,
      actorId: input.actorId,
      details: "Audatex estimate sent. Recorded by hand. There is no link to Audatex. Claimed, agreed and received were not changed.",
      source: "staff",
    });
  }
  const money = moneyFromForm({ ...input, documentId: input.documentId || null, requireAuthorised: input.kind === "authorised" });
  insertAudatex(input.claimId, input.actorId, input.kind === "sent" ? occurredAt : null, money);
  if (input.kind === "sent") {
    return recordClaimEvent({
      claimId: input.claimId,
      eventType: "audatex_estimate_sent",
      occurredAt,
      actorId: input.actorId,
      details: `Audatex estimate sent. Reference: ${money.reference}. Recorded by hand. There is no link to Audatex. Claimed, agreed and received were not changed.`,
      source: "staff",
    });
  }
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "audatex_authorisation_recorded",
    occurredAt,
    actorId: input.actorId,
    details: `Audatex authorisation recorded. Reference: ${money.reference}. Authorised pence: ${money.authorisedPence}. Estimate pence: ${money.estimatePence}. Recorded by hand. Claimed, agreed and received were not changed.`,
    source: "staff",
  });
}

export function recordOwnInsurerNotified(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  claimNumber: string;
  note: string;
}) {
  assertOffice(input.role);
  const claimNumber = input.claimNumber.trim();
  if (!claimNumber) throw new Error("Enter the insurer's claim number.");
  const occurredAt = requireDay(input.occurredOn, "the date");
  const note = input.note.trim();
  run(`UPDATE claims SET own_claim_ref = ? WHERE id = ?`, [claimNumber, input.claimId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "initial_letter_own_insurer",
    occurredAt,
    actorId: input.actorId,
    details: `Client's own insurer notified.${note ? ` ${note}` : ""} Recorded on the file.`,
    source: "staff",
  });
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "own_claim_number_recorded",
    occurredAt,
    actorId: input.actorId,
    details: `Claim number: ${claimNumber}`,
    source: "staff",
  });
}

export function recordClientExcessPaid(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  amount: string;
  method: string;
}) {
  assertOffice(input.role);
  const method = input.method.trim();
  if (!method) throw new Error("Enter how the excess was paid.");
  const amountPence = requiredPence(input.amount, "excess amount");
  const occurredAt = requireDay(input.occurredOn, "the date the excess was paid");
  const id = newId("excess");
  run(
    `INSERT INTO client_excess_payments(id, claim_id, amount_pence, paid_on, method, recorded_at, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, amountPence, occurredAt, method, nowUtcIso(), input.actorId],
  );
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "excess_paid",
    occurredAt,
    actorId: input.actorId,
    details: `Excess paid. Amount pence: ${amountPence}. Method: ${method}.`,
    source: "staff",
  });
}

export function recordFaultCarReturn(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  reason: string;
}) {
  assertOffice(input.role);
  const occurredAt = requireDay(input.occurredOn, "the date the car was returned");
  assertFaultCarReturn({ claimId: input.claimId, actorId: input.actorId, releaseReason: input.reason });
  const paid = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'excess_paid' LIMIT 1`,
    [input.claimId],
  );
  const reason = input.reason.trim();
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "vehicle_returned",
    occurredAt,
    actorId: input.actorId,
    details: paid
      ? "Car returned to the client. The excess was already recorded as paid."
      : `Car returned to the client before the excess was paid. Reason: ${reason}. Permission: releaseWithoutExcess.`,
    source: "staff",
  });
}

export function recordFaultInvoice(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  kind: "sent" | "paid";
}) {
  assertOffice(input.role);
  const occurredAt = requireDay(input.occurredOn, "the date");
  const authorised = get<{ authorised_total_pence: number | null }>(
    `SELECT authorised_total_pence FROM audatex_estimates
     WHERE claim_id = ? AND authorised_total_pence IS NOT NULL
     ORDER BY recorded_at DESC LIMIT 1`,
    [input.claimId],
  );
  const excess = get<{ amount_pence: number }>(
    `SELECT amount_pence FROM client_excess_payments WHERE claim_id = ? ORDER BY recorded_at DESC LIMIT 1`,
    [input.claimId],
  );
  const authEvent = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'audatex_authorisation_recorded' LIMIT 1`,
    [input.claimId],
  );
  const excessEvent = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'excess_paid' LIMIT 1`,
    [input.claimId],
  );
  if (!authEvent || !excessEvent || authorised?.authorised_total_pence == null || !excess) {
    throw new Error("The invoice needs the Audatex authorisation and the client's excess on the history.");
  }
  const invoice = faultInvoicePence(authorised.authorised_total_pence, excess.amount_pence);
  if (invoice == null) throw new Error("The invoice could not be worked out.");
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: input.kind === "sent" ? "fault_invoice_sent" : "fault_invoice_paid",
    occurredAt,
    actorId: input.actorId,
    details:
      input.kind === "sent"
        ? `Invoice sent to the client's own insurer. Amount pence: ${invoice}. Authorised pence: ${authorised.authorised_total_pence}. Excess pence: ${excess.amount_pence}. Claimed, agreed and received were not changed.`
        : `Invoice paid by the client's own insurer. Amount pence: ${invoice}. Claimed, agreed and received were not changed.`,
    source: "staff",
  });
}

function pastOrToday(value: string, label: string): string {
  const occurredAt = requireDay(value, label);
  if (value.trim() > londonTodayIso()) throw new Error("The date cannot be in the future.");
  return occurredAt;
}

function staffName(actorId: string): string {
  const row = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [actorId]);
  return String(row?.name || "").trim() || "staff";
}

function hasEvent(claimId: string, eventType: string): boolean {
  return Boolean(get<{ id: string }>(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = ? LIMIT 1`, [claimId, eventType])?.id);
}

/** Step 5, engineer instructed, in one click with a date. Starts the engineer chase like any instruction. */
export function recordEngineerInstructedByHand(input: { claimId: string; actorId: string; role: string; occurredOn: string }) {
  assertOffice(input.role);
  const occurredAt = pastOrToday(input.occurredOn, "the date the engineer was instructed");
  if (hasEvent(input.claimId, "engineer_instructed")) throw new Error("The engineer instruction is already on the file.");
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "engineer_instructed",
    occurredAt,
    actorId: input.actorId,
    details: `Engineer instructed. Marked as sent by ${staffName(input.actorId)} on the claim steps.`,
    channel: "file",
    source: "staff",
  });
}

/** Step 7, the report or estimate forwarded to the third-party insurer, in one click with a date. */
export function recordReportSentByHand(input: { claimId: string; actorId: string; role: string; occurredOn: string }) {
  assertOffice(input.role);
  const occurredAt = pastOrToday(input.occurredOn, "the date it was sent");
  if (!hasEvent(input.claimId, "engineer_report_received") && !hasEvent(input.claimId, "audatex_estimate_received")) {
    throw new Error("Record the report or estimate as received first.");
  }
  if (hasEvent(input.claimId, "engineer_report_sent_to_insurer")) throw new Error("The report is already recorded as sent to the insurer.");
  const insurer = get<{ insurer_name: string | null }>(
    `SELECT insurer_name FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence ASC LIMIT 1`,
    [input.claimId],
  );
  const name = String(insurer?.insurer_name || "").trim();
  const recipient = name && name !== "Unknown" ? name : "the third-party insurer";
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "engineer_report_sent_to_insurer",
    occurredAt,
    actorId: input.actorId,
    details: `Sent to ${recipient}. Marked as sent by ${staffName(input.actorId)} on the claim steps.`,
    channel: "file",
    source: "staff",
  });
}

function latestDay(claimId: string, eventType: string): string | null {
  const row = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC LIMIT 1`,
    [claimId, eventType],
  );
  return row?.occurred_at ? londonDateIso(new Date(row.occurred_at)) : null;
}

function notBefore(day: string, earlierDay: string | null, what: string) {
  if (earlierDay && day < earlierDay) throw new Error(`The date cannot be before ${what} (${formatUkDate(earlierDay)}).`);
}

/** Step 8, repair authorisation received, with an optional authorised figure and reduction. Money heads are not changed. */
export function recordRepairAuthorisedByHand(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  authorised: string;
  reduction: string;
  reductionNote: string;
}) {
  assertOffice(input.role);
  const occurredAt = pastOrToday(input.occurredOn, "the date authorisation was received");
  const authorisedOn = latestDay(input.claimId, "repairs_authorised");
  const clearedOn = latestDay(input.claimId, "repairs_authorised_cleared");
  if (authorisedOn && (!clearedOn || clearedOn < authorisedOn)) throw new Error("Repair authorisation is already on the file.");
  const authorisedPence = optionalPence(input.authorised);
  const cut = reduction(input.reduction, input.reductionNote, "reduction");
  const parts = ["Repair authorisation received."];
  if (authorisedPence != null) parts.push(`Authorised for ${formatGbp(authorisedPence)}.`);
  if (cut.pence != null) parts.push(`Reduction ${formatGbp(cut.pence)}: ${cut.note}.`);
  parts.push(`Recorded by ${staffName(input.actorId)} on the claim steps. Claimed, agreed and received were not changed.`);
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "repairs_authorised",
    occurredAt,
    actorId: input.actorId,
    details: parts.join(" "),
    channel: "file",
    source: "staff",
  });
}

/** Step 9, repairs started or repairs complete, each once, in order. */
export function recordRepairMilestoneByHand(input: {
  claimId: string;
  actorId: string;
  role: string;
  occurredOn: string;
  milestone: "repairs_started" | "repairs_complete";
}) {
  assertOffice(input.role);
  const words = input.milestone === "repairs_started" ? "Repairs started" : "Repairs complete";
  const occurredAt = pastOrToday(input.occurredOn, `the date for ${words.toLowerCase()}`);
  if (hasEvent(input.claimId, input.milestone)) throw new Error(`${words} is already on the file.`);
  if (input.milestone === "repairs_complete") {
    const started = latestDay(input.claimId, "repairs_started");
    if (!started) throw new Error("Record repairs started first.");
    notBefore(input.occurredOn.trim(), started, "repairs started");
  }
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: input.milestone,
    occurredAt,
    actorId: input.actorId,
    details: `${words}. Recorded by ${staffName(input.actorId)} on the claim steps.`,
    channel: "file",
    source: "staff",
  });
}

/** Step 9, the repaired car back with the client. Only after repairs are complete. */
export function recordCarReturnedByHand(input: { claimId: string; actorId: string; role: string; occurredOn: string }) {
  assertOffice(input.role);
  const occurredAt = pastOrToday(input.occurredOn, "the date the car was returned");
  if (hasEvent(input.claimId, "vehicle_returned")) throw new Error("The car is already recorded as returned.");
  const complete = latestDay(input.claimId, "repairs_complete");
  if (!complete) throw new Error("Record repairs complete first.");
  notBefore(input.occurredOn.trim(), complete, "repairs complete");
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "vehicle_returned",
    occurredAt,
    actorId: input.actorId,
    details: `Repaired car returned to the client. Recorded by ${staffName(input.actorId)} on the claim steps.`,
    channel: "file",
    source: "staff",
  });
}

/**
 * Step 9, repairable hire end, confirmed by a handler. Hire ends only after repairs are complete and the repaired
 * car is back with the client. The day is the day the hire car was collected. The daily rate is not changed.
 */
export function confirmRepairableHireEnd(input: { claimId: string; actorId: string; role: string; occurredOn: string }) {
  assertOffice(input.role);
  const day = input.occurredOn.trim();
  pastOrToday(day, "the day the hire car was collected");
  const claim = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  if (Number(claim.total_loss) === 1) throw new Error("A total-loss hire ends 7 days after the qualifying payment. It is confirmed on that step.");
  if (!hasEvent(input.claimId, "repairs_complete") || !hasEvent(input.claimId, "vehicle_returned")) {
    throw new Error("Hire ends only after repairs are complete and the repaired car is back with the client.");
  }
  notBefore(day, latestDay(input.claimId, "vehicle_returned"), "the car was returned");
  const episode = get<{ id: string }>(
    `SELECT id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL AND (billing_end_at IS NULL OR billing_end_at = '')
     ORDER BY started_at DESC LIMIT 1`,
    [input.claimId],
  );
  if (!episode) throw new Error("There is no open hire on this file.");
  guardSharedFields({
    scope: SHARED_HIRE_END,
    recordKey: episode.id,
    actorId: input.actorId,
    current: { billing_end_at: hireEndAt(episode.id) },
    next: { billing_end_at: day },
    labels: { billing_end_at: "Hire end" },
    submitted: { billing_end_at: day },
  });
  run(`UPDATE hire_episodes SET billing_end_at = ?, hire_end_review_on = NULL, collection_at = COALESCE(collection_at, ?) WHERE id = ?`, [
    day,
    day,
    episode.id,
  ]);
  return recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_ended",
    occurredAt: utcFromLondonDateTime(`${day}T12:00`),
    actorId: input.actorId,
    details: `Hire end confirmed by ${staffName(input.actorId)}: ${formatUkDate(day)}, the day the hire car was collected. The daily rate was left as it is.`,
    channel: "file",
    source: "staff",
  });
}

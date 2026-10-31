import { londonDateIso, utcFromLondonDateTime } from "../dates";
import { CHASE_KIND_DEFINITIONS } from "./chase";
import { eventLabel } from "./events";
import { DOCUMENT_CHASE_SENT_EVENT, TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT } from "./follow-up-chases";
import {
  REPAIR_PROGRESS_SEQUENCE,
  missingRepairProgressSteps,
  repairProgressExpectsSteps,
} from "./repair-progress";

/**
 * Hire and repair chronology. A filter of claim_events already on the file.
 * It does not write history, automations, or screen data.
 *
 * Repair progress steps use the date already stored on the event. A missing
 * required step on an open repairable file is stated afterwards, without a
 * date. Parts delayed is shown only when it was recorded. A total loss does
 * not gain blank workshop lines. A workshop step already recorded stays.
 * Typed loss-of-use dates are not read.
 */

const MILESTONE_TYPES = [
  "accident",
  "recovery_completed",
  "engineer_instructed",
  "initial_letter_tp_insurer",
  "initial_letter_own_insurer",
  "engineer_report_received",
  "hire_ended",
  "storage_ended",
  "storage_recovery_agreement_override",
  "repair_steps_closed_total_loss",
  // R33: payments received.
  "head_payment_logged",
  "repair_payment_received",
  "repair_invoice_payment_logged",
  "settlement_payment_logged",
  "total_loss_payment_received",
] as const;

/** R33: the hire is part of the litigation chronology on a credit-hire file. A fault courtesy car is not credit hire. */
const CREDIT_HIRE_TYPES = new Set<string>(["hire_started", "hire_swap_started", "hire_vehicle_changed", "hire_agreement_renewed"]);

/** A signed hire agreement, kept by its note (it is filed as a document). */
export function signedAgreementNote(event: { event_type: string; details: string | null }): boolean {
  return event.event_type === "document_filed" && /hire agreement/i.test(event.details || "") && /signed/i.test(event.details || "");
}

/** A payment line in plain words. The stored note keeps its codes for the money screens. */
export function paymentWords(details: string | null): string | null {
  const text = details || "";
  const head = text.match(/head=([a-z_]+)/)?.[1];
  const amount = Number(text.match(/amount_pence=(-?\d+)/)?.[1]);
  if (!head || !Number.isFinite(amount)) return details;
  const names: Record<string, string> = { repairs: "Repairs", vehicle_damage: "Vehicle damage", recovery: "Recovery", storage: "Storage", hire: "Hire" };
  const pounds = (Math.abs(amount) / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  const correction = /correction=1/.test(text);
  return `${names[head] || head} ${correction ? "payment corrected by" : "payment received:"} ${amount < 0 ? "-" : ""}${pounds}.`;
}

/**
 * A step dated today used to be stamped 09:00 although it was recorded later, which put it before things done earlier
 * that day. Such a line is placed at the time it was recorded.
 */
export function effectiveTime(event: { occurred_at: string; recorded_at?: string | null }): string {
  const recorded = event.recorded_at || "";
  if (!recorded || recorded <= event.occurred_at) return event.occurred_at;
  const day = londonDateIso(new Date(event.occurred_at));
  if (day !== londonDateIso(new Date(recorded))) return event.occurred_at;
  return event.occurred_at === utcFromLondonDateTime(`${day}T09:00`) ? recorded : event.occurred_at;
}

/**
 * Dated repair steps. Shown when repair applies, and also when already
 * recorded on a file that later became a total loss. A missing required
 * step is stated afterwards, without a date, only while repair applies.
 */
export const REPAIR_PIPELINE_TYPES = REPAIR_PROGRESS_SEQUENCE.map((step) => step.type);

/**
 * Other history that shows the file went into repair, even with no engineer
 * instruction. These are not extra chronology lines.
 */
const REPAIR_SIGNAL_TYPES = new Set<string>([
  ...REPAIR_PIPELINE_TYPES,
  "repair_authorisation_requested",
  "vehicle_returned",
  "repair_step_correction",
]);

/** Steps whose note is a fact, not a generated-or-sent letter. */
const NO_DISPATCH = new Set<string>([
  "accident",
  "recovery_completed",
  "engineer_report_received",
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
  "repairs_authorised",
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "hire_ended",
  "storage_ended",
  "repairs_complete",
  "repair_step_correction",
]);

const EXTRA_CHASE_SENT_TYPES = [
  "payment_chase_1_sent",
  "payment_chase_2_sent",
  "internal_chase_sent",
  DOCUMENT_CHASE_SENT_EVENT,
  TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT,
] as const;

export type JustificationDispatch = "generated" | "sent";

export type JustificationSourceEvent = {
  id: string;
  event_type: string;
  title: string;
  details: string | null;
  occurred_at: string;
  recorded_at?: string | null;
};

export type JustificationLine = {
  id: string;
  eventType: string;
  occurredAt: string;
  title: string;
  details: string | null;
  /** Set only when the stored note already says generated or sent. */
  dispatch: JustificationDispatch | null;
};

export type JustificationRepairGap = {
  eventType: string;
  label: string;
};

export type JustificationChronologyOptions = {
  /** A total loss does not expect missing workshop steps. Steps already recorded stay on the list. */
  totalLoss?: boolean;
  /** A credit-hire file: the hire, the swap and the signed agreements are listed (R33). */
  creditHire?: boolean;
};

export function justificationChaseEventTypes(): string[] {
  const types = new Set<string>(EXTRA_CHASE_SENT_TYPES);
  for (const def of Object.values(CHASE_KIND_DEFINITIONS)) {
    types.add(def.chaseSentEventType);
    for (const extra of def.extraChaseSentEventTypes) types.add(extra);
    for (const start of def.startEventTypes) {
      if (start.endsWith("_sent")) types.add(start);
    }
  }
  return [...types].sort();
}

export function justificationEventTypes(): string[] {
  return [...new Set<string>([...MILESTONE_TYPES, ...justificationChaseEventTypes()])];
}

/**
 * Reads the note already stored on the history line.
 * "Recorded from generated …" is generation. "Marked as sent", "Sent from",
 * "sent from", "Sent by", and the mailbox "sent to … from …" wording are sends.
 * Anything else is left unmarked so a generated letter is not shown as sent.
 */
export function dispatchFromHistoryNote(details: string | null | undefined): JustificationDispatch | null {
  const text = details || "";
  if (text.includes("Recorded from generated")) return "generated";
  if (text.includes("Marked as sent") || text.includes("Sent by ") || text.includes("sent to ")) return "sent";
  // "auto-sent from" is the prepared-not-sent wording and is not a send on its own.
  if (/(?<!auto-)sent from /i.test(text)) return "sent";
  return null;
}

/**
 * Repair applies on a file that is not a total loss, once an engineer has
 * been instructed or any repair event is already stored. A fault file that
 * never went to repair does not apply. A total loss does not expect the
 * workshop steps.
 */
export function repairChronologyApplies(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): boolean {
  if (options?.totalLoss) return false;
  return repairProgressExpectsSteps(events, options);
}

export function justificationRepairGaps(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): JustificationRepairGap[] {
  return missingRepairProgressSteps(events, options);
}

export function justificationChronology(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): JustificationLine[] {
  const allowed = new Set(justificationEventTypes());
  if (repairChronologyApplies(events, options)) {
    for (const type of REPAIR_PIPELINE_TYPES) allowed.add(type);
    allowed.add("repair_step_correction");
  } else {
    for (const event of events) {
      if (
        REPAIR_SIGNAL_TYPES.has(event.event_type) &&
        event.event_type !== "repair_authorisation_requested" &&
        event.event_type !== "vehicle_returned"
      ) {
        allowed.add(event.event_type);
      }
    }
  }
  if (options?.creditHire) for (const type of CREDIT_HIRE_TYPES) allowed.add(type);
  const kept = events.filter((event) => allowed.has(event.event_type) || (options?.creditHire && signedAgreementNote(event)));
  kept.sort((a, b) => {
    const aAt = effectiveTime(a);
    const bAt = effectiveTime(b);
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    const aRecorded = a.recorded_at || "";
    const bRecorded = b.recorded_at || "";
    if (aRecorded !== bRecorded) return aRecorded < bRecorded ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return kept.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    occurredAt: effectiveTime(event),
    title: signedAgreementNote(event) ? "Hire agreement signed" : event.title.trim() || eventLabel(event.event_type),
    details: event.event_type === "head_payment_logged" ? paymentWords(event.details) : event.details,
    dispatch: NO_DISPATCH.has(event.event_type) ? null : dispatchFromHistoryNote(event.details),
  }));
}

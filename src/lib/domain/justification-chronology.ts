import { CHASE_KIND_DEFINITIONS } from "./chase";
import { eventLabel } from "./events";
import { DOCUMENT_CHASE_SENT_EVENT, TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT } from "./follow-up-chases";

/**
 * Hire and repair chronology. A filter of claim_events already on the file.
 * It does not write history, automations, or screen data.
 *
 * Repairs started and repairs complete are included when this file is being
 * repaired. They use the date already stored on the event.
 *
 * Inspection date, the report sent on to the insurer, the vehicle received
 * for repair, and parts ordered are not stored as dated events. They are
 * not invented here. Typed loss-of-use dates are not read.
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
] as const;

/**
 * Dated repair steps the file can already record. Shown only when repair
 * applies. A missing one is stated afterwards, without a date.
 */
export const REPAIR_PIPELINE_TYPES = ["repairs_started", "repairs_complete"] as const;

/**
 * Other history that shows the file went into repair, even with no engineer
 * instruction. These are not extra chronology lines.
 */
const REPAIR_SIGNAL_TYPES = new Set<string>([
  ...REPAIR_PIPELINE_TYPES,
  "repairs_authorised",
  "repair_authorisation_requested",
  "vehicle_returned",
]);

/** Steps whose note is a fact, not a generated-or-sent letter. */
const NO_DISPATCH = new Set<string>([
  "accident",
  "recovery_completed",
  "engineer_report_received",
  "hire_ended",
  "storage_ended",
  "repairs_complete",
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
  /** A total loss does not show the repair steps, including a file later declared a total loss. */
  totalLoss?: boolean;
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
 * never went to repair does not apply.
 */
export function repairChronologyApplies(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): boolean {
  if (options?.totalLoss) return false;
  if (events.some((event) => event.event_type === "engineer_instructed")) return true;
  return events.some((event) => REPAIR_SIGNAL_TYPES.has(event.event_type));
}

export function justificationRepairGaps(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): JustificationRepairGap[] {
  if (!repairChronologyApplies(events, options)) return [];
  const present = new Set(events.map((event) => event.event_type));
  return REPAIR_PIPELINE_TYPES.filter((type) => !present.has(type)).map((type) => ({
    eventType: type,
    label: eventLabel(type),
  }));
}

export function justificationChronology(
  events: JustificationSourceEvent[],
  options?: JustificationChronologyOptions,
): JustificationLine[] {
  const allowed = new Set(justificationEventTypes());
  if (repairChronologyApplies(events, options)) {
    for (const type of REPAIR_PIPELINE_TYPES) allowed.add(type);
  }
  const kept = events.filter((event) => allowed.has(event.event_type));
  kept.sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
    const aRecorded = a.recorded_at || "";
    const bRecorded = b.recorded_at || "";
    if (aRecorded !== bRecorded) return aRecorded < bRecorded ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return kept.map((event) => ({
    id: event.id,
    eventType: event.event_type,
    occurredAt: event.occurred_at,
    title: event.title.trim() || eventLabel(event.event_type),
    details: event.details,
    dispatch: NO_DISPATCH.has(event.event_type) ? null : dispatchFromHistoryNote(event.details),
  }));
}

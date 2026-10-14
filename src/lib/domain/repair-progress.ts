import { londonDateIso } from "../dates";
import { eventLabel } from "./events";
import { londonCalendarDayGap } from "./storage-authorisation-end";

/**
 * Review prompt, not a legal rule. An inclusive gap of this many days is flagged
 * until someone explains it. 14 inclusive days is not flagged. 15 is.
 * Justin should confirm the number. It is not a legal limit.
 */
export const REPAIR_PROGRESS_GAP_DAYS_DEFAULT = 15;

export const REPAIR_PROGRESS_GAP_SETTING = "repair_progress_gap_days";

/** Shown when a simulated send of the engineer's report does not write the sent event. */
export const SIMULATED_REPORT_NOT_RECORDED = "Simulated, not recorded as sent";

export const ENGINEER_REPORT_DOCUMENT_TYPE = "engineer_report";

/** Once-only steps. A second save is refused. Parts delayed is not in this list. */
export const ONCE_ONLY_REPAIR_STEPS = [
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
  "repairs_authorised",
  "vehicle_received_for_repair",
  "parts_ordered",
  "repairs_started",
  "repairs_complete",
] as const;

export const WORKSHOP_REPAIR_STEPS = [
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repairs_started",
  "repairs_complete",
] as const;

/** Collected on the engineering or repair screen, not the generic file-history form. */
export const STRUCTURED_REPAIR_RECORD_TYPES = [
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repair_step_correction",
] as const;

export const INSPECTION_REPAIR_STEPS = [
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_sent_to_insurer",
] as const;

/**
 * Expected order on an open repairable claim. Used for "not recorded" and for
 * gap detection. Recording out of this order is allowed.
 * Parts delayed is optional and may be recorded more than once.
 */
export const REPAIR_PROGRESS_SEQUENCE = [
  { type: "engineer_inspection_booked", workshop: false, optional: false, repeatable: false },
  { type: "engineer_inspection_attended", workshop: false, optional: false, repeatable: false },
  { type: "engineer_report_received", workshop: false, optional: false, repeatable: false },
  { type: "engineer_report_sent_to_insurer", workshop: false, optional: false, repeatable: false },
  { type: "repairs_authorised", workshop: false, optional: false, repeatable: false },
  { type: "vehicle_received_for_repair", workshop: true, optional: false, repeatable: false },
  { type: "parts_ordered", workshop: true, optional: false, repeatable: false },
  { type: "parts_delayed", workshop: true, optional: true, repeatable: true },
  { type: "repairs_started", workshop: true, optional: false, repeatable: false },
  { type: "repairs_complete", workshop: true, optional: false, repeatable: false },
] as const;

export type RepairProgressStepType = (typeof REPAIR_PROGRESS_SEQUENCE)[number]["type"];

export const WORKSHOP_STEP_TYPES = new Set<string>(
  REPAIR_PROGRESS_SEQUENCE.filter((step) => step.workshop).map((step) => step.type),
);

/** Required steps that say "not recorded" when repair applies and the event is absent. */
export const REQUIRED_REPAIR_PROGRESS_TYPES = REPAIR_PROGRESS_SEQUENCE.filter((step) => !step.optional).map(
  (step) => step.type,
);

export type RepairProgressEvent = {
  id: string;
  event_type: string;
  title: string;
  details: string | null;
  occurred_at: string;
  recorded_at?: string | null;
};

export type RepairGapExplanation = {
  id: string;
  fromEventId: string;
  toEventId: string;
  inclusiveDays: number;
  note: string;
};

export type RepairProgressGap = {
  fromEventId: string;
  toEventId: string;
  fromLabel: string;
  toLabel: string;
  inclusiveDays: number;
  explained: boolean;
  note: string | null;
};

export function isOnceOnlyRepairStep(eventType: string): boolean {
  return (ONCE_ONLY_REPAIR_STEPS as readonly string[]).includes(eventType);
}

export function isWorkshopRepairStep(eventType: string): boolean {
  return WORKSHOP_STEP_TYPES.has(eventType);
}

export function isInspectionRepairStep(eventType: string): boolean {
  return (INSPECTION_REPAIR_STEPS as readonly string[]).includes(eventType);
}

/** Both the first day and the last day. 22/09/2026 to 01/10/2026 is 10. Same day is 1. */
export function inclusiveLondonDays(fromIso: string, toIso: string): number {
  const fromDay = londonDay(fromIso);
  const toDay = londonDay(toIso);
  if (!fromDay || !toDay) return 1;
  return Math.abs(londonCalendarDayGap(fromDay, toDay)) + 1;
}

export function gapIsFlagged(inclusiveDays: number, thresholdDays = REPAIR_PROGRESS_GAP_DAYS_DEFAULT): boolean {
  return inclusiveDays >= thresholdDays;
}

export function unexplainedGapWording(gap: Pick<RepairProgressGap, "inclusiveDays" | "fromLabel" | "toLabel">): string {
  return `Unexplained gap of ${gap.inclusiveDays} days between ${gap.fromLabel} and ${gap.toLabel}`;
}

export function explainedGapWording(gap: Pick<RepairProgressGap, "inclusiveDays" | "fromLabel" | "toLabel" | "note">): string {
  return `Gap of ${gap.inclusiveDays} days between ${gap.fromLabel} and ${gap.toLabel}: ${gap.note || ""}`.trim();
}

/**
 * Consecutive recorded steps in the expected sequence. Missing steps are skipped.
 * Parts delayed is included only when it was recorded, in date order.
 */
export function repairProgressGaps(
  events: RepairProgressEvent[],
  options?: {
    totalLoss?: boolean;
    closed?: boolean;
    thresholdDays?: number;
    explanations?: RepairGapExplanation[];
  },
): RepairProgressGap[] {
  if (options?.totalLoss || options?.closed) return [];
  if (!repairProgressExpectsSteps(events, options)) return [];
  const threshold = options?.thresholdDays ?? REPAIR_PROGRESS_GAP_DAYS_DEFAULT;
  const slots = recordedSequence(events);
  const explanations = options?.explanations ?? [];
  const gaps: RepairProgressGap[] = [];
  for (let index = 1; index < slots.length; index += 1) {
    const previous = slots[index - 1];
    const current = slots[index];
    const inclusiveDays = inclusiveLondonDays(previous.occurred_at, current.occurred_at);
    if (!gapIsFlagged(inclusiveDays, threshold)) continue;
    const match = explanations.find(
      (item) =>
        item.fromEventId === previous.id &&
        item.toEventId === current.id &&
        item.inclusiveDays >= inclusiveDays,
    );
    gaps.push({
      fromEventId: previous.id,
      toEventId: current.id,
      fromLabel: stepLabel(previous),
      toLabel: stepLabel(current),
      inclusiveDays,
      explained: Boolean(match),
      note: match?.note ?? null,
    });
  }
  return gaps;
}

export function repairProgressExpectsSteps(
  events: RepairProgressEvent[],
  options?: { totalLoss?: boolean },
): boolean {
  if (options?.totalLoss) return false;
  if (events.some((event) => event.event_type === "engineer_instructed")) return true;
  const signals = new Set<string>([
    ...REQUIRED_REPAIR_PROGRESS_TYPES,
    "parts_delayed",
    "repair_authorisation_requested",
    "vehicle_returned",
  ]);
  return events.some((event) => signals.has(event.event_type));
}

/** Missing required steps, in sequence order. Parts delayed is never listed here. */
export function missingRepairProgressSteps(
  events: RepairProgressEvent[],
  options?: { totalLoss?: boolean },
): Array<{ eventType: string; label: string }> {
  if (!repairProgressExpectsSteps(events, options)) return [];
  const present = new Set(events.map((event) => event.event_type));
  return REQUIRED_REPAIR_PROGRESS_TYPES.filter((type) => !present.has(type)).map((type) => ({
    eventType: type,
    label: eventLabel(type),
  }));
}

function recordedSequence(events: RepairProgressEvent[]): RepairProgressEvent[] {
  const slots: RepairProgressEvent[] = [];
  for (const step of REPAIR_PROGRESS_SEQUENCE) {
    const matches = events.filter((event) => event.event_type === step.type);
    matches.sort(byOccurred);
    if (step.repeatable) {
      slots.push(...matches);
    } else if (matches[0]) {
      slots.push(matches[0]);
    }
  }
  return slots;
}

function byOccurred(a: RepairProgressEvent, b: RepairProgressEvent): number {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
  const aRecorded = a.recorded_at || "";
  const bRecorded = b.recorded_at || "";
  if (aRecorded !== bRecorded) return aRecorded < bRecorded ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function stepLabel(event: RepairProgressEvent): string {
  const title = event.title.trim();
  return title || eventLabel(event.event_type);
}

function londonDay(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

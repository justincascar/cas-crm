import { londonDateIso } from "../dates";
import { eventLabel } from "./events";
import { londonCalendarDayGap } from "./storage-authorisation-end";

/**
 * Review prompt, not a legal rule. Confirmed by Justin on 15/10/2026.
 * A gap of this many real days is flagged. 6 is not. The next day counts as 1.
 * Both the first day and the last day are not counted together. That inclusive
 * count is for hire and storage charges only.
 */
export const REPAIR_PROGRESS_GAP_DAYS_DEFAULT = 7;

/** The previous code default. A stored 15 is that default, not a handler choice. */
export const REPAIR_PROGRESS_GAP_DAYS_PREVIOUS_DEFAULT = 15;

/** Explanation of the open "nothing since the last step" flag. Not a claim event id. */
export const SINCE_LAST_STEP = "since-last";

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

/**
 * Gap steps, compared in date order. Chasers, letters and corrections are not in this list.
 * Parts delayed is included once for each recorded occurrence. The other steps are included
 * for each recorded row as well, then sorted by the date on the row.
 */
export const REPAIR_GAP_STEP_TYPES = [
  "recovery_completed",
  "engineer_instructed",
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_received",
  "engineer_report_sent_to_insurer",
  "repairs_authorised",
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repairs_started",
  "repairs_complete",
  "vehicle_returned",
] as const;

/** Workshop steps a total loss no longer expects. Already-recorded rows stay on the chronology. */
export const TOTAL_LOSS_WORKSHOP_GAP_TYPES = new Set<string>([
  "vehicle_received_for_repair",
  "parts_ordered",
  "parts_delayed",
  "repairs_started",
  "repairs_complete",
  "vehicle_returned",
]);

/** Steps that still count towards a gap after a total loss. */
export const TOTAL_LOSS_GAP_STEP_TYPES = new Set<string>([
  "recovery_completed",
  "engineer_instructed",
  "engineer_inspection_booked",
  "engineer_inspection_attended",
  "engineer_report_received",
  "engineer_report_sent_to_insurer",
]);

export type RepairGapExplanation = {
  id: string;
  fromEventId: string;
  toEventId: string;
  /** Real days between the two dates when the explanation was saved. The column is still named inclusive_days. */
  days: number;
  note: string;
  recordedAt: string;
};

export type RepairProgressGap = {
  kind: "between" | "since";
  fromEventId: string;
  toEventId: string;
  fromLabel: string;
  toLabel: string;
  /** Real days. The next day is 1. 01/09 to 08/09 is 7. */
  days: number;
  explained: boolean;
  note: string | null;
  /** UK date of the last step, for the "no progress since" wording. */
  stepOn: string | null;
  /** UK date the open gap was last explained. */
  explainedOn: string | null;
  /** The since-last-step flag has come back after a further threshold with no new step. */
  still: boolean;
  /** An older explanation for a pair that is no longer consecutive. It does not clear a live gap. */
  historical: boolean;
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

/** Both the first day and the last day. 22/09/2026 to 01/10/2026 is 10. Same day is 1. Charges only. */
export function inclusiveLondonDays(fromIso: string, toIso: string): number {
  const fromDay = londonDay(fromIso);
  const toDay = londonDay(toIso);
  if (!fromDay || !toDay) return 1;
  return Math.abs(londonCalendarDayGap(fromDay, toDay)) + 1;
}

/** Real days that passed. The next day is 1. 01/09 to 08/09 is 7. 01/09 to 07/09 is 6. Same day is 0. */
export function realLondonDays(fromIso: string, toIso: string): number {
  const fromDay = londonDay(fromIso);
  const toDay = londonDay(toIso);
  if (!fromDay || !toDay) return 0;
  return Math.abs(londonCalendarDayGap(fromDay, toDay));
}

export function gapIsFlagged(days: number, thresholdDays = REPAIR_PROGRESS_GAP_DAYS_DEFAULT): boolean {
  return days >= thresholdDays;
}

export function unexplainedGapWording(gap: Pick<RepairProgressGap, "days" | "fromLabel" | "toLabel">): string {
  return `Unexplained gap of ${gap.days} days between ${gap.fromLabel} and ${gap.toLabel}`;
}

export function explainedGapWording(gap: Pick<RepairProgressGap, "days" | "fromLabel" | "toLabel" | "note">): string {
  return `Gap of ${gap.days} days between ${gap.fromLabel} and ${gap.toLabel}: ${gap.note || ""}`.trim();
}

export function noProgressWording(gap: Pick<RepairProgressGap, "days" | "fromLabel" | "stepOn">): string {
  return `No progress recorded for ${gap.days} days since ${gap.fromLabel} on ${gap.stepOn}`;
}

export function stillNoProgressWording(gap: Pick<RepairProgressGap, "days" | "fromLabel" | "explainedOn">): string {
  return `Still no progress recorded for ${gap.days} days since ${gap.fromLabel}, last explained ${gap.explainedOn}`;
}

export function gapFlagWording(gap: RepairProgressGap): string {
  if (gap.kind === "since" && gap.still) return stillNoProgressWording(gap);
  if (gap.kind === "since") return noProgressWording(gap);
  return unexplainedGapWording(gap);
}

/**
 * Consecutive repair-progress steps in date order.
 * A total loss uses only the steps that still apply. Workshop steps already recorded
 * stay on the chronology and do not reset the gap.
 * A chaser or a letter is not a gap step.
 * "No progress since the last step" is flagged on an open file. Open, for a repair,
 * means the repaired vehicle has not been returned and the claim is not closed.
 * On a total loss it means the claim is not closed.
 * An explanation of that open flag lasts until another threshold of days passes
 * with no new step.
 */
export function repairProgressGaps(
  events: RepairProgressEvent[],
  options?: {
    totalLoss?: boolean;
    closed?: boolean;
    returned?: boolean;
    today?: string;
    thresholdDays?: number;
    explanations?: RepairGapExplanation[];
  },
): RepairProgressGap[] {
  const threshold = options?.thresholdDays ?? REPAIR_PROGRESS_GAP_DAYS_DEFAULT;
  const today = options?.today || londonDateIso(new Date());
  const explanations = options?.explanations ?? [];
  const steps = gapSteps(events, Boolean(options?.totalLoss));
  const gaps: RepairProgressGap[] = [];
  const used = new Set<string>();
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    const days = realLondonDays(previous.occurred_at, current.occurred_at);
    const match = explanations.find(
      (item) => item.fromEventId === previous.id && item.toEventId === current.id && item.toEventId !== SINCE_LAST_STEP,
    );
    if (match) used.add(match.id);
    if (!gapIsFlagged(days, threshold)) continue;
    const covers = Boolean(match && match.days >= days);
    gaps.push(betweenGap(previous, current, days, covers ? match : undefined));
  }
  const closed = Boolean(options?.closed) || events.some((event) => event.event_type === "case_closed");
  const returned =
    Boolean(options?.returned) || events.some((event) => event.event_type === "vehicle_returned");
  const sinceApplies = steps.length > 0 && !closed && (Boolean(options?.totalLoss) || !returned);
  if (sinceApplies) {
    const last = steps[steps.length - 1];
    const days = realLondonDays(last.occurred_at, today);
    if (gapIsFlagged(days, threshold)) {
      const notes = explanations
        .filter((item) => item.fromEventId === last.id && item.toEventId === SINCE_LAST_STEP)
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
      const latest = notes[0];
      if (latest) used.add(latest.id);
      const sinceExplained = latest ? realLondonDays(latest.recordedAt, today) : threshold;
      const silenced = Boolean(latest) && sinceExplained < threshold;
      gaps.push({
        kind: "since",
        fromEventId: last.id,
        toEventId: SINCE_LAST_STEP,
        fromLabel: stepLabel(last),
        toLabel: "",
        days,
        explained: silenced,
        note: silenced ? latest?.note ?? null : null,
        stepOn: ukDay(londonDay(last.occurred_at) || ""),
        explainedOn: latest ? ukDay(londonDay(latest.recordedAt) || "") : null,
        still: Boolean(latest) && !silenced,
        historical: false,
      });
    }
  }
  for (const item of explanations) {
    if (used.has(item.id) || item.toEventId === SINCE_LAST_STEP) continue;
    const from = events.find((event) => event.id === item.fromEventId);
    const to = events.find((event) => event.id === item.toEventId);
    if (!from || !to) continue;
    gaps.push({
      kind: "between",
      fromEventId: from.id,
      toEventId: to.id,
      fromLabel: stepLabel(from),
      toLabel: stepLabel(to),
      days: realLondonDays(from.occurred_at, to.occurred_at),
      explained: true,
      note: item.note,
      stepOn: null,
      explainedOn: ukDay(londonDay(item.recordedAt) || ""),
      still: false,
      historical: true,
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

function gapSteps(events: RepairProgressEvent[], totalLoss: boolean): RepairProgressEvent[] {
  const allowed = new Set<string>(totalLoss ? TOTAL_LOSS_GAP_STEP_TYPES : REPAIR_GAP_STEP_TYPES);
  const steps = events.filter((event) => allowed.has(event.event_type));
  steps.sort(byOccurred);
  return steps;
}

function betweenGap(
  previous: RepairProgressEvent,
  current: RepairProgressEvent,
  days: number,
  match: RepairGapExplanation | undefined,
): RepairProgressGap {
  return {
    kind: "between",
    fromEventId: previous.id,
    toEventId: current.id,
    fromLabel: stepLabel(previous),
    toLabel: stepLabel(current),
    days,
    explained: Boolean(match),
    note: match?.note ?? null,
    stepOn: null,
    explainedOn: match ? ukDay(londonDay(match.recordedAt) || "") : null,
    still: false,
    historical: false,
  };
}

function ukDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
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

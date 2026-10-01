import { isBeforeLondonDay, isSameLondonDay } from "../dates";
import { CHASE_KIND_ORDER, chaseDefinition, type ChaseKind, type ChaseSeverity } from "./chase";
import { SUPPLEMENTARY_CHASE_ORDER, type SupplementaryChaseKind } from "./follow-up-chases";

/** Same test as the dashboard card "Awaited liability responses". */
export function awaitedLiabilityResponse(position: string | null | undefined): boolean {
  return String(position || "") === "pending";
}

/** Same test as the dashboard card "Awaited engineer reports". The instruction has already been recorded. */
export function awaitedEngineerReport(status: string | null | undefined): boolean {
  return status === "instructed" || status === "awaiting_report";
}

/** Same test as the dashboard card "Repair authorisations awaited". The request has already been recorded. */
export function awaitedRepairAuthorisation(status: string | null | undefined): boolean {
  return status === "awaiting_auth";
}

/**
 * Repair authorisation is not part of this file.
 * Total-loss files are stored as not_applicable, which is why they stay off the awaited card.
 */
export function repairAuthorisationApplies(status: string | null | undefined, totalLoss: boolean): boolean {
  if (totalLoss) return false;
  const value = String(status || "");
  if (!value || value === "not_applicable") return false;
  if (value === "in_progress" || value === "awaiting_return" || value === "complete") return false;
  return value === "to_book" || value === "awaiting_assessment" || awaitedRepairAuthorisation(value);
}

export const SEND_LIABILITY_LABEL = "Send liability notification letter";
export const INSTRUCT_ENGINEER_LABEL = "Instruct the engineer";
export const REQUEST_REPAIR_AUTHORISATION_LABEL = "Request repair authorisation";
export const NOTHING_OUTSTANDING = "Nothing outstanding right now.";

export type OutstandingBand = "task_overdue" | "task_today" | "chase_overdue" | "chase_red" | "chase_amber" | "plain";

export type OutstandingItem = {
  id: string;
  label: string;
  band: OutstandingBand;
};

export type OutstandingTaskInput = {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
};

const OUTSTANDING_CHASE_ORDER = [...CHASE_KIND_ORDER, ...SUPPLEMENTARY_CHASE_ORDER];

export type OutstandingChaseInput = {
  kind: ChaseKind | SupplementaryChaseKind;
  due: boolean;
  label: string | null;
  dueLabel: string;
  severity: ChaseSeverity | null;
  reason: string;
};

const BAND_RANK: Record<OutstandingBand, number> = {
  task_overdue: 0,
  task_today: 1,
  chase_overdue: 2,
  chase_red: 3,
  chase_amber: 4,
  plain: 5,
};

const NOT_YET_SENT: Array<{
  kind: "liability_response" | "engineer_report" | "repair_authorisation";
  label: string;
}> = [
  { kind: "liability_response", label: SEND_LIABILITY_LABEL },
  { kind: "engineer_report", label: INSTRUCT_ENGINEER_LABEL },
  { kind: "repair_authorisation", label: REQUEST_REPAIR_AUTHORISATION_LABEL },
];

function severityBand(severity: ChaseSeverity | null): OutstandingBand {
  if (severity === "red_overdue") return "chase_overdue";
  if (severity === "amber") return "chase_amber";
  return "chase_red";
}

function severityRank(severity: ChaseSeverity | null): number {
  if (severity === "red_overdue") return 0;
  if (severity === "red") return 1;
  if (severity === "amber") return 2;
  return 3;
}

function stepMarkedSent(kind: ChaseKind, eventTypes: Set<string>, chases: OutstandingChaseInput[]): boolean {
  const definition = chaseDefinition(kind);
  if (definition.startEventTypes.some((eventType) => eventTypes.has(eventType))) return true;
  const chase = chases.find((row) => row.kind === kind);
  if (!chase) return false;
  return chase.reason !== definition.notStartedReason;
}

export function buildOutstanding(input: {
  tasks: OutstandingTaskInput[];
  chases: OutstandingChaseInput[];
  eventTypes: string[];
  insurerLiabilityPosition: string | null;
  engineeringStatus: string | null;
  repairStatus: string | null;
  totalLoss: boolean;
  asAt?: Date;
}): OutstandingItem[] {
  const asAt = input.asAt ?? new Date();
  const events = new Set(input.eventTypes);
  const items: Array<OutstandingItem & { rank: number; tie: string }> = [];

  for (const task of input.tasks) {
    if (task.status !== "open" || !task.dueAt) continue;
    const overdue = isBeforeLondonDay(task.dueAt, asAt);
    const dueToday = isSameLondonDay(task.dueAt, asAt);
    if (!overdue && !dueToday) continue;
    const band: OutstandingBand = overdue ? "task_overdue" : "task_today";
    items.push({
      id: `task:${task.id}`,
      label: overdue ? `Overdue task: ${task.title}` : `Task due today: ${task.title}`,
      band,
      rank: BAND_RANK[band],
      tie: `${task.dueAt}\u0000${task.title}\u0000${task.id}`,
    });
  }

  const dueChases = input.chases
    .filter((chase) => chase.due)
    .sort((a, b) => {
      const severity = severityRank(a.severity) - severityRank(b.severity);
      if (severity !== 0) return severity;
      return OUTSTANDING_CHASE_ORDER.indexOf(a.kind) - OUTSTANDING_CHASE_ORDER.indexOf(b.kind);
    });
  for (const chase of dueChases) {
    const band = severityBand(chase.severity);
    items.push({
      id: `chase:${chase.kind}`,
      label: chase.label || chase.dueLabel,
      band,
      rank: BAND_RANK[band],
      tie: `${String(severityRank(chase.severity)).padStart(2, "0")}\u0000${String(OUTSTANDING_CHASE_ORDER.indexOf(chase.kind)).padStart(2, "0")}`,
    });
  }

  for (const step of NOT_YET_SENT) {
    if (stepMarkedSent(step.kind, events, input.chases)) continue;
    if (step.kind === "liability_response" && !awaitedLiabilityResponse(input.insurerLiabilityPosition)) continue;
    if (step.kind === "engineer_report" && input.engineeringStatus !== "not_instructed") continue;
    if (step.kind === "repair_authorisation" && !repairAuthorisationApplies(input.repairStatus, input.totalLoss)) continue;
    items.push({
      id: `unsent:${step.kind}`,
      label: step.label,
      band: "plain",
      rank: BAND_RANK.plain,
      tie: String(NOT_YET_SENT.findIndex((row) => row.kind === step.kind)).padStart(2, "0"),
    });
  }

  items.sort((a, b) => a.rank - b.rank || a.tie.localeCompare(b.tie));
  return items.map(({ id, label, band }) => ({ id, label, band }));
}

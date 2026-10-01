import type { ChaseView } from "./chase";
import { listChasesForClaim } from "./chase";
import { listFollowUpChases } from "./follow-up-chases";
import { getClaim } from "./queries";
import { buildOutstanding, type OutstandingItem } from "../domain/outstanding";

export function outstandingForClaim(claimId: string, asAt?: Date): OutstandingItem[] {
  const data = getClaim(claimId);
  if (!data) return [];
  const at = asAt ? asAt.toISOString() : undefined;
  const chases = [
    ...listChasesForClaim(claimId, at),
    ...listFollowUpChases(at, claimId).filter((chase) => chase.due),
  ];
  return buildOutstanding({
    tasks: data.tasks.map((task) => ({
      id: String(task.id),
      title: String(task.title || ""),
      dueAt: task.due_at ? String(task.due_at) : null,
      status: String(task.status || ""),
    })),
    chases: chases.map(chaseInput),
    eventTypes: data.events.map((event) => String(event.event_type)),
    insurerLiabilityPosition: data.claim.insurer_liability_position ? String(data.claim.insurer_liability_position) : null,
    engineeringStatus: data.claim.engineering_status ? String(data.claim.engineering_status) : null,
    repairStatus: data.claim.repair_status ? String(data.claim.repair_status) : null,
    totalLoss: Number(data.claim.total_loss) === 1,
    asAt,
  });
}

function chaseInput(chase: ChaseView) {
  return {
    kind: chase.kind,
    due: chase.due,
    label: chase.label,
    dueLabel: chase.dueLabel,
    severity: chase.severity,
    reason: chase.reason,
  };
}

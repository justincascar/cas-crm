import { nowUtcIso } from "../dates";
import { eventLabel } from "../domain/events";
import type { ChaseKind } from "../domain/chase";
import { chaseForClaim, chaseRow, startChase } from "./chase";
import { recordClaimEvent } from "./chronology";
import { all, run } from "./connection";

/** Repair steps that may already be on a file when the car is changed to a total loss. */
const REPAIR_STEP_EVENTS = [
  "engineer_report_sent_to_insurer",
  "repair_authorisation_requested",
  "repairs_authorised",
  "repairs_started",
  "repairs_complete",
] as const;

const REPAIR_CHASES: ChaseKind[] = ["repair_authorisation", "repair_payment"];

export const REPAIR_STEPS_CLOSED_EVENT = "repair_steps_closed_total_loss";

/**
 * A repairable file changed to a total loss mid-claim (J11). The repair steps already recorded stay in the history,
 * are closed with a reason, and the repair chases stop. The total-loss figures, the total-loss hire end (7 days after a
 * qualifying payment, confirmed by a handler) and the storage end review apply from here. Nothing is deleted.
 */
export function closeRepairStepsForTotalLoss(claimId: string, actorId: string) {
  const marks = REPAIR_STEP_EVENTS.map(() => "?").join(", ");
  const recorded = all<{ event_type: string }>(
    `SELECT DISTINCT event_type FROM claim_events WHERE claim_id = ? AND event_type IN (${marks})`,
    [claimId, ...REPAIR_STEP_EVENTS],
  ).map((row) => row.event_type);
  if (recorded.length === 0) return;
  run(`UPDATE claims SET later_declared_total_loss = 1 WHERE id = ?`, [claimId]);
  const stopped: string[] = [];
  for (const kind of REPAIR_CHASES) {
    const view = chaseForClaim(kind, claimId);
    if (!view?.clockAt) continue;
    // A chase worked out from the history has no row yet; one is written so the cancellation sticks.
    const row = chaseRow(claimId, kind) || (startChase(kind, claimId, view.clockAt), chaseRow(claimId, kind));
    if (!row || row.status === "cancelled") continue;
    run(`UPDATE automations SET paused = 1, status = 'cancelled', last_outcome = 'cancelled', reason = ? WHERE id = ?`, [
      "Closed: the car was changed to a total loss. The total-loss payment chase applies instead.",
      row.id,
    ]);
    stopped.push(kind === "repair_authorisation" ? "repair authorisation chase" : "repair payment chase");
  }
  const steps = REPAIR_STEP_EVENTS.filter((type) => recorded.includes(type)).map((type) => eventLabel(type).toLowerCase());
  recordClaimEvent({
    claimId,
    eventType: REPAIR_STEPS_CLOSED_EVENT,
    occurredAt: nowUtcIso(),
    actorId,
    details: `Changed to a total loss. The repair steps already on the file (${steps.join("; ")}) are kept in the history and closed.${
      stopped.length ? ` The ${stopped.join(" and ")} stopped.` : ""
    } Total-loss rules now apply: the total-loss figures, the hire end 7 days after a qualifying payment once a handler confirms it, and a storage end review.`,
    source: "staff",
  });
}

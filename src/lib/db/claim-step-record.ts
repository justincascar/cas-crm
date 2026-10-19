import { isOfficeRole } from "../auth/roles";
import { isClaimStepKey, type ClaimStepKey } from "../domain/claim-steps";
import { utcFromLondonDateTime } from "../dates";
import { recordClaimEvent } from "./chronology";

function requireDay(value: string, label: string): string {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Enter ${label}.`);
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new Error(`Enter ${label}.`);
  }
  return utcFromLondonDateTime(`${day}T09:00`);
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

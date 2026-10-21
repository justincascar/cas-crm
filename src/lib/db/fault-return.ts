import { canReleaseWithoutExcess } from "../auth/roles";
import { get } from "./connection";
import { listStaffPermissions } from "./permissions";

/**
 * A fault claim's car cannot be returned until the excess is on the history.
 * releaseWithoutExcess is read from staff_permissions for this staff id.
 * The role is loaded and is not a grant. The username is not read.
 */
export function assertFaultCarReturn(input: { claimId: string; actorId: string; releaseReason?: string }) {
  const claim = get<{ claim_type: string | null }>(`SELECT claim_type FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim || claim.claim_type !== "fault") return;
  const paid = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'excess_paid' LIMIT 1`,
    [input.claimId],
  );
  if (paid) return;
  const staff = get<{ role: string | null }>(`SELECT role FROM staff WHERE id = ?`, [input.actorId]);
  const allowed = canReleaseWithoutExcess({
    role: staff?.role,
    permissions: listStaffPermissions(input.actorId),
  });
  if (!allowed) {
    throw new Error("The excess has to be recorded as paid before the car is returned.");
  }
  if (!String(input.releaseReason || "").trim()) {
    throw new Error("Enter a reason to return the car before the excess is paid.");
  }
}

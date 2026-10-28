import { formatUkDateTime, londonDateIso } from "../dates";
import { CHOOSE_CAR_BEFORE_HANDOVER } from "../domain/hire-availability";
import { get, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { recordSignedAgreementOnHire } from "./hire-readiness";

export function activeReservationFor(claimId: string) {
  return get<{ id: string; fleet_vehicle_id: string; status: string }>(
    `SELECT id, fleet_vehicle_id, status FROM reservations
     WHERE claim_id = ? AND status IN ('reserved', 'active')
     ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
}

export function assertReservationForHandover(claimId: string): { id: string; fleet_vehicle_id: string } {
  const reservation = activeReservationFor(claimId);
  const started = get<{ id: string; started_at: string | null }>(
    `SELECT id, started_at FROM hire_episodes
     WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL
     ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC
     LIMIT 1`,
    [claimId],
  );
  if (!reservation && !started?.started_at) throw new Error(CHOOSE_CAR_BEFORE_HANDOVER);
  if (!reservation && !started) throw new Error(CHOOSE_CAR_BEFORE_HANDOVER);
  return reservation || { id: "", fleet_vehicle_id: String(started?.id || "") };
}

/**
 * Hire starts on the handover date. A reservation does not call this.
 * A second call does not write another Hire started event or move the start date.
 */
export function startHireFromHandover(input: {
  claimId: string;
  occurredAt: string;
  actorId: string;
  hireEpisodeId?: string | null;
}): { startedAt: string; already: boolean } {
  const episode = input.hireEpisodeId
    ? get<{ id: string; fleet_vehicle_id: string | null; started_at: string | null; credit_hire: number }>(
        `SELECT id, fleet_vehicle_id, started_at, credit_hire FROM hire_episodes WHERE id = ? AND claim_id = ?`,
        [input.hireEpisodeId, input.claimId],
      )
    : get<{ id: string; fleet_vehicle_id: string | null; started_at: string | null; credit_hire: number }>(
        `SELECT id, fleet_vehicle_id, started_at, credit_hire FROM hire_episodes
         WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL
         ORDER BY CASE WHEN started_at IS NULL THEN 0 ELSE 1 END, started_at DESC
         LIMIT 1`,
        [input.claimId],
      );
  if (!episode?.fleet_vehicle_id) throw new Error(CHOOSE_CAR_BEFORE_HANDOVER);
  if (!activeReservationFor(input.claimId) && !episode.started_at) throw new Error(CHOOSE_CAR_BEFORE_HANDOVER);
  if (episode.started_at) return { startedAt: episode.started_at, already: true };
  const when = input.occurredAt;
  run(`UPDATE hire_episodes SET started_at = ? WHERE id = ? AND started_at IS NULL`, [when, episode.id]);
  run(`UPDATE fleet_vehicles SET status = 'on_hire' WHERE id = ?`, [episode.fleet_vehicle_id]);
  run(
    `UPDATE reservations SET status = 'active', charges_started = ?
     WHERE claim_id = ? AND fleet_vehicle_id = ? AND status IN ('reserved', 'active')`,
    [Number(episode.credit_hire) === 1 ? 1 : 0, input.claimId, episode.fleet_vehicle_id],
  );
  const existing = get<{ id: string }>(
    `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'hire_started' LIMIT 1`,
    [input.claimId],
  );
  if (!existing) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_started",
      occurredAt: when,
      actorId: input.actorId,
      details: `Hire started on ${formatUkDateTime(when)}. The start date is the handover, not the reservation. London day ${londonDateIso(new Date(when))}.`,
      source: "staff",
    });
  }
  recordSignedAgreementOnHire(input.claimId, londonDateIso(new Date(when)));
  run(`UPDATE hire_pack_data SET date_out = ? WHERE claim_id = ? AND (date_out IS NULL OR trim(date_out) = '')`, [
    when,
    input.claimId,
  ]);
  return { startedAt: when, already: false };
}

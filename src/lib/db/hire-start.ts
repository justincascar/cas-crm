import { formatUkDateTime, londonDateIso, nowUtcIso } from "../dates";
import { CHOOSE_CAR_BEFORE_HANDOVER } from "../domain/hire-availability";
import { get, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { recordSignedAgreementOnHire } from "./hire-readiness";

/** When the client signed the hire agreement electronically, or null. A paper copy has no reliable signing time. */
export function agreementEsignedAt(claimId: string): { at: string; name: string } | null {
  try {
    const row = get<{ signed_at: string | null; signer_name: string | null }>(
      `SELECT signed_at, signer_name FROM esign_requests WHERE claim_id = ? AND status = 'signed' AND signed_at IS NOT NULL
       ORDER BY signed_at DESC LIMIT 1`,
      [claimId],
    );
    return row?.signed_at ? { at: String(row.signed_at), name: String(row.signer_name || "the client") } : null;
  } catch {
    return null;
  }
}

/** A handover cannot be recorded as happening before the agreement was signed, unless a reason is given. */
export function handoverBeforeSignatureRefusal(claimId: string, occurredAt: string, reason: string | undefined): string | null {
  const signed = agreementEsignedAt(claimId);
  // Handover times are entered to the minute, so the same minute as the signature is not earlier.
  if (!signed || occurredAt.slice(0, 16) >= signed.at.slice(0, 16) || String(reason || "").trim()) return null;
  return `The handover time is before the agreement was signed at ${formatUkDateTime(signed.at)}. Use the time the car was actually handed over, or give a reason.`;
}

/** The hire agreement's signed state, in words, for the handover record. */
export function agreementSignedWords(claimId: string, signedCopyComing = false): string {
  const esigned = agreementEsignedAt(claimId);
  if (esigned) return `Hire agreement signed electronically by ${esigned.name} on ${formatUkDateTime(esigned.at)}.`;
  if (signedCopyComing) return "Signed hire agreement uploaded with this handover.";
  const paper = get<{ created_at: string }>(
    `SELECT created_at FROM documents WHERE claim_id = ? AND document_type = 'signed_hire_agreement' ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
  if (paper) return `Signed hire agreement on file (paper copy, uploaded ${formatUkDateTime(paper.created_at)}).`;
  const override = get<{ id: string }>(
    `SELECT id FROM prehire_overrides WHERE claim_id = ? AND check_kind = 'signed_agreement' LIMIT 1`,
    [claimId],
  );
  if (override) return "Handed over without the signed agreement, under an authorised override.";
  return "";
}

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
  // The car is out, so the delivery job is done, by the person who handed it over.
  run(
    `UPDATE day_assignments SET completed_at = ?, actual_occurred_at = COALESCE(actual_occurred_at, ?), actual_driver_id = COALESCE(actual_driver_id, ?, assignee_id)
     WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL AND completed_at IS NULL`,
    [nowUtcIso(), when, input.actorId, input.claimId],
  );
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

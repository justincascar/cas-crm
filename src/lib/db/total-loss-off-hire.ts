import { formatUkDate, nowUtcIso } from "../dates";
import { salvageRequestMismatch, salvageSaleVariance } from "../domain/total-loss";
import { totalLossOffHireDecision, type TotalLossOffHireDecision } from "../domain/total-loss-off-hire";
import { TOTAL_LOSS_PAYMENT_RECEIVED_EVENT } from "../domain/follow-up-chases";
import { recordClaimEvent } from "./chronology";
import { get, run } from "./connection";
import { calendarDay } from "./storage-recovery-date";
import { getTotalLossReport, getVehicleDamageMoney } from "./total-loss";

export type TotalLossOffHireView = TotalLossOffHireDecision & { episodeId: string | null };

function ukDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

function latestPaymentAt(claimId: string): string | null {
  const row = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC LIMIT 1`,
    [claimId, TOTAL_LOSS_PAYMENT_RECEIVED_EVENT],
  );
  return row?.occurred_at ? String(row.occurred_at) : null;
}

function latestEpisode(claimId: string) {
  return get<{ id: string; billing_end_at: string | null; rate_pence_per_day: number | null }>(
    `SELECT id, billing_end_at, rate_pence_per_day FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`,
    [claimId],
  );
}

function keptSuggestionDay(claimId: string): string | null {
  const row = get<{ details: string | null }>(
    `SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'hire_end_date_confirmed' AND details LIKE 'Kept the hire end%'
     ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const match = String(row?.details || "").match(/suggested (\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

export function totalLossOffHireForClaim(claimId: string): TotalLossOffHireView | null {
  const claim = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [claimId]);
  if (!claim || Number(claim.total_loss) !== 1) return null;
  const money = getVehicleDamageMoney(claimId);
  const report = getTotalLossReport(claimId);
  const variance = report.disposal === "sold" ? salvageSaleVariance(report.salvagePence, report.saleProceedsPence) : null;
  const episode = latestEpisode(claimId);
  const decision = totalLossOffHireDecision({
    agreedPence: money.agreedPence,
    receivedPence: money.receivedPence,
    paymentAt: latestPaymentAt(claimId),
    salvageVariancePence: variance,
    salvageMismatch: salvageRequestMismatch(report.casRequest, report.interest),
    existingHireEndDay: calendarDay(episode?.billing_end_at),
    keptSuggestionDay: keptSuggestionDay(claimId),
  });
  return { ...decision, episodeId: episode?.id || null };
}

export function confirmTotalLossOffHire(input: { claimId: string; actorId: string; choice: "suggested" | "keep" }) {
  const view = totalLossOffHireForClaim(input.claimId);
  if (!view || (view.kind !== "suggest" && view.kind !== "conflict")) {
    throw new Error("There is no hire-end suggestion to confirm.");
  }
  if (!view.episodeId) throw new Error("There is no hire booking on this file to put the date on.");
  const episode = latestEpisode(input.claimId);
  if (!episode || episode.id !== view.episodeId) throw new Error("The hire booking could not be found.");
  const storageBefore = get<{ storage_billing_end_on: string | null; storage_rate_pence: number | null }>(
    `SELECT storage_billing_end_on, storage_rate_pence FROM claims WHERE id = ?`,
    [input.claimId],
  );
  if (input.choice === "keep") {
    if (view.kind !== "conflict") throw new Error("There is no existing hire end to keep.");
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_end_date_confirmed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Kept the hire end already on the file (${view.existingDate}). The suggested ${view.suggestedDate} was not used. Storage was not changed.`,
      source: "staff",
    });
    return;
  }
  const date = view.kind === "suggest" ? view.date : view.suggestedDate;
  run(`UPDATE hire_episodes SET billing_end_at = ? WHERE id = ?`, [date, episode.id]);
  const storageAfter = get<{ storage_billing_end_on: string | null; storage_rate_pence: number | null }>(
    `SELECT storage_billing_end_on, storage_rate_pence FROM claims WHERE id = ?`,
    [input.claimId],
  );
  if (
    storageAfter?.storage_billing_end_on !== storageBefore?.storage_billing_end_on ||
    storageAfter?.storage_rate_pence !== storageBefore?.storage_rate_pence
  ) {
    throw new Error("Storage was changed. That must not happen.");
  }
  const rateAfter = latestEpisode(input.claimId);
  if (rateAfter?.rate_pence_per_day !== episode.rate_pence_per_day) {
    throw new Error("The hire rate was changed. That must not happen.");
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_end_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff confirmed hire ends on ${ukDay(date)}, seven days after the total-loss payment. This is a CAS charging default, not a legal rule. Storage and the daily rate were left as they are.`,
    source: "staff",
  });
}

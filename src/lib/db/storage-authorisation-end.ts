import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import {
  hireReturnGap,
  manualStorageEndRefusal,
  repairAuthorisationState,
  storageAuthorisationEndDecision,
  storageChargeHasEnded,
  type HireReturnGap,
  type StorageAuthorisationEnd,
} from "../domain/storage-authorisation-end";
import { recordClaimEvent } from "./chronology";
import { get, all, run } from "./connection";
import { calendarDay } from "./storage-recovery-date";

function ukDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

type ClaimEndRow = {
  total_loss: number | null;
  storage_billing_end_on: string | null;
  storage_status: string | null;
  storage_rate_pence: number | null;
  storage_authorisation_review: string | null;
};

function readClaim(claimId: string) {
  return get<ClaimEndRow>(
    `SELECT total_loss, storage_billing_end_on, storage_status, storage_rate_pence, storage_authorisation_review
     FROM claims WHERE id = ?`,
    [claimId],
  );
}

export function repairAuthorisationForClaim(claimId: string) {
  const events = all<{ id: string; event_type: string; occurred_at: string }>(
    `SELECT id, event_type, occurred_at FROM claim_events
     WHERE claim_id = ? AND event_type IN ('repairs_authorised', 'repairs_authorised_cleared')
     ORDER BY occurred_at ASC, id ASC`,
    [claimId],
  );
  return repairAuthorisationState(events, (occurredAt) => calendarDay(occurredAt));
}

function keptSuggestionDay(claimId: string): string | null {
  const row = get<{ details: string | null }>(
    `SELECT details FROM claim_events
     WHERE claim_id = ? AND event_type = 'storage_end_date_confirmed' AND details LIKE 'Kept the storage end%'
     ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const match = String(row?.details || "").match(/suggested (\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

/** Read-only. Does not write a storage end. */
export function storageAuthorisationEndForClaim(claimId: string): StorageAuthorisationEnd {
  const claim = readClaim(claimId);
  if (!claim) return { kind: "open" };
  const authorisation = repairAuthorisationForClaim(claimId);
  return storageAuthorisationEndDecision({
    totalLoss: Number(claim.total_loss) === 1,
    totalLossReview: claim.storage_authorisation_review === "total_loss",
    authorisationDay: authorisation.day,
    withdrawn: authorisation.withdrawn,
    existingEndDay: calendarDay(claim.storage_billing_end_on),
    keptSuggestionDay: keptSuggestionDay(claimId),
  });
}

export function confirmStorageAuthorisationEnd(input: {
  claimId: string;
  actorId: string;
  choice: "suggested" | "keep";
}) {
  const view = storageAuthorisationEndForClaim(input.claimId);
  if (view.kind !== "suggest" && view.kind !== "conflict") {
    throw new Error("There is no storage-end suggestion to confirm.");
  }
  const before = readClaim(input.claimId);
  if (!before) throw new Error("File not found.");
  const hireBefore = get<{ billing_end_at: string | null; rate_pence_per_day: number | null }>(
    `SELECT billing_end_at, rate_pence_per_day FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`,
    [input.claimId],
  );
  if (input.choice === "keep") {
    if (view.kind !== "conflict") throw new Error("There is no storage end on the file to keep.");
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_end_date_confirmed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Kept the storage end already on the file (${view.existingDate}). The suggested ${view.suggestedDate} was not used.`,
      source: "staff",
    });
    return;
  }
  const date = view.kind === "suggest" ? view.date : view.suggestedDate;
  run(`UPDATE claims SET storage_billing_end_on = ?, storage_authorisation_review = NULL WHERE id = ?`, [date, input.claimId]);
  const after = readClaim(input.claimId);
  const hireAfter = get<{ billing_end_at: string | null; rate_pence_per_day: number | null }>(
    `SELECT billing_end_at, rate_pence_per_day FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`,
    [input.claimId],
  );
  if (after?.storage_status !== before.storage_status || after?.storage_rate_pence !== before.storage_rate_pence) {
    throw new Error("Storage status or the daily rate was changed. That must not happen.");
  }
  if (
    hireAfter?.billing_end_at !== hireBefore?.billing_end_at ||
    hireAfter?.rate_pence_per_day !== hireBefore?.rate_pence_per_day
  ) {
    throw new Error("Hire was changed. That must not happen.");
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_end_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff confirmed storage ends on ${ukDay(date)}, the date repair authorisation was recorded. The vehicle can stay at CAS after this. The daily rate was left as it is.`,
    source: "staff",
  });
}

/**
 * When a repairable file is marked a total loss, flag a proposed or confirmed storage end.
 * The stored date is not changed.
 */
export function flagStorageEndOnTotalLoss(claimId: string, actorId: string) {
  const claim = readClaim(claimId);
  if (!claim || claim.storage_authorisation_review === "total_loss") return;
  const authorisation = repairAuthorisationForClaim(claimId);
  const existingEnd = calendarDay(claim.storage_billing_end_on);
  if (!authorisation.day && !authorisation.withdrawn && !existingEnd) return;
  run(`UPDATE claims SET storage_authorisation_review = 'total_loss' WHERE id = ?`, [claimId]);
  const after = readClaim(claimId);
  if (calendarDay(after?.storage_billing_end_on) !== existingEnd) {
    throw new Error("The storage end was changed when the file was marked a total loss. That must not happen.");
  }
  recordClaimEvent({
    claimId,
    eventType: "storage_end_date_review",
    occurredAt: nowUtcIso(),
    actorId,
    details: existingEnd
      ? `This file was marked a total loss. Storage end on the file is ${ukDay(existingEnd)}. That date was not changed. It needs review. Total-loss rules apply from here.`
      : "This file was marked a total loss. The proposed repair storage end was not applied. Storage stays open until it is reviewed. Total-loss rules apply from here.",
    source: "staff",
  });
}

export function storageEndManualMessage(claimId: string, typedEnd: string, reason: string): string | null {
  const claim = readClaim(claimId);
  if (!claim || Number(claim.total_loss) === 1) return null;
  const authorisation = repairAuthorisationForClaim(claimId);
  return manualStorageEndRefusal({
    authorisationDay: authorisation.day,
    existingEndDay: calendarDay(claim.storage_billing_end_on),
    typedEndDay: calendarDay(typedEnd),
    reason,
  });
}

export function recordManualStorageEndReason(input: {
  claimId: string;
  actorId: string;
  typedEnd: string;
  reason: string;
}) {
  const authorisation = repairAuthorisationForClaim(input.claimId);
  const typed = calendarDay(input.typedEnd);
  if (!authorisation.day || typed === authorisation.day) return;
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_end_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff set the storage end to ${typed ? ukDay(typed) : "no end date"}, which is not the repair authorisation date ${ukDay(authorisation.day)}. Reason: ${input.reason.trim()}.`,
    source: "staff",
  });
  run(`UPDATE claims SET storage_authorisation_review = NULL WHERE id = ?`, [input.claimId]);
}

export type HireGapView = {
  returnedDay: string;
  collectedDay: string;
  gap: HireReturnGap | null;
};

export function hireGapForClaim(claimId: string): HireGapView | null {
  const returned = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = 'vehicle_returned' ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const collected = get<{ collection_at: string | null }>(
    `SELECT collection_at FROM hire_episodes WHERE claim_id = ? AND collection_at IS NOT NULL AND trim(collection_at) != ''
     ORDER BY started_at DESC LIMIT 1`,
    [claimId],
  );
  const returnedDay = calendarDay(returned?.occurred_at);
  const collectedDay = calendarDay(collected?.collection_at);
  if (!returnedDay || !collectedDay) return null;
  return { returnedDay, collectedDay, gap: hireReturnGap(returnedDay, collectedDay) };
}

export function claimStorageChargeEnded(claimId: string, today = londonTodayIso()): boolean {
  const claim = readClaim(claimId);
  if (!claim || claim.storage_status !== "active") return false;
  return storageChargeHasEnded(calendarDay(claim.storage_billing_end_on), today);
}

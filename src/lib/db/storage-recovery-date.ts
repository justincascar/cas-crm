import { formatUkDate, londonDateIso, nowUtcIso } from "../dates";
import { get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";

export type StorageDateReview = {
  jobDate: string;
  storageDay: string | null;
  recoveryDay: string | null;
};

export type ApplyRecoveryDateResult =
  | { status: "applied" | "already_matches"; date: string }
  | { status: "review"; review: StorageDateReview };

/** A stored recovery or storage date, as a Europe/London calendar day. */
export function calendarDay(value: string | null | undefined): string | null {
  const text = (value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

function ukDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

function readDates(claimId: string) {
  const claim = get<{
    storage_started_on: string | null;
    storage_status: string | null;
    storage_rate_pence: number | null;
    recovery_status: string | null;
    storage_date_review_on: string | null;
  }>(
    `SELECT storage_started_on, storage_status, storage_rate_pence, recovery_status, storage_date_review_on
     FROM claims WHERE id = ?`,
    [claimId],
  );
  const recovery = get<{ id: string; recovered_at: string | null; charge_pence: number | null }>(
    `SELECT id, recovered_at, charge_pence FROM recovery_jobs WHERE claim_id = ? ORDER BY id LIMIT 1`,
    [claimId],
  );
  return { claim, recovery };
}

function writeStorageStart(claimId: string, day: string, status: string | null) {
  const nextStatus = !status || status === "none" ? "active" : status;
  run(`UPDATE claims SET storage_started_on = ?, storage_status = ? WHERE id = ?`, [day, nextStatus, claimId]);
}

function writeRecoveredAt(claimId: string, day: string, recoveryId: string | null, recoveryStatus: string | null) {
  if (recoveryId) {
    run(`UPDATE recovery_jobs SET recovered_at = ? WHERE id = ?`, [day, recoveryId]);
  } else {
    run(
      `INSERT INTO recovery_jobs(
        id, claim_id, recovered_at, charge_pence, winch_pence, ooh_pence, environmental_pence,
        forklift_pence, mileage_pence, manual_pence, inherited
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [newId("rec"), claimId, day],
    );
  }
  if (!recoveryStatus || recoveryStatus === "none" || recoveryStatus === "required") {
    run(`UPDATE claims SET recovery_status = 'completed' WHERE id = ?`, [claimId]);
  }
}

/**
 * Use the actual date from a completed "Recover client's vehicle" job as the storage start,
 * unless a recovery date or storage start is already on the file and falls on a different day.
 * Rates and VAT are not touched.
 */
export function applyClientRecoveryActualDate(input: {
  claimId: string;
  actualOccurredAt: string;
  actorId: string;
}): ApplyRecoveryDateResult {
  const jobDate = calendarDay(input.actualOccurredAt);
  if (!jobDate) throw new Error("Enter the date and time this happened.");
  const { claim, recovery } = readDates(input.claimId);
  if (!claim) throw new Error("File not found.");
  const storageDay = calendarDay(claim.storage_started_on);
  const recoveryDay = calendarDay(recovery?.recovered_at);
  const storageDiffers = Boolean(storageDay && storageDay !== jobDate);
  const recoveryDiffers = Boolean(recoveryDay && recoveryDay !== jobDate);
  if (storageDiffers || recoveryDiffers) {
    run(`UPDATE claims SET storage_date_review_on = ? WHERE id = ?`, [jobDate, input.claimId]);
    const parts = [`The Recover client's vehicle job says ${ukDay(jobDate)}.`];
    if (storageDay) parts.push(`Storage start on the file is ${ukDay(storageDay)}.`);
    if (recoveryDay) parts.push(`The Recovery screen date is ${ukDay(recoveryDay)}.`);
    parts.push("Neither date was changed. A person needs to choose which day storage is charged from. This is a CAS charging check, not a legal conclusion.");
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_recovery_date_review",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: parts.join(" "),
      source: "staff",
    });
    return { status: "review", review: { jobDate, storageDay, recoveryDay } };
  }

  let wroteStorage = false;
  if (!storageDay) {
    writeStorageStart(input.claimId, jobDate, claim.storage_status);
    wroteStorage = true;
  }
  if (!recoveryDay) writeRecoveredAt(input.claimId, jobDate, recovery?.id || null, claim.recovery_status);
  run(`UPDATE claims SET storage_date_review_on = NULL WHERE id = ?`, [input.claimId]);
  if (wroteStorage) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_started",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: `Storage starts on ${ukDay(jobDate)}, the day the vehicle was recovered. Taken from the Recover client's vehicle job. Billing end is not set automatically. This is a CAS charging rule for a person to check, not a legal conclusion.`,
      source: "staff",
    });
    return { status: "applied", date: jobDate };
  }
  return { status: "already_matches", date: jobDate };
}

export function getStorageDateReview(claimId: string): StorageDateReview | null {
  const { claim, recovery } = readDates(claimId);
  const jobDate = calendarDay(claim?.storage_date_review_on);
  if (!claim || !jobDate) return null;
  const storageDay = calendarDay(claim.storage_started_on);
  const recoveryDay = calendarDay(recovery?.recovered_at);
  const storageDiffers = Boolean(storageDay && storageDay !== jobDate);
  const recoveryDiffers = Boolean(recoveryDay && recoveryDay !== jobDate);
  if (!storageDiffers && !recoveryDiffers) {
    if (!storageDay) writeStorageStart(claimId, jobDate, claim.storage_status);
    if (!recoveryDay) writeRecoveredAt(claimId, jobDate, recovery?.id || null, claim.recovery_status);
    run(`UPDATE claims SET storage_date_review_on = NULL WHERE id = ?`, [claimId]);
    return null;
  }
  return { jobDate, storageDay, recoveryDay };
}

export function confirmStorageRecoveryDate(input: { claimId: string; choice: "job" | "file"; actorId: string }) {
  const { claim, recovery } = readDates(input.claimId);
  if (!claim) throw new Error("File not found.");
  const jobDate = calendarDay(claim.storage_date_review_on);
  if (!jobDate) return;
  const storageDay = calendarDay(claim.storage_started_on);
  const recoveryDay = calendarDay(recovery?.recovered_at);
  if (input.choice === "job") {
    writeStorageStart(input.claimId, jobDate, claim.storage_status);
    writeRecoveredAt(input.claimId, jobDate, recovery?.id || null, claim.recovery_status);
    run(`UPDATE claims SET storage_date_review_on = NULL WHERE id = ?`, [input.claimId]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_recovery_date_confirmed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Staff confirmed storage is charged from ${ukDay(jobDate)}, the day on the Recover client's vehicle job. The daily rate was not changed.`,
      source: "staff",
    });
    return;
  }
  if (!storageDay && recoveryDay) writeStorageStart(input.claimId, recoveryDay, claim.storage_status);
  run(`UPDATE claims SET storage_date_review_on = NULL WHERE id = ?`, [input.claimId]);
  const keptDay = storageDay || recoveryDay;
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_recovery_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff kept ${keptDay ? ukDay(keptDay) : "the date already on the file"}. The recovery job date ${ukDay(jobDate)} was not applied. The daily rate was not changed.`,
    source: "staff",
  });
}

export type StorageEndDateReview = {
  jobDate: string;
  storageEndDay: string | null;
};

export type ApplyStorageEndResult =
  | { status: "applied" | "already_matches"; date: string }
  | { status: "review"; review: StorageEndDateReview };

function readStorageEnd(claimId: string) {
  return get<{
    storage_billing_end_on: string | null;
    storage_end_review_on: string | null;
    storage_rate_pence: number | null;
  }>(
    `SELECT storage_billing_end_on, storage_end_review_on, storage_rate_pence
     FROM claims WHERE id = ?`,
    [claimId],
  );
}

function writeStorageEnd(claimId: string, day: string) {
  run(`UPDATE claims SET storage_billing_end_on = ? WHERE id = ?`, [day, claimId]);
}

/**
 * Use the actual date from a completed "Return client's vehicle after repair" job as the storage end,
 * unless a storage end date is already on the file and falls on a different day.
 * Rates, VAT and the hire end date are not touched.
 */
export function applyClientReturnActualDate(input: {
  claimId: string;
  actualOccurredAt: string;
  actorId: string;
}): ApplyStorageEndResult {
  const jobDate = calendarDay(input.actualOccurredAt);
  if (!jobDate) throw new Error("Enter the date and time this happened.");
  const claim = readStorageEnd(input.claimId);
  if (!claim) throw new Error("File not found.");
  const storageEndDay = calendarDay(claim.storage_billing_end_on);
  if (storageEndDay && storageEndDay !== jobDate) {
    run(`UPDATE claims SET storage_end_review_on = ? WHERE id = ?`, [jobDate, input.claimId]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_end_date_review",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: `The Return client's vehicle after repair job says ${ukDay(jobDate)}. Storage end on the file is ${ukDay(storageEndDay)}. The end date was left as it is. A person needs to choose which day storage stops. This is a CAS charging check, not a legal conclusion.`,
      source: "staff",
    });
    return { status: "review", review: { jobDate, storageEndDay } };
  }
  if (!storageEndDay) {
    writeStorageEnd(input.claimId, jobDate);
    run(`UPDATE claims SET storage_end_review_on = NULL WHERE id = ?`, [input.claimId]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_ended",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: `Storage ends on ${ukDay(jobDate)}, the day the client's vehicle was returned after repair. Taken from the Return client's vehicle after repair job. The daily rate was left as it is. This is a CAS charging rule for a person to check, not a legal conclusion.`,
      source: "staff",
    });
    return { status: "applied", date: jobDate };
  }
  run(`UPDATE claims SET storage_end_review_on = NULL WHERE id = ?`, [input.claimId]);
  return { status: "already_matches", date: jobDate };
}

export function getStorageEndDateReview(claimId: string): StorageEndDateReview | null {
  const claim = readStorageEnd(claimId);
  const jobDate = calendarDay(claim?.storage_end_review_on);
  if (!claim || !jobDate) return null;
  const storageEndDay = calendarDay(claim.storage_billing_end_on);
  if (!storageEndDay || storageEndDay === jobDate) {
    if (!storageEndDay) writeStorageEnd(claimId, jobDate);
    run(`UPDATE claims SET storage_end_review_on = NULL WHERE id = ?`, [claimId]);
    return null;
  }
  return { jobDate, storageEndDay };
}

export function confirmStorageEndDate(input: { claimId: string; choice: "job" | "file"; actorId: string }) {
  const claim = readStorageEnd(input.claimId);
  if (!claim) throw new Error("File not found.");
  const jobDate = calendarDay(claim.storage_end_review_on);
  if (!jobDate) return;
  const storageEndDay = calendarDay(claim.storage_billing_end_on);
  if (input.choice === "job") {
    writeStorageEnd(input.claimId, jobDate);
    run(`UPDATE claims SET storage_end_review_on = NULL WHERE id = ?`, [input.claimId]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "storage_end_date_confirmed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Staff confirmed storage ends on ${ukDay(jobDate)}, the day on the Return client's vehicle after repair job. The daily rate was left as it is.`,
      source: "staff",
    });
    return;
  }
  run(`UPDATE claims SET storage_end_review_on = NULL WHERE id = ?`, [input.claimId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_end_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff kept ${storageEndDay ? ukDay(storageEndDay) : "the storage end date already on the file"}. The return job date ${ukDay(jobDate)} was left unused. The daily rate was left as it is.`,
    source: "staff",
  });
}

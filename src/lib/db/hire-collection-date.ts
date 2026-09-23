import { formatUkDate, nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { all, get, run } from "./connection";
import { calendarDay } from "./storage-recovery-date";

export type HireEndDateReview = {
  episodeId: string;
  jobDate: string;
  hireEndDay: string | null;
};

export type ApplyHireEndResult =
  | { status: "applied" | "already_matches"; date: string }
  | { status: "review"; review: HireEndDateReview }
  | { status: "skipped" };

function ukDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

type EpisodeRow = {
  id: string;
  claim_id: string;
  billing_end_at: string | null;
  hire_end_review_on: string | null;
  rate_pence_per_day: number | null;
};

function readClaim(claimId: string) {
  return get<{ id: string; total_loss: number | null }>(
    `SELECT id, total_loss FROM claims WHERE id = ?`,
    [claimId],
  );
}

function readEpisode(episodeId: string) {
  return get<EpisodeRow>(
    `SELECT id, claim_id, billing_end_at, hire_end_review_on, rate_pence_per_day
     FROM hire_episodes WHERE id = ?`,
    [episodeId],
  );
}

function writeHireEnd(episodeId: string, day: string) {
  run(`UPDATE hire_episodes SET billing_end_at = ?, hire_end_review_on = NULL WHERE id = ?`, [day, episodeId]);
}

function clearReview(episodeId: string) {
  run(`UPDATE hire_episodes SET hire_end_review_on = NULL WHERE id = ?`, [episodeId]);
}

/**
 * Use the actual date from a completed "Hire car collection" job as the hire end
 * on that booking, unless a hire end date is already there and falls on a different day.
 * The daily rate, storage dates and the total-loss scheduled off-hire date are not touched.
 * A total-loss file is left alone: its hire end is a separate pathway.
 */
export function applyHireCollectionActualDate(input: {
  claimId: string;
  hireEpisodeId: string | null;
  actualOccurredAt: string;
  actorId: string;
}): ApplyHireEndResult {
  const episodeId = (input.hireEpisodeId || "").trim();
  if (!episodeId) return { status: "skipped" };
  const jobDate = calendarDay(input.actualOccurredAt);
  if (!jobDate) throw new Error("Enter the date and time this happened.");
  const claim = readClaim(input.claimId);
  if (!claim) throw new Error("File not found.");
  if (Number(claim.total_loss) === 1) return { status: "skipped" };
  const episode = readEpisode(episodeId);
  if (!episode || episode.claim_id !== input.claimId) return { status: "skipped" };
  const hireEndDay = calendarDay(episode.billing_end_at);
  if (hireEndDay && hireEndDay !== jobDate) {
    run(`UPDATE hire_episodes SET hire_end_review_on = ? WHERE id = ?`, [jobDate, episode.id]);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_end_date_review",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: `The Hire car collection job says ${ukDay(jobDate)}. Hire end on the file is ${ukDay(hireEndDay)}. The end date was left as it is. A person needs to choose which day hire stops. This is a CAS charging check, not a legal conclusion. The daily rate was left as it is.`,
      source: "staff",
    });
    return { status: "review", review: { episodeId: episode.id, jobDate, hireEndDay } };
  }
  if (!hireEndDay) {
    writeHireEnd(episode.id, jobDate);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_ended",
      occurredAt: input.actualOccurredAt,
      actorId: input.actorId,
      details: `Hire ends on ${ukDay(jobDate)}, the day the hire car was collected. Taken from the Hire car collection job. The daily rate was left as it is. This is a CAS charging rule for a person to check, not a legal conclusion.`,
      source: "staff",
    });
    return { status: "applied", date: jobDate };
  }
  clearReview(episode.id);
  return { status: "already_matches", date: jobDate };
}

export function getHireEndDateReviews(claimId: string): HireEndDateReview[] {
  const rows = all<EpisodeRow>(
    `SELECT id, claim_id, billing_end_at, hire_end_review_on, rate_pence_per_day
     FROM hire_episodes WHERE claim_id = ? AND hire_end_review_on IS NOT NULL`,
    [claimId],
  );
  const open: HireEndDateReview[] = [];
  for (const episode of rows) {
    const jobDate = calendarDay(episode.hire_end_review_on);
    if (!jobDate) continue;
    const hireEndDay = calendarDay(episode.billing_end_at);
    if (!hireEndDay || hireEndDay === jobDate) {
      if (!hireEndDay) writeHireEnd(episode.id, jobDate);
      else clearReview(episode.id);
      continue;
    }
    open.push({ episodeId: episode.id, jobDate, hireEndDay });
  }
  return open;
}

export function confirmHireEndDate(input: {
  claimId: string;
  episodeId: string;
  choice: "job" | "file";
  actorId: string;
}) {
  const episode = readEpisode(input.episodeId);
  if (!episode || episode.claim_id !== input.claimId) return;
  const jobDate = calendarDay(episode.hire_end_review_on);
  if (!jobDate) return;
  const hireEndDay = calendarDay(episode.billing_end_at);
  if (input.choice === "job") {
    writeHireEnd(episode.id, jobDate);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_end_date_confirmed",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Staff confirmed hire ends on ${ukDay(jobDate)}, the day on the Hire car collection job. The daily rate was left as it is.`,
      source: "staff",
    });
    return;
  }
  clearReview(episode.id);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_end_date_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff kept ${hireEndDay ? ukDay(hireEndDay) : "the hire end date already on the file"}. The collection job date ${ukDay(jobDate)} was left unused. The daily rate was left as it is.`,
    source: "staff",
  });
}

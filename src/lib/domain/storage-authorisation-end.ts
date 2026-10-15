export type RepairAuthorisationState = {
  day: string | null;
  withdrawn: boolean;
};

export type StorageEndBasis = "authorisation" | "repairs_started";

/** Shown when a stored end is later than repairs started. The stored date is not changed. */
export const STORAGE_END_AFTER_REPAIRS_STARTED = "Storage end is after repairs started, review";

export type StorageAuthorisationEnd =
  | { kind: "open" }
  | { kind: "suggest"; date: string; basis: StorageEndBasis; earlierThanAuthorisation: boolean }
  | { kind: "matches"; date: string; basis: StorageEndBasis; earlierThanAuthorisation: boolean }
  | { kind: "conflict"; suggestedDate: string; existingDate: string; basis: StorageEndBasis; earlierThanAuthorisation: boolean }
  | { kind: "kept"; date: string; suggestedDate: string; basis: StorageEndBasis; earlierThanAuthorisation: boolean }
  | { kind: "review"; reasons: string[]; existingDate: string | null; suggestedDate: string | null };

/**
 * The earlier of repairs started and repair authorisation. Either date alone is the proposal.
 * A later date that is after the earlier one does not move an unconfirmed proposal.
 */
export function repairStorageEndProposal(
  authorisationDay: string | null,
  repairsStartedDay: string | null,
): { date: string; basis: StorageEndBasis; earlierThanAuthorisation: boolean } | null {
  if (authorisationDay && repairsStartedDay) {
    if (repairsStartedDay < authorisationDay) {
      return { date: repairsStartedDay, basis: "repairs_started", earlierThanAuthorisation: true };
    }
    return { date: authorisationDay, basis: "authorisation", earlierThanAuthorisation: false };
  }
  if (repairsStartedDay) return { date: repairsStartedDay, basis: "repairs_started", earlierThanAuthorisation: false };
  if (authorisationDay) return { date: authorisationDay, basis: "authorisation", earlierThanAuthorisation: false };
  return null;
}

export function proposedStorageEndSentence(basis: StorageEndBasis, earlierThanAuthorisation = false): string {
  const tail =
    "Storage is charged up to that date only after you confirm it. Nothing has been written yet. The vehicle can stay at CAS after charging stops.";
  if (basis === "repairs_started" && earlierThanAuthorisation) {
    return `This is the date repairs started, which is earlier than the repair authorisation. ${tail}`;
  }
  if (basis === "repairs_started") return `This is the date repairs started. ${tail}`;
  return `This is the date repair authorisation was recorded. ${tail}`;
}

export type HireReturnGap = {
  returnedDay: string;
  collectedDay: string;
  dayCount: number;
  message: string;
};

/** Europe/London calendar-day gap. Both arguments are yyyy-MM-dd. */
export function londonCalendarDayGap(fromDay: string, toDay: string): number {
  const [fromYear, fromMonth, fromDate] = fromDay.split("-").map(Number);
  const [toYear, toMonth, toDate] = toDay.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDate) - Date.UTC(fromYear, fromMonth - 1, fromDate)) / 86_400_000);
}

/**
 * The authorisation date is the latest repairs_authorised event that has not been cleared.
 * Payment received is a different event and is ignored.
 */
export function repairAuthorisationState(
  events: Array<{ event_type: string; occurred_at: string; id?: string }>,
  asDay: (occurredAt: string) => string | null,
): RepairAuthorisationState {
  const ordered = [...events].sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  let authorisedAt: string | null = null;
  let clearedAfter = false;
  for (const event of ordered) {
    if (event.event_type === "repairs_authorised") {
      authorisedAt = event.occurred_at;
      clearedAfter = false;
    } else if (event.event_type === "repairs_authorised_cleared" && authorisedAt) {
      clearedAfter = true;
    }
  }
  if (!authorisedAt) return { day: null, withdrawn: false };
  if (clearedAfter) return { day: null, withdrawn: true };
  return { day: asDay(authorisedAt), withdrawn: false };
}

export function storageAuthorisationEndDecision(input: {
  totalLoss: boolean;
  totalLossReview: boolean;
  authorisationDay: string | null;
  repairsStartedDay?: string | null;
  withdrawn: boolean;
  existingEndDay: string | null;
  keptSuggestionDay: string | null;
}): StorageAuthorisationEnd {
  const repairsStartedDay = input.repairsStartedDay || null;
  const proposal = repairStorageEndProposal(input.authorisationDay, repairsStartedDay);
  const reasons: string[] = [];
  if (input.totalLossReview) {
    reasons.push(
      "This file was marked a total loss after repair authorisation. Any storage end proposed or confirmed for the repair does not stay in force. The date on the file has not been changed. It needs review. Total-loss rules apply from here.",
    );
  }
  if (input.withdrawn && input.existingEndDay) {
    reasons.push(
      "Repair authorisation was withdrawn or revised away. The confirmed storage end has not been changed. It needs review.",
    );
  }
  if (input.existingEndDay && repairsStartedDay && input.existingEndDay > repairsStartedDay) {
    reasons.push(STORAGE_END_AFTER_REPAIRS_STARTED);
  }
  if (reasons.length > 0) {
    return {
      kind: "review",
      reasons,
      existingDate: input.existingEndDay,
      suggestedDate: proposal?.date ?? null,
    };
  }
  if (input.totalLoss) return { kind: "open" };
  if (!proposal) return { kind: "open" };
  if (!input.existingEndDay) {
    return {
      kind: "suggest",
      date: proposal.date,
      basis: proposal.basis,
      earlierThanAuthorisation: proposal.earlierThanAuthorisation,
    };
  }
  if (input.existingEndDay === proposal.date) {
    return {
      kind: "matches",
      date: proposal.date,
      basis: proposal.basis,
      earlierThanAuthorisation: proposal.earlierThanAuthorisation,
    };
  }
  if (input.keptSuggestionDay === proposal.date) {
    return {
      kind: "kept",
      date: input.existingEndDay,
      suggestedDate: proposal.date,
      basis: proposal.basis,
      earlierThanAuthorisation: proposal.earlierThanAuthorisation,
    };
  }
  return {
    kind: "conflict",
    suggestedDate: proposal.date,
    existingDate: input.existingEndDay,
    basis: proposal.basis,
    earlierThanAuthorisation: proposal.earlierThanAuthorisation,
  };
}

export function hireReturnGap(returnedDay: string | null, collectedDay: string | null): HireReturnGap | null {
  if (!returnedDay || !collectedDay || returnedDay === collectedDay) return null;
  const signed = londonCalendarDayGap(returnedDay, collectedDay);
  const dayCount = Math.abs(signed);
  const unit = dayCount === 1 ? "day" : "days";
  const message =
    signed > 0
      ? `Hire charged ${dayCount} ${unit} beyond vehicle return`
      : `Hire collection is ${dayCount} ${unit} before the vehicle was returned`;
  return { returnedDay, collectedDay, dayCount, message };
}

/** Chargeable through the confirmed end date. The day after that end, it is no longer chargeable. */
export function storageChargeHasEnded(billingEndDay: string | null, today: string): boolean {
  if (!billingEndDay) return false;
  return billingEndDay < today;
}

export function manualStorageEndRefusal(input: {
  authorisationDay: string | null;
  repairsStartedDay?: string | null;
  existingEndDay: string | null;
  typedEndDay: string | null;
  reason: string;
}): string | null {
  const proposal = repairStorageEndProposal(input.authorisationDay, input.repairsStartedDay || null);
  if (!proposal) return null;
  const typed = input.typedEndDay;
  const existing = input.existingEndDay;
  if (typed === existing) return null;
  if (typed === proposal.date) return null;
  if (input.reason.trim()) return null;
  if (proposal.basis === "repairs_started") {
    return "This storage end date is not the date repairs started. Record a reason before saving it.";
  }
  return "This storage end date is not the repair authorisation date. Record a reason before saving it.";
}

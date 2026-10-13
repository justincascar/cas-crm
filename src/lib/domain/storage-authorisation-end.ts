export type RepairAuthorisationState = {
  day: string | null;
  withdrawn: boolean;
};

export type StorageAuthorisationEnd =
  | { kind: "open" }
  | { kind: "suggest"; date: string }
  | { kind: "matches"; date: string }
  | { kind: "conflict"; suggestedDate: string; existingDate: string }
  | { kind: "kept"; date: string; suggestedDate: string }
  | { kind: "review"; reasons: string[]; existingDate: string | null; suggestedDate: string | null };

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
  withdrawn: boolean;
  existingEndDay: string | null;
  keptSuggestionDay: string | null;
}): StorageAuthorisationEnd {
  if (input.totalLossReview) {
    return {
      kind: "review",
      reasons: [
        "This file was marked a total loss after repair authorisation. Any storage end proposed or confirmed for the repair does not stay in force. The date on the file has not been changed. It needs review. Total-loss rules apply from here.",
      ],
      existingDate: input.existingEndDay,
      suggestedDate: input.authorisationDay,
    };
  }
  if (input.totalLoss) return { kind: "open" };
  if (input.withdrawn && input.existingEndDay) {
    return {
      kind: "review",
      reasons: [
        "Repair authorisation was withdrawn or revised away. The confirmed storage end has not been changed. It needs review.",
      ],
      existingDate: input.existingEndDay,
      suggestedDate: null,
    };
  }
  if (!input.authorisationDay) return { kind: "open" };
  if (!input.existingEndDay) return { kind: "suggest", date: input.authorisationDay };
  if (input.existingEndDay === input.authorisationDay) return { kind: "matches", date: input.authorisationDay };
  if (input.keptSuggestionDay === input.authorisationDay) {
    return { kind: "kept", date: input.existingEndDay, suggestedDate: input.authorisationDay };
  }
  return { kind: "conflict", suggestedDate: input.authorisationDay, existingDate: input.existingEndDay };
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
  existingEndDay: string | null;
  typedEndDay: string | null;
  reason: string;
}): string | null {
  if (!input.authorisationDay) return null;
  const typed = input.typedEndDay;
  const existing = input.existingEndDay;
  if (typed === existing) return null;
  if (typed === input.authorisationDay) return null;
  if (input.reason.trim()) return null;
  return "This storage end date is not the repair authorisation date. Record a reason before saving it.";
}

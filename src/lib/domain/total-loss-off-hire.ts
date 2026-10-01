import { TOTAL_LOSS_HIRE_DAYS_AFTER_QUALIFYING_PAYMENT } from "../constants";
import { londonDateIso } from "../dates";

export const OFF_HIRE_REVIEW_HEADING = "Review before setting an off-hire date.";

export type TotalLossOffHireDecision =
  | { kind: "waiting" }
  | { kind: "review"; reasons: string[] }
  | { kind: "suggest"; date: string }
  | { kind: "conflict"; suggestedDate: string; existingDate: string }
  | { kind: "matches"; date: string }
  | { kind: "kept"; date: string; suggestedDate: string };

/** Seven London calendar days after the day the completing payment was recorded. */
export function suggestedHireEndDay(paymentAt: string): string | null {
  const parsed = new Date(paymentAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = londonDateIso(parsed).split("-").map(Number);
  const later = new Date(Date.UTC(year, month - 1, day + TOTAL_LOSS_HIRE_DAYS_AFTER_QUALIFYING_PAYMENT, 12));
  return londonDateIso(later);
}

/**
 * A suggestion only when the total received equals the agreed settlement and no salvage
 * dispute is still flagged. Anything else is a review, with no date. An existing hire end
 * on a different day is a conflict and is not overwritten.
 */
export function totalLossOffHireDecision(input: {
  agreedPence: number;
  receivedPence: number;
  paymentAt: string | null;
  salvageVariancePence: number | null;
  salvageMismatch: string | null;
  existingHireEndDay: string | null;
  keptSuggestionDay: string | null;
}): TotalLossOffHireDecision {
  if (input.receivedPence <= 0) return { kind: "waiting" };
  const reasons: string[] = [];
  if (input.agreedPence <= 0) {
    reasons.push("The agreed settlement is not on the file.");
  } else if (input.receivedPence !== input.agreedPence) {
    reasons.push("The amount received does not match the agreed settlement.");
  }
  if (input.salvageVariancePence != null && input.salvageVariancePence !== 0) {
    reasons.push("The salvage sale does not match the engineer's salvage figure.");
  }
  if (input.salvageMismatch) reasons.push(input.salvageMismatch);
  if (reasons.length > 0) return { kind: "review", reasons };
  if (!input.paymentAt) {
    return { kind: "review", reasons: ["The date the payment arrived is not on the file."] };
  }
  const suggested = suggestedHireEndDay(input.paymentAt);
  if (!suggested) return { kind: "review", reasons: ["The date the payment arrived is not on the file."] };
  const existing = input.existingHireEndDay;
  if (existing && existing !== suggested) {
    if (input.keptSuggestionDay === suggested) return { kind: "kept", date: existing, suggestedDate: suggested };
    return { kind: "conflict", suggestedDate: suggested, existingDate: existing };
  }
  if (existing === suggested) return { kind: "matches", date: suggested };
  return { kind: "suggest", date: suggested };
}

import { formatGbp } from "../money";
import type { InsurerSalvageInterest, SalvageDisposal } from "./total-loss";

/** Heads that can take a payment review. Storage is included here and still has no payment chase. */
export const PAYMENT_REVIEW_HEADS = ["recovery", "storage", "hire", "repairs", "vehicle_damage"] as const;
export type PaymentReviewHead = (typeof PAYMENT_REVIEW_HEADS)[number];

export const NO_INSURER_REASON = "no reason given";

export function isPaymentReviewHead(value: string): value is PaymentReviewHead {
  return (PAYMENT_REVIEW_HEADS as readonly string[]).includes(value);
}

export function insurerReasonLabel(reason: string | null | undefined): string {
  const text = String(reason ?? "").replace(/\s+/g, " ").trim();
  return text || NO_INSURER_REASON;
}

export type SalvageProceedsInput = {
  interest: InsurerSalvageInterest | null;
  salvagePence: number | null;
  saleProceedsPence: number | null;
  disposal: SalvageDisposal | null;
};

/**
 * Salvage proceeds already recorded on the total-loss report.
 * Sale proceeds are used when a sale figure is on the file.
 * Otherwise the engineer's salvage value is used — the same subtraction as the
 * existing net suggestion. Nothing is subtracted when the insurer is taking the salvage.
 * The two figures are not added together.
 */
export function recordedSalvageProceedsPence(input: SalvageProceedsInput): number {
  if (input.interest === "takes_interest") return 0;
  if (input.disposal === "sold" && input.saleProceedsPence != null) {
    return Math.max(0, Math.trunc(input.saleProceedsPence));
  }
  if (input.salvagePence != null) return Math.max(0, Math.trunc(input.salvagePence));
  return 0;
}

/**
 * The figure a receipt is compared with.
 * An agreed total-loss figure is the agreed PAV minus salvage proceeds already recorded.
 * Once that shortfall has been accepted as final, the agreed figure is the amount accepted
 * and salvage is not subtracted again.
 * With no agreed figure, the claimed figure is used. Claimed and agreed are not added together.
 * Null means this head has no claim or invoice to compare with.
 */
export function settlementTargetPence(input: {
  head: string;
  agreedPence: number;
  claimedPence: number;
  salvageProceedsPence: number;
  acceptedAsFinal: boolean;
}): number | null {
  const agreed = Math.max(0, Math.trunc(input.agreedPence || 0));
  const claimed = Math.max(0, Math.trunc(input.claimedPence || 0));
  if (input.acceptedAsFinal && agreed > 0) return agreed;
  if (agreed <= 0 && claimed <= 0) return null;
  if (agreed > 0 && input.head === "vehicle_damage") {
    return Math.max(0, agreed - Math.max(0, Math.trunc(input.salvageProceedsPence || 0)));
  }
  if (agreed > 0) return agreed;
  return claimed;
}

/** Comparison used by the repair and settlement chases. Claimed amounts are not chased. */
export function chaseComparisonPence(input: {
  head: "repairs" | "vehicle_damage";
  agreedPence: number;
  salvageProceedsPence: number;
  acceptedAsFinal: boolean;
}): number {
  const agreed = Math.max(0, Math.trunc(input.agreedPence || 0));
  if (agreed <= 0) return 0;
  if (input.acceptedAsFinal) return agreed;
  if (input.head === "vehicle_damage") {
    return Math.max(0, agreed - Math.max(0, Math.trunc(input.salvageProceedsPence || 0)));
  }
  return agreed;
}

export function paymentCoversTarget(targetPence: number | null, receivedPence: number): boolean {
  const received = Math.trunc(receivedPence || 0);
  return targetPence != null && targetPence > 0 && received === targetPence;
}

export function paymentNeedsReview(targetPence: number | null, receivedPence: number): boolean {
  const received = Math.trunc(receivedPence || 0);
  return targetPence != null && targetPence > 0 && received > 0 && received < targetPence;
}

export function shortfallPence(targetPence: number | null, receivedPence: number): number {
  if (!paymentNeedsReview(targetPence, receivedPence) || targetPence == null) return 0;
  return targetPence - Math.trunc(receivedPence);
}

/** One line for the file and the dashboard. The choice itself is a later step. */
export function awaitingDecisionLabel(input: {
  headLabel: string;
  receivedPence: number;
  outstandingPence: number;
}): string {
  return `Awaiting decision — ${input.headLabel} — ${formatGbp(input.receivedPence)} received, ${formatGbp(input.outstandingPence)} still outstanding`;
}

/** Shown when money arrives on a head that was already accepted as final. The figures are not changed. */
export function paymentAfterSettlementLabel(headLabel: string, amountPence: number): string {
  return `Payment to review — ${headLabel} — ${formatGbp(amountPence)} arrived after this head was accepted as the final figure. It was not added.`;
}

import { formatGbp } from "../money";
import type { PaymentReviewHead } from "./payment-review";

export type HeadScreenKey = "recovery" | "storage" | "hire" | "vehicle";

/** The vehicle-damage screen shows repairs, or total loss, whichever the file is now. Never both. */
export function applicableVehicleHead(totalLoss: boolean): "repairs" | "vehicle_damage" {
  return totalLoss ? "vehicle_damage" : "repairs";
}

export function headScreenKey(head: PaymentReviewHead): HeadScreenKey {
  if (head === "recovery") return "recovery";
  if (head === "storage") return "storage";
  if (head === "hire") return "hire";
  return "vehicle";
}

export function headScreenPath(claimId: string, head: PaymentReviewHead): string {
  return `/claims/${claimId}/heads/${headScreenKey(head)}`;
}

export function describeHeadStatus(input: {
  empty: boolean;
  awaitingDecision: boolean;
  acceptedAsFinal: boolean;
  paidInFull: boolean;
  disputed: boolean;
  chase: "none" | "tracking" | "paused" | "cancelled";
}): string {
  if (input.empty) return "Nothing recorded yet";
  if (input.awaitingDecision) return "Awaiting decision";
  if (input.acceptedAsFinal || input.paidInFull) return "Settled";
  if (input.disputed) return "Disputed";
  if (input.chase === "paused") return "Paused";
  if (input.chase === "tracking") return "Active chase";
  if (input.chase === "cancelled") return "Chase cancelled";
  return "On file";
}

/** Shown before Accept as final is saved. Hire and storage are not closed. */
export function acceptWriteOffConfirmation(writeOffPence: number): string {
  return `Are you sure? This writes off ${formatGbp(writeOffPence)} and settles this head of loss. Hire and storage stay open.`;
}

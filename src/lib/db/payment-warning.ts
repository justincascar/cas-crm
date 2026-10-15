import { formatGbp } from "../money";
import { formatUkDateTime } from "../dates";

/** Shown before a second payment of the same amount on the same charge inside this window. It does not block the payment. */
export const SAME_AMOUNT_WARN_MS = 10 * 60 * 1000;

export function secondPaymentWarning(input: {
  amountPence: number;
  headLabel: string;
  at: string;
  by: string;
}): string {
  return `${formatGbp(input.amountPence)} was recorded on ${input.headLabel} at ${formatUkDateTime(input.at)} by ${input.by}. Is this a second, separate payment?`;
}

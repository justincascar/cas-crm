import { formatGbp } from "../money";

/** Shown until staff choose. The stored claimed figure is left as it is. */
export const STORED_FIGURE_DIFFERS = "Stored figure differs from calculation, review";

export function storedFigureKeptLabel(reason: string): string {
  return `Stored figure kept: ${reason.trim()}`;
}

/** Offer against the claimed figure. Percentage is of the claimed figure. */
export function offerComparedWithClaimed(offerPence: number, claimedPence: number): {
  diffPence: number;
  percent: number | null;
  label: string;
} {
  const offer = Math.trunc(offerPence || 0);
  const claimed = Math.trunc(claimedPence || 0);
  const diff = offer - claimed;
  if (claimed <= 0) {
    return { diffPence: diff, percent: null, label: "No claimed figure to compare." };
  }
  const percent = Math.round((Math.abs(diff) * 1000) / claimed) / 10;
  if (diff === 0) {
    return { diffPence: 0, percent: 0, label: "The same as the claimed figure (0%)." };
  }
  const word = diff < 0 ? "below" : "above";
  return {
    diffPence: diff,
    percent,
    label: `${formatGbp(Math.abs(diff))} ${word} the claimed figure (${percent}%).`,
  };
}

/**
 * Hire and storage only. Both boxes must be filled before a mismatch is flagged.
 * Days times the daily rate, in pence, compared with the offer amount. It does not block the offer.
 */
export function dayRateMismatchesOffer(
  days: number | null,
  ratePence: number | null,
  amountPence: number,
): boolean {
  if (days == null || ratePence == null) return false;
  if (!Number.isInteger(days) || days <= 0) return false;
  if (!Number.isInteger(ratePence) || ratePence <= 0) return false;
  return days * ratePence !== Math.trunc(amountPence || 0);
}

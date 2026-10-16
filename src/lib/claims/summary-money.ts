import type { HeadMoneyRow } from "@/lib/domain/head-outstanding";
import { formatGbp } from "@/lib/money";

/** Outstanding-column wording only. It does not change the outstanding figure. */
export const PROVISIONAL_NOT_FINAL = "Provisional, not final";

/** Shown when the stored claimed figure differs from the calculation and nobody has chosen yet. */
export const FIGURE_UNDER_REVIEW = "Figure under review";

/**
 * Labelling for one head on the claim summary.
 * "none" is only used when the figure is final and nothing is owed.
 * A provisional claimed figure is named, and is not called none.
 * The amount shown for a confirmed outstanding is never below £0.
 */
export function outstandingColumnText(row: Pick<HeadMoneyRow, "outstandingPence" | "provisionalClaimedPence">): string {
  const provisional = Math.max(0, Math.trunc(row.provisionalClaimedPence || 0));
  const provisionalText = `${PROVISIONAL_NOT_FINAL} ${formatGbp(provisional)}`;
  if (row.outstandingPence === null) {
    return provisional > 0 ? provisionalText : "none";
  }
  const owed = Math.max(0, Math.trunc(row.outstandingPence));
  if (owed === 0) return provisional > 0 ? provisionalText : "none";
  if (provisional > 0) return `${formatGbp(owed)} ${provisionalText}`;
  return formatGbp(owed);
}

/** Confirmed outstanding for the whole claim. Provisional figures are not included. Overpayments are not taken off. Never below £0. */
export function confirmedOutstandingPence(outstandingPence: number | null | undefined): number {
  if (outstandingPence == null) return 0;
  return Math.max(0, Math.trunc(outstandingPence));
}

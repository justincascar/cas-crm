import { buildClaimSummaryModel } from "@/lib/claims/claim-summary";
import { ClaimSummaryView } from "@/components/claims/ClaimSummaryView";

export function ClaimSummary({ claimId }: { claimId: string }) {
  const model = buildClaimSummaryModel(claimId);
  if (!model) return null;
  return <ClaimSummaryView model={model} />;
}

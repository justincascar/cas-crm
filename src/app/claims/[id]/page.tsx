import Link from "next/link";
import { NORTHERN_IRELAND_REMINDER } from "@/lib/domain/jurisdiction";
import { notFound, redirect } from "next/navigation";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { ClaimMoneyTable } from "@/components/claims/ClaimMoneyTable";
import { ClaimProblems } from "@/components/claims/ClaimProblems";
import { ClaimStepsPanel } from "@/components/claims/ClaimStepsPanel";
import { AwaitingDecisionList } from "@/components/claims/AwaitingDecisionList";
import { EmailSendModeBanner } from "@/components/EmailSendModeBanner";
import { requireStaff } from "@/lib/auth/session";
import { buildClaimSummaryModel } from "@/lib/claims/claim-summary";
import { loadClaimSteps } from "@/lib/claims/load-claim-steps";
import { BANK_DETAILS_MISSING_SETTINGS, paymentDetailsComplete } from "@/lib/domain/payment-details";
import { getInsurerPaymentDetails } from "@/lib/db/payment-details";
import { getClaim } from "@/lib/db/queries";
import { listOpenPaymentReviews, listPaymentsAfterSettlement } from "@/lib/db/payment-review";
import { isPaymentReviewHead } from "@/lib/domain/payment-review";
import { headScreenPath } from "@/lib/domain/head-screen";
import { loadClash } from "@/lib/db/record-version";

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    stepError?: string;
    stepSaved?: string;
    clash?: string;
    paymentDecision?: string;
    nextWarning?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireStaff();
  const data = getClaim(id);
  if (!data) notFound();
  const claimId = String(data.claim.id);
  if (query.paymentDecision && isPaymentReviewHead(query.paymentDecision)) redirect(headScreenPath(claimId, query.paymentDecision));
  const steps = loadClaimSteps(claimId);
  const summary = buildClaimSummaryModel(claimId);
  if (!steps || !summary) notFound();
  const reviews = listOpenPaymentReviews(claimId);
  const settledPayments = listPaymentsAfterSettlement(claimId);
  const bankDetailsMissing = !paymentDetailsComplete(getInsurerPaymentDetails());
  const claimClash = loadClash(query.clash);

  return (
    <div className="space-y-6">
      {query.nextWarning ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          This file has no next action. The save was kept. It stays on Today&apos;s work until a next action is set.
        </p>
      ) : null}
      <SaveClashNotice
        clash={claimClash && (claimClash.recordKey === id || claimClash.recordKey.startsWith(`${id}:`)) ? claimClash : null}
        reloadHref={`/claims/${id}`}
      />
      {query.error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p> : null}
      <EmailSendModeBanner />
      {String(data.claim.jurisdiction || "") === "northern_ireland" ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm" data-ni-reminder>
          {NORTHERN_IRELAND_REMINDER}
        </p>
      ) : null}
      <AwaitingDecisionList claimId={claimId} reviews={reviews} settled={settledPayments} />
      {bankDetailsMissing ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm font-semibold">{BANK_DETAILS_MISSING_SETTINGS}</p>
      ) : null}
      <p className="text-sm">
        <Link href={`/claims/${claimId}/vehicles`} className="text-teal-dark underline">
          Vehicles
        </Link>
      </p>
      <ClaimStepsPanel
        claimId={claimId}
        steps={steps}
        fault={String(data.claim.claim_type || "") === "fault"}
        error={query.stepError}
        saved={query.stepSaved}
      />
      <ClaimProblems flags={summary.flags} />
      <ClaimMoneyTable charges={summary.charges} />
    </div>
  );
}

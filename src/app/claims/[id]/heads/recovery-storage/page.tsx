import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { requireStaff } from "@/lib/auth/session";
import { loadHeadSection } from "@/lib/db/head-screen";
import { accountCanAcceptPaymentSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";

export default async function RecoveryStoragePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const canAccept = accountCanAcceptPaymentSettlement(staff.id, staff.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery and storage"
        subtitle={`${String(data.claim.file_reference)} · ${String(data.claim.client_name || "Unknown client")}. Recovery and storage stay separate figures.`}
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
      </p>
      <HeadOfLossScreen
        claimId={id}
        section={loadHeadSection(id, "recovery")}
        canAccept={canAccept}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="recovery" />
            <div className="mt-4">
              <PaymentReviewPanel claimId={id} lockedHead={{ head: "recovery", label: "Recovery" }} />
            </div>
          </>
        }
      />
      <HeadOfLossScreen
        claimId={id}
        section={loadHeadSection(id, "storage")}
        canAccept={canAccept}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="storage" />
            <div className="mt-4">
              <PaymentReviewPanel claimId={id} lockedHead={{ head: "storage", label: "Storage" }} />
            </div>
          </>
        }
      />
    </div>
  );
}

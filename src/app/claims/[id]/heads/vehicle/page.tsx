import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { TotalLossAgreedForm } from "@/components/claims/TotalLossAgreedForm";
import { applicableVehicleHead } from "@/lib/domain/head-screen";
import { requireStaff } from "@/lib/auth/session";
import { loadHeadSection } from "@/lib/db/head-screen";
import { accountCanAcceptPaymentSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";

export default async function VehicleDamagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tlError?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { tlError } = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const totalLoss = Number(data.claim.total_loss) === 1 || Number(data.claim.later_declared_total_loss) === 1;
  const head = applicableVehicleHead(totalLoss);
  const returnTo = `/claims/${id}/heads/vehicle`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle damage"
        subtitle={
          totalLoss
            ? `${String(data.claim.file_reference)} · Total loss. Repair figures are not shown on this screen.`
            : `${String(data.claim.file_reference)} · Repairs. Total-loss figures are not shown on this screen.`
        }
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
      </p>
      {tlError ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{tlError}</p>
      ) : null}
      <HeadOfLossScreen
        claimId={id}
        section={loadHeadSection(id, head)}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            {totalLoss ? <TotalLossAgreedForm claimId={id} returnTo={returnTo} /> : <HeadAgreedForm claimId={id} head="repairs" />}
            <div className="mt-4">
              <PaymentReviewPanel
                claimId={id}
                lockedHead={{ head, label: totalLoss ? "Vehicle damage" : "Repairs" }}
              />
            </div>
          </>
        }
      />
    </div>
  );
}

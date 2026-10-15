import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { TotalLossAgreedForm } from "@/components/claims/TotalLossAgreedForm";
import { VehicleOffers } from "@/components/claims/VehicleOffers";
import { SeparateRecordConfirm } from "@/components/SeparateRecordConfirm";
import { applicableVehicleHead } from "@/lib/domain/head-screen";
import { requireStaff } from "@/lib/auth/session";
import { loadHeadSection } from "@/lib/db/head-screen";
import { accountCanAcceptPaymentSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";
import { agreedOnFor, listVehicleOffers, undatedOfferPence, vehicleOfferHead } from "@/lib/db/vehicle-offers";

export default async function VehicleDamagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tlError?: string; offerError?: string; offerWarn?: string; offerAmount?: string; offerOn?: string; offerNote?: string; offerHead?: string; offerDays?: string; offerRate?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { tlError, offerError, offerWarn, offerAmount, offerOn, offerNote, offerHead: postedHead, offerDays, offerRate } = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const totalLoss = Number(data.claim.total_loss) === 1 || Number(data.claim.later_declared_total_loss) === 1;
  const head = applicableVehicleHead(totalLoss);
  const offerHead = vehicleOfferHead(id);
  const section = loadHeadSection(id, head);
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
      {offerError ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{offerError}</p>
      ) : null}
      {offerWarn ? (
        <SeparateRecordConfirm
          message={offerWarn}
          action={`/claims/${id}/vehicle-offers`}
          confirmField="confirmDuplicate"
          cancelHref={returnTo}
          fields={{
            intent: "record_offer",
            returnTo,
            amount: offerAmount || "",
            offeredOn: offerOn || "",
            note: offerNote || "",
            head: postedHead || "",
            offeredDays: offerDays || "",
            offeredDailyRate: offerRate || "",
          }}
        />
      ) : null}
      <HeadOfLossScreen
        claimId={id}
        section={section}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <VehicleOffers
              claimId={id}
              totalLoss={totalLoss}
              offers={listVehicleOffers(id, offerHead)}
              undatedOfferPence={undatedOfferPence(id, offerHead)}
              agreedOn={agreedOnFor(id, offerHead)}
              hasAgreed={section.agreedPence != null}
            />
            {totalLoss ? <TotalLossAgreedForm claimId={id} returnTo={returnTo} suggestionOnly /> : null}
            <div className="mt-4">
              <PaymentReviewPanel
                claimId={id}
                lockedHead={{
                  head,
                  label: totalLoss ? "Vehicle damage" : "Repairs",
                  receivedPence: section.receivedPence,
                  agreedPence: section.agreedPence ?? 0,
                  claimedPence: section.claimedPence,
                }}
              />
            </div>
          </>
        }
      />
    </div>
  );
}

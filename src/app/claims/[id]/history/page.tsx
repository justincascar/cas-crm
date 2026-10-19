import Link from "next/link";
import { notFound } from "next/navigation";
import { FileHistory } from "@/components/FileHistory";
import { JustificationChronology } from "@/components/claims/JustificationChronology";
import { requireStaff } from "@/lib/auth/session";
import { gapsForClaim } from "@/lib/db/repair-progress";
import { getClaim } from "@/lib/db/queries";

export default async function ClaimHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const claim = data.claim;
  const claimId = String(claim.id);
  const totalLoss = Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1;

  return (
    <div className="space-y-6">
      <p className="print:hidden">
        <Link href={`/claims/${claimId}/history/print`} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Print / save chronology
        </Link>
      </p>
      <JustificationChronology
        events={data.events}
        totalLoss={Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1}
        claimId={claimId}
        progressGaps={gapsForClaim(claimId, totalLoss)}
      />
      <FileHistory
        claimId={claimId}
        handlerId={String(claim.handler_id || "")}
        events={data.events}
        keyDates={data.keyDates}
        correspondence={data.correspondence}
        documents={data.documents}
        liabilityStatus={String(claim.claim_type || "")}
      />
    </div>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { getRepairGapThresholdDays, listFinishedRepairGapClaims } from "@/lib/db/repair-progress";

export default async function GapsBeforeDisputePage() {
  await requireStaff();
  const rows = listFinishedRepairGapClaims();
  const repairGapDays = getRepairGapThresholdDays();
  return (
    <div>
      <PageHeader
        title="Gaps to explain before any dispute"
        subtitle="These gaps are on claims that are finished. A repair is finished when the repaired vehicle has been returned or the claim is closed. A total loss stays here only once the claim is closed. The dashboard keeps gaps on open claims."
      />
      <p className="mb-4 text-sm text-slate">
        A repair step {repairGapDays} or more days after the previous one, or nothing recorded for that many days
        since the last step. The next day counts as 1. {repairGapDays - 1} days is not flagged. An explanation of the
        gap since the last step is looked at again after another {repairGapDays} days. Chasers do not reset the gap.
        Confirmed by Justin on 15/10/2026. This is a review prompt, not a legal limit.
      </p>
      <p className="mb-4 text-sm">
        <Link href="/" className="text-teal-dark underline">
          Back to the claims desk
        </Link>
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate">None.</p>
      ) : (
        <div className="rounded-xl border border-line bg-card p-5">
          <table className="ledger-table ledger-fit">
            <thead>
              <tr>
                <th>File</th>
                <th>Client</th>
                <th>Handler</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.claimId}-${row.wording}`}>
                  <td>
                    <Link href={`/claims/${row.claimId}#hire-repair-chronology`} className="ref text-teal-dark hover:underline">
                      {row.fileReference}
                    </Link>
                  </td>
                  <td>{row.clientName}</td>
                  <td>{row.handlerName}</td>
                  <td>{row.wording}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

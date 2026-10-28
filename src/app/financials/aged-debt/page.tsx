import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { HEAD_LABELS, type HeadOfLoss } from "@/lib/constants";
import { formatUkDate } from "@/lib/dates";
import { listAgedDebt } from "@/lib/db/aged-debt";
import { AGED_DEBT_BANDS } from "@/lib/domain/aged-debt";
import { formatGbp } from "@/lib/money";

export default async function AgedDebtPage() {
  await requireStaff();
  const { rows, totals } = listAgedDebt();
  return (
    <div>
      <PageHeader
        title="Aged debt"
        subtitle="Money still owed on each head, by days since the payment request was sent. Offers and provisional figures are not counted."
        actions={
          <Link href="/financials" className="text-sm text-teal-dark underline">
            Back to Financials
          </Link>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-5">
        {AGED_DEBT_BANDS.map((band) => (
          <div key={band} className="rounded-xl border border-line bg-card p-4" data-aged-band={band}>
            <p className="text-xs uppercase tracking-[0.12em] text-slate">{band}</p>
            <p className="tabular mt-1 font-serif text-xl text-navy-deep">{formatGbp(totals[band])}</p>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate">Nothing is owed on any file.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Client</th>
                <th>Head</th>
                <th>Owed</th>
                <th>Requested</th>
                <th>Days</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.claimId}-${row.head}`}>
                  <td>
                    <Link className="ref text-teal-dark hover:underline" href={`/claims/${row.claimId}/money`}>
                      {row.fileReference}
                    </Link>
                  </td>
                  <td>{row.clientName}</td>
                  <td>{HEAD_LABELS[row.head as HeadOfLoss] || row.head}</td>
                  <td className="tabular">{formatGbp(row.outstandingPence)}</td>
                  <td>{row.requestedOn ? formatUkDate(row.requestedOn) : "—"}</td>
                  <td className="tabular">{row.ageDays ?? "—"}</td>
                  <td>{row.band}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

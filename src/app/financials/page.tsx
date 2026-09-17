import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { HEAD_LABELS, type HeadOfLoss } from "@/lib/constants";
import { listFinancials } from "@/lib/db/queries";
import { formatGbp } from "@/lib/money";

export default function FinancialsPage() {
  const { lines, totals } = listFinancials();
  return (
    <div>
      <PageHeader
        title="Financials"
        subtitle="Indicative CAS defaults are not applied automatically. Hire rate comes from the agreement. Claimed, offered, agreed and received stay separate."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Total label="Claimed" value={totals.claimed} />
        <Total label="Offered" value={totals.offered} />
        <Total label="Agreed" value={totals.agreed} />
        <Total label="Received" value={totals.received} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Head</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Claimed</th>
              <th>Offered</th>
              <th>Agreed</th>
              <th>Received</th>
              <th>Offer</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)}>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${l.claim_id}`}>
                    {String(l.file_reference)}
                  </Link>
                </td>
                <td>{HEAD_LABELS[String(l.head_of_loss) as HeadOfLoss] || String(l.head_of_loss)}</td>
                <td className="tabular">
                  {l.quantity ?? "—"} {String(l.unit || "")}
                </td>
                <td className="tabular">{formatGbp(Number(l.rate_pence || 0))}</td>
                <td className="tabular">{formatGbp(Number(l.claimed_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.offered_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.agreed_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.received_pence))}</td>
                <td>{String(l.offer_status || "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-slate">{label}</p>
      <p className="mt-1 font-serif text-2xl tabular">{formatGbp(value)}</p>
    </div>
  );
}

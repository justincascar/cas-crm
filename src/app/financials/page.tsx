import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { HEAD_LABELS, type HeadOfLoss } from "@/lib/constants";
import { unconfirmedHireClaimIds } from "@/lib/db/hire-charge";
import { unconfirmedStorageClaimIds } from "@/lib/db/storage-charge";
import { listFinancials } from "@/lib/db/queries";
import { lineOutstanding } from "@/lib/domain/head-outstanding";
import { formatGbp } from "@/lib/money";

export default async function FinancialsPage() {
  await requireStaff();
  const { lines, totals } = listFinancials();
  const unconfirmedHire = unconfirmedHireClaimIds();
  const unconfirmedStorage = unconfirmedStorageClaimIds();
  return (
    <div>
      <PageHeader
        title="Financials"
        subtitle="Indicative CAS defaults are not applied automatically. Hire rate comes from the agreement. Claimed, offered, agreed and received stay separate."
        actions={
          <Link href="/financials/aged-debt" className="text-sm font-semibold text-teal-dark underline">
            Aged debt
          </Link>
        }
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
              <th>Qty × rate</th>
              <th>Net</th>
              <th>VAT</th>
              <th>Gross</th>
              <th>Claimed</th>
              <th>Offered</th>
              <th>Agreed</th>
              <th>Received</th>
              <th>Outstanding</th>
              <th>Overpaid</th>
              <th>Offer</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const head = String(l.head_of_loss);
              const provisional =
                ((head === "hire" || head === "credit_hire") && unconfirmedHire.has(String(l.claim_id))) ||
                (head === "storage" && unconfirmedStorage.has(String(l.claim_id)));
              const owed = lineOutstanding({
                claimId: String(l.claim_id),
                fileReference: String(l.file_reference),
                head,
                claimedPence: Number(l.claimed_pence || 0),
                offeredPence: Number(l.offered_pence || 0),
                agreedPence: Number(l.agreed_pence || 0),
                receivedPence: Number(l.received_pence || 0),
                claimedConfirmed: !provisional,
              });
              const overpaid = owed.comparisonPence != null ? Math.max(0, Number(l.received_pence || 0) - owed.comparisonPence) : 0;
              return (
              <tr key={String(l.id)}>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${l.claim_id}`}>
                    {String(l.file_reference)}
                  </Link>
                </td>
                <td>
                  {HEAD_LABELS[String(l.head_of_loss) as HeadOfLoss] || String(l.head_of_loss)}
                  {String(l.head_of_loss) === "storage" &&
                  unconfirmedStorage.has(String(l.claim_id)) &&
                  Number(l.claimed_pence) > 0
                    ? " — provisional"
                    : ""}
                  {(String(l.head_of_loss) === "hire" || String(l.head_of_loss) === "credit_hire") &&
                  unconfirmedHire.has(String(l.claim_id))
                    ? " — provisional"
                    : ""}
                </td>
                <td className="tabular">
                  {l.quantity != null && l.rate_pence != null
                    ? `${l.quantity}${l.unit ? ` ${String(l.unit)}` : ""} × ${formatGbp(Number(l.rate_pence))}`
                    : "—"}
                </td>
                <td className="tabular">{l.net_pence != null ? formatGbp(Number(l.net_pence)) : "—"}</td>
                <td className="tabular">{l.vat_pence != null ? formatGbp(Number(l.vat_pence)) : "—"}</td>
                <td className="tabular">{l.gross_pence != null ? formatGbp(Number(l.gross_pence)) : "—"}</td>
                <td className="tabular">{formatGbp(Number(l.claimed_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.offered_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.agreed_pence))}</td>
                <td className="tabular">{formatGbp(Number(l.received_pence))}</td>
                <td className="tabular">{owed.outstandingPence == null ? "Under review" : formatGbp(owed.outstandingPence)}</td>
                <td className="tabular">{overpaid > 0 ? formatGbp(overpaid) : "—"}</td>
                <td>{String(l.offer_status || "—")}</td>
              </tr>
              );
            })}
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

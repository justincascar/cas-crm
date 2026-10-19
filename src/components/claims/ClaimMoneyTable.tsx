import type { ClaimSummaryCharge } from "@/lib/claims/claim-summary";
import { RuleHint } from "@/components/dashboard/RuleHint";

export function ClaimMoneyTable({ charges }: { charges: ClaimSummaryCharge[] }) {
  return (
    <section aria-label="Money" className="rounded-xl border border-line bg-card px-4 py-3">
      <h2 className="font-serif text-xl text-navy-deep">Money</h2>
      <RuleHint text="Claimed, offered, agreed and received are four different figures. An offer is not a payment." />
      {charges.length === 0 ? (
        <p className="text-sm text-slate">No money recorded on this file.</p>
      ) : (
        <table className="ledger-table ledger-fit">
          <thead>
            <tr>
              <th>Head</th>
              <th>Claimed</th>
              <th>Offered</th>
              <th>Agreed</th>
              <th>Received</th>
              <th>Outstanding</th>
              <th>Overpaid</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((row) => (
              <tr key={row.head}>
                <td>
                  {row.label}
                  {row.details.map((detail) => (
                    <span key={detail} className="mt-1 block text-xs font-normal text-slate">
                      {detail}
                    </span>
                  ))}
                </td>
                <td className="tabular">{row.claimed}</td>
                <td className="tabular">{row.offered}</td>
                <td className="tabular">{row.agreed}</td>
                <td className="tabular">{row.received}</td>
                <td className="tabular">
                  {row.outstanding}
                  {row.reviewNote ? <span className="mt-1 block text-xs font-normal text-slate">{row.reviewNote}</span> : null}
                </td>
                <td className="tabular">{row.overpaid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

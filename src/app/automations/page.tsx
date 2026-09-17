import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { formatUkDateTime } from "@/lib/dates";
import { listAutomations } from "@/lib/db/queries";

export default function AutomationsPage() {
  const rows = listAutomations();
  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="Demonstration scheduling uses 3 calendar days. Nothing is sent live. A substantive reply would suspend the affected chase — out-of-office would not."
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Track</th>
              <th>Next</th>
              <th>Interval</th>
              <th>Status</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  {r.claim_id ? (
                    <Link className="ref text-teal-dark hover:underline" href={`/claims/${r.claim_id}`}>
                      {String(r.file_reference)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{String(r.track)}</td>
                <td>{r.next_run_at ? formatUkDateTime(String(r.next_run_at)) : "—"}</td>
                <td>
                  {String(r.interval_days)} {String(r.interval_unit)}
                  {Number(r.paused) ? " · paused" : ""}
                </td>
                <td>{String(r.status)}</td>
                <td>{String(r.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { listAutomationView } from "@/lib/db/automation-view";
import { describeRun, lastChaserRuns } from "@/lib/db/auto-chasers";

/** R34: every chase in plain words, worked out from the file, never the stored codes. */
export default async function AutomationsPage() {
  await requireStaff();
  const rows = listAutomationView();
  const runs = lastChaserRuns();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Automations"
        subtitle="Each chase as the file stands now. The automatic chaser checks every five minutes inside the sending hours and sends only the chasers Justin has approved; email is simulated until CAS's mailbox is connected. Closed, disputed-and-awaiting-CAS and solicitor files are not chased. A reply on file stops the chase until a person has read it."
      />
      <p className="text-sm" data-chaser-last-run>
        Last check: {describeRun(runs.latest)} Last chaser produced: {describeRun(runs.lastSent)}{" "}
        <Link href="/settings#automatic-chasers" className="text-teal-dark underline">
          Approvals in Settings
        </Link>
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Chase</th>
              <th>Next due</th>
              <th>How often</th>
              <th>Where it stands</th>
              <th>Sending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-automation={row.kind}>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${row.claimId}`}>
                    {row.fileReference}
                  </Link>
                </td>
                <td>{row.title}</td>
                <td>{row.dueAt ? formatUkDateTime(row.dueAt) : "—"}</td>
                <td>{row.every}</td>
                <td>{row.state}</td>
                <td>{row.sending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

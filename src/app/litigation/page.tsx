import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { formatUkDate } from "@/lib/dates";
import { listLitigation } from "@/lib/db/queries";

export default function LitigationPage() {
  const rows = listLitigation();
  return (
    <div>
      <PageHeader
        title="Litigation"
        subtitle="Deadlines identify their source. Court issue is not permitted without approval. CAS is not assumed to be claimant."
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Client</th>
              <th>Stage</th>
              <th>Deadline</th>
              <th>Issue approved</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <Link className="ref text-teal-dark hover:underline" href={`/claims/${r.claim_id}`}>
                    {String(r.file_reference)}
                  </Link>
                </td>
                <td>{String(r.client_name)}</td>
                <td>{String(r.stage).replaceAll("_", " ")}</td>
                <td>{formatUkDate(r.deadline_on ? String(r.deadline_on) : null)}</td>
                <td>{Number(r.approved_to_issue) ? "Yes" : "No"}</td>
                <td className="max-w-xl text-sm">{String(r.deadline_source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

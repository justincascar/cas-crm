import Link from "next/link";
import type { ReactNode } from "react";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import type { ClaimListRow } from "@/lib/db/queries";
import { formatVehicleRegistration } from "@/lib/text";

export function ClaimTable({ rows }: { rows: ClaimListRow[] }) {
  if (rows.length === 0) {
    return <p className="text-slate">No matching records.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Client</th>
            <th>Insurer</th>
            <th>Position</th>
            <th>Last correspondence</th>
            <th>Next action</th>
            <th>Due</th>
            <th>Handler</th>
            <th>Hire Pack</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/claims/${row.id}`} className="ref text-teal-dark hover:underline">
                  {row.file_reference}
                </Link>
                {row.registration ? <div className="text-xs text-slate">{formatVehicleRegistration(row.registration)}</div> : null}
              </td>
              <td>{row.client_name || "Unknown"}</td>
              <td>{row.insurer || "Unknown"}</td>
              <td>{row.current_position}</td>
              <td>{formatUkDateTime(row.last_correspondence_at)}</td>
              <td>{row.next_action || "—"}</td>
              <td>{formatUkDate(row.next_action_due)}</td>
              <td>{row.handler_name || "Unassigned"}</td>
              <td>
                <Link href={`/claims/${row.id}/hire-pack`} className="inline-block rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white">
                  Hire Pack
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchForm({ defaultQuery, action = "/claims" }: { defaultQuery?: string; action?: string }) {
  return (
    <form action={action} className="flex max-w-xl gap-2">
      <input
        name="q"
        defaultValue={defaultQuery}
        placeholder="Search reference, name, registration, insurer ref"
        className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
      />
      <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
        Search
      </button>
    </form>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl tracking-tight text-navy-deep">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

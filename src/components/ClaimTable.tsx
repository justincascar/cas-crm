import Link from "next/link";
import type { ReactNode } from "react";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { dueTextClass, dueWording } from "@/lib/domain/due-wording";
import type { ClaimListRow } from "@/lib/db/queries";
import { formatVehicleRegistration } from "@/lib/text";

export function ClaimTable({ rows, compact = false }: { rows: ClaimListRow[]; compact?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-slate">No matching records.</p>;
  }
  return (
    <>
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-line bg-card p-4">
            <p className="font-mono text-sm text-teal-dark">{row.file_reference}</p>
            <p className="mt-1 text-base">{row.client_name || "Unknown"}</p>
            {row.registration ? <p className="text-sm text-slate">{formatVehicleRegistration(row.registration)}</p> : null}
            {compact ? (
              <>
                <p className="mt-1 text-sm">{row.next_action || "—"}</p>
                <DueCell value={row.next_action_due} />
                <p className="text-sm text-slate">{row.handler_name || "Unassigned"}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate">{row.current_position}</p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Link href={`/claims/${row.id}`} className="min-h-11 rounded-md border border-navy px-3 py-2 text-center text-base text-navy">
                Open file
              </Link>
              <Link href={`/claims/${row.id}/handover`} className="min-h-11 rounded-md bg-navy px-3 py-2 text-center text-base font-semibold text-white">
                Handover
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className={compact ? "hidden rounded-xl border border-line bg-card md:block" : "hidden overflow-x-auto rounded-xl border border-line bg-card md:block"}>
      <table className={compact ? "ledger-table ledger-fit" : "ledger-table"}>
        <thead>
          <tr>
            <th>File</th>
            <th>Client</th>
            {compact ? null : (
              <>
                <th>Insurer</th>
                <th>Position</th>
                <th>Last correspondence</th>
              </>
            )}
            <th>Next action</th>
            <th>{compact ? "When" : "Due"}</th>
            <th>Handler</th>
            {compact ? null : <th>Hire Pack</th>}
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
              {compact ? null : (
                <>
                  <td>{row.insurer || "Unknown"}</td>
                  <td>{row.current_position}</td>
                  <td>{formatUkDateTime(row.last_correspondence_at)}</td>
                </>
              )}
              <td>{row.next_action || "—"}</td>
              <td>{compact ? <DueCell value={row.next_action_due} /> : formatUkDate(row.next_action_due)}</td>
              <td>{row.handler_name || "Unassigned"}</td>
              {compact ? null : (
                <td>
                  <Link href={`/claims/${row.id}/hire-pack`} className="inline-block rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white">
                    Hire Pack
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

function DueCell({ value }: { value: string | null }) {
  const when = dueWording(value);
  if (when.tone === "unknown") return <span>—</span>;
  return <span className={dueTextClass(when.tone)}>{when.text}</span>;
}

export function SearchForm({ defaultQuery, action = "/claims" }: { defaultQuery?: string; action?: string }) {
  return (
    <form action={action} className="flex max-w-xl flex-col gap-2 sm:flex-row">
      <input
        name="q"
        defaultValue={defaultQuery}
        placeholder="Search reference, name, registration, insurer ref"
        className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
      />
      <button className="min-h-11 rounded-md bg-navy px-4 py-2 text-base text-white" type="submit">
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

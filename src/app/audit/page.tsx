import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { canExportAndAudit, listAudit } from "@/lib/db/audit-view";
import { all } from "@/lib/db/connection";
import { formatUkDateTime } from "@/lib/dates";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** Who changed what and when, on any claim (J12). Justin only. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string; staff?: string; from?: string; to?: string; kind?: string }>;
}) {
  const staff = await requireStaff();
  if (!canExportAndAudit(staff.id)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Audit view" subtitle="Who changed what and when" />
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">Only Justin can open the audit view.</p>
      </div>
    );
  }
  const query = await searchParams;
  const people = all<{ id: string; name: string }>(`SELECT id, name FROM staff ORDER BY name`);
  const rows = listAudit({ claim: query.claim, staffId: query.staff, from: query.from, to: query.to, kind: query.kind });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit view"
        subtitle="Who changed what and when, on any claim: every step on a file's history and every saved screen, with the old and new values."
      />
      <form method="get" className="grid gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-5" data-audit-filters>
        <label className="text-sm">
          File reference
          <input name="claim" defaultValue={query.claim || ""} placeholder="TEST-0012" className={field} />
        </label>
        <label className="text-sm">
          Who
          <select name="staff" defaultValue={query.staff || ""} className={field}>
            <option value="">Anyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          From
          <input name="from" type="date" defaultValue={query.from || ""} className={field} />
        </label>
        <label className="text-sm">
          To
          <input name="to" type="date" defaultValue={query.to || ""} className={field} />
        </label>
        <label className="text-sm">
          What
          <select name="kind" defaultValue={query.kind || ""} className={field}>
            <option value="">Everything</option>
            <option value="history">Steps on the history</option>
            <option value="save">Saved screens and sections</option>
            <option value="viewed">Viewed or downloaded (bank statements, licence checks, signed agreements, exports, person's data)</option>
            <option value="other">Sign-ins and other</option>
          </select>
        </label>
        <div className="flex gap-3 sm:col-span-5">
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Show
          </button>
          <Link href="/audit" className="self-center text-sm text-teal-dark underline">
            Clear filters
          </Link>
        </div>
      </form>
      <p className="text-sm text-slate">{rows.length === 500 ? "The latest 500 matching entries." : `${rows.length} matching entries.`}</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm" data-audit-rows>
          <thead>
            <tr className="text-left text-slate">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.at}-${index}`} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-2">{formatUkDateTime(row.at)}</td>
                <td className="px-3 py-2">{row.who}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {row.claimId && row.reference ? (
                    <Link href={`/claims/${row.claimId}`} className="text-teal-dark underline">
                      {row.reference}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">{row.what}</td>
                <td className="max-w-xl break-words px-3 py-2 text-slate">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

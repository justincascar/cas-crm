import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { canExportAndAudit } from "@/lib/db/audit-view";
import { financialYearEndMonth, listDeletionLog, RETENTION_RULES, retentionConfirmed, retentionMonths, storedDueList } from "@/lib/db/retention";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The retention schedule, the "Due for deletion" list and the deletion log (J15). Justin only. */
export default async function RetentionPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const staff = await requireStaff();
  if (!canExportAndAudit(staff.id)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Retention and deletion" subtitle="How long records are kept" />
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">Only Justin can open the retention schedule.</p>
      </div>
    );
  }
  const { error, saved } = await searchParams;
  const due = storedDueList();
  const log = listDeletionLog(50);
  const action = "/settings/retention/save";
  return (
    <div className="max-w-4xl space-y-6" data-retention>
      <PageHeader
        title="Retention and deletion"
        subtitle="How long each kind of record is kept. Nothing is deleted automatically: a daily check lists what is due, and you approve each batch."
        actions={
          <Link href="/settings" className="text-sm text-teal-dark underline">
            Back to settings
          </Link>
        }
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-form-error>{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Schedule</h2>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {RETENTION_RULES.map((rule) => (
              <tr key={rule.key} className="border-t border-line align-top" data-retention-rule={rule.key}>
                <td className="py-2 pr-3 font-semibold">{rule.label}</td>
                <td className="py-2 pr-3">
                  {rule.months === null ? (
                    <span>Follows the claim file</span>
                  ) : (
                    <form method="post" action={action} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="intent" value="rule" />
                      <input type="hidden" name="key" value={rule.key} />
                      <label>
                        Months
                        <input name="months" inputMode="numeric" defaultValue={retentionMonths(rule.key) ?? ""} className={`${field} w-24`} />
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="confirmed" value="yes" defaultChecked={retentionConfirmed(rule.key)} />
                        Confirmed by the adviser
                      </label>
                      <button type="submit" className="rounded-md border border-line bg-white px-3 py-2">
                        Save
                      </button>
                    </form>
                  )}
                  <span className="text-slate">{rule.from}</span>
                </td>
                <td className="py-2">{rule.months === null || retentionConfirmed(rule.key) ? null : <span className="font-semibold text-warn">Awaiting adviser</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form method="post" action={action} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="intent" value="fy" />
          <label>
            The financial year ends in
            <select name="month" defaultValue={financialYearEndMonth()} className={field}>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md border border-line bg-white px-3 py-2">
            Save
          </button>
          <span className="font-semibold text-warn">Awaiting adviser</span>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-card p-5" data-due-list>
        <h2 className="font-serif text-xl text-navy-deep">Due for deletion</h2>
        <p className="mt-1 text-sm text-slate">
          {due.builtAt ? `Checked ${formatUkDateTime(due.builtAt)}.` : "Not checked yet."} A claim on legal hold is never listed. A claim file is anonymised: names,
          contact details, free text, messages and stored files are removed, and the money lines are kept for the accounts.
        </p>
        <form method="post" action={action} className="mt-2">
          <input type="hidden" name="intent" value="rebuild" />
          <button type="submit" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
            Check again now
          </button>
        </form>
        {due.items.length ? (
          <form method="post" action={action} className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="approve" />
            <ul className="space-y-1 text-sm">
              {due.items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="item" value={item.id} className="mt-1" />
                    <span>
                      {item.label} · due since {formatUkDate(item.dueSince)} · {item.action === "anonymise" ? "anonymise" : "remove"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="block text-sm">
              Reason (kept in the deletion log)
              <input name="reason" defaultValue="Past its retention period" className={field} />
            </label>
            <button type="submit" className="rounded-md bg-overdue px-4 py-2 text-sm font-semibold text-white">
              Approve and delete the ticked items
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm">Nothing is due.</p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card p-5" data-deletion-log>
        <h2 className="font-serif text-xl text-navy-deep">Deletion log</h2>
        <p className="mt-1 text-sm text-slate">What kind of record was removed, when and by whom. The deleted data itself is not kept.</p>
        {log.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {log.map((row, index) => (
              <li key={`${row.at}-${index}`}>
                {formatUkDateTime(row.at)} · {row.who || "Unknown"} · {row.file_reference ? `${row.file_reference} · ` : ""}
                {row.what} · {row.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm">Nothing has been deleted.</p>
        )}
      </section>
    </div>
  );
}

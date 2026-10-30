import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { canUseBreachLog, ICO_DECISIONS, listBreaches } from "@/lib/db/breaches";
import { formatUkDateTime, toLondonDateTimeLocal } from "@/lib/dates";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** Breach log (J15). Justin only. The 72-hour clock runs from discovery until a decision is recorded. */
export default async function BreachLogPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const staff = await requireStaff();
  if (!canUseBreachLog(staff.id)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Breach log" subtitle="Suspected personal data breaches" />
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">Only Justin can use the breach log.</p>
      </div>
    );
  }
  const { error, saved } = await searchParams;
  const breaches = listBreaches(staff.id);
  const action = "/settings/breaches/save";
  return (
    <div className="max-w-4xl space-y-6" data-breach-log>
      <PageHeader
        title="Breach log"
        subtitle="Record a suspected personal data breach as soon as it is discovered. A report to the ICO, if needed, is due within 72 hours of discovery. The CRM records your decision; it does not make it."
        actions={
          <Link href="/settings" className="text-sm text-teal-dark underline">
            Back to settings
          </Link>
        }
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue" data-form-error>{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}

      {breaches.map((breach) => (
        <section key={breach.id} className="space-y-2 rounded-xl border border-line bg-card p-5" data-breach={breach.id}>
          <p className={`font-semibold ${breach.overdue ? "text-overdue" : ""}`} data-ico-clock>
            {breach.clock}
          </p>
          <p className="text-sm">Discovered {formatUkDateTime(breach.discoveredAt)}</p>
          <p className="whitespace-pre-line text-sm">
            <span className="font-semibold">What happened: </span>
            {breach.whatHappened}
          </p>
          <p className="whitespace-pre-line text-sm">
            <span className="font-semibold">Whose data: </span>
            {breach.whoseData}
          </p>
          <form method="post" action={action} className="grid gap-2 text-sm sm:grid-cols-2">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="breachId" value={breach.id} />
            <label>
              Decision on reporting to the ICO
              <select name="decision" defaultValue={breach.decision} className={field}>
                {ICO_DECISIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason for the decision
              <input name="reason" defaultValue={breach.reason} className={field} />
            </label>
            <label className="sm:col-span-2">
              Actions taken
              <textarea name="actions" rows={3} defaultValue={breach.actions} className={field} />
            </label>
            <button type="submit" className="w-fit rounded-md border border-line bg-white px-3 py-2">
              Save
            </button>
          </form>
        </section>
      ))}

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Record a suspected breach</h2>
        <form method="post" action={action} className="mt-3 grid gap-3 text-sm">
          <input type="hidden" name="intent" value="record" />
          <label>
            When it was discovered
            <input type="datetime-local" name="discoveredAt" required defaultValue={toLondonDateTimeLocal(new Date().toISOString())} className={field} />
          </label>
          <label>
            What happened
            <textarea name="whatHappened" rows={3} required className={field} />
          </label>
          <label>
            Whose data (which people or claims, and what kind of data)
            <textarea name="whoseData" rows={2} required className={field} />
          </label>
          <label>
            Actions taken so far
            <textarea name="actions" rows={2} className={field} />
          </label>
          <button type="submit" className="w-fit rounded-md bg-navy px-4 py-2 font-semibold text-white">
            Record and start the 72-hour clock
          </button>
        </form>
      </section>
    </div>
  );
}

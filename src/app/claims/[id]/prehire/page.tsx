import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { bankStatementPosition, listHireDrivers, listLicenceChecks } from "@/lib/db/prehire-checks";
import { formatUkDateTime, londonTodayIso } from "@/lib/dates";
import {
  BANK_REUSE_NOTICE,
  DRIVERS_NOTICE,
  DVLA_MANUAL_NOTICE,
  GOV_LICENCE_CHECK_URL,
  LICENCE_CHECK_WINDOW_NOTICE,
  NO_OVERRIDE_NOTICE,
  formatLicenceDate,
  latestLicenceCheck,
  licenceCheckIsStale,
  staleLicenceLine,
} from "@/lib/domain/prehire-checks";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export default async function PrehireChecksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const drivers = listHireDrivers(id);
  const checks = listLicenceChecks(id);
  const snapshots = checks.map((row) => ({
    driverKey: row.driver_key,
    checkedOn: row.checked_on,
    recordedAt: row.recorded_at,
  }));
  const bank = bankStatementPosition(id);
  const today = londonTodayIso();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Pre-hire checks"
        subtitle="Required before a hire agreement can be generated. The agreement is still produced unsigned."
        actions={
          <Link href={`/claims/${id}/hire-pack`} className="text-sm text-teal-dark underline">
            Hire Pack
          </Link>
        }
      />
      <p className="rounded-md border border-line bg-card px-4 py-3 text-sm">{NO_OVERRIDE_NOTICE}</p>
      <p className="text-sm text-slate">{DVLA_MANUAL_NOTICE}</p>
      <p className="text-sm text-slate">{LICENCE_CHECK_WINDOW_NOTICE}</p>
      <p className="text-sm">
        <a className="text-teal-dark underline" href={GOV_LICENCE_CHECK_URL} target="_blank" rel="noreferrer">
          gov.uk/check-driving-licence
        </a>
      </p>
      {query.error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">Saved on this file. It stays after you sign out.</p>
      ) : null}

      <section className="space-y-4 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Licence checks</h2>
        <p className="text-sm text-slate">{DRIVERS_NOTICE}</p>
        {drivers.length === 0 ? <p className="text-sm">Nobody is recorded as the person who will drive the hire vehicle.</p> : null}
        {drivers.map((driver) => {
          const latest = latestLicenceCheck(snapshots, driver.key);
          const history = checks.filter((row) => row.driver_key === driver.key);
          const stale = latest ? licenceCheckIsStale(latest.checkedOn, today) : false;
          return (
            <div key={driver.key} className="space-y-3 rounded-lg border border-line p-4">
              <div>
                <h3 className="font-serif text-lg text-navy-deep">{driver.name}</h3>
                <p className="text-sm text-slate">{driver.basis}</p>
              </div>
              {latest && stale ? (
                <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
                  {staleLicenceLine(driver.name, latest.checkedOn, today)}
                </p>
              ) : latest ? (
                <p className="text-sm">
                  A check is recorded, dated {formatLicenceDate(latest.checkedOn)}. It is inside the demonstration window as at today.
                </p>
              ) : (
                <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
                  No licence check is recorded for {driver.name}. A hire agreement cannot be generated until it is.
                </p>
              )}
              {history.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {history.map((row) => (
                    <li key={row.id} className="rounded-lg border border-line px-3 py-2">
                      <p>
                        Checked {formatLicenceDate(row.checked_on)}
                        {row.recorded_by_name ? ` · recorded by ${row.recorded_by_name}` : ""} · {formatUkDateTime(row.recorded_at)}
                      </p>
                      <p>Check code (restricted): {row.check_code}</p>
                      <p>Categories shown: {row.category}</p>
                      <p>Points and endorsements shown: {row.points_endorsements}</p>
                      <p>Licence expiry shown: {formatLicenceDate(row.licence_expires_on)}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <form method="post" action={`/claims/${id}/prehire/save`} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="driverKey" value={driver.key} />
                <label className="text-sm">
                  DVLA check code (restricted)
                  <input name="checkCode" required autoComplete="off" className={field} />
                </label>
                <label className="text-sm">
                  Date the check was done
                  <input name="checkedOn" type="date" required max={today} defaultValue={today} className={field} />
                </label>
                <label className="text-sm">
                  Categories the check showed
                  <input name="category" required className={field} />
                </label>
                <label className="text-sm">
                  Points and endorsements the check showed
                  <input name="pointsEndorsements" required className={field} placeholder="None shown" />
                </label>
                <label className="text-sm sm:col-span-2">
                  Licence expiry the check showed
                  <input name="licenceExpiresOn" type="date" required className={field} />
                </label>
                <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
                  Save licence check
                </button>
              </form>
            </div>
          );
        })}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Bank statements</h2>
        <p className="text-sm text-slate">{BANK_REUSE_NOTICE}</p>
        {bank.satisfied ? (
          <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-3 py-2 text-sm">
            The bank-statement check is satisfied.
            {bank.bankAccounts.length > 0
              ? ` Listed bank account${bank.bankAccounts.length === 1 ? "" : "s"}: ${bank.bankAccounts.map((row) => row.label).join(", ")}.`
              : ""}
            {bank.noBankExplanation ? ` Saved explanation that there is no bank account: ${bank.noBankExplanation}` : ""}
          </p>
        ) : (
          <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
            Neither a bank account nor a saved no-bank explanation is on this file. A hire agreement cannot be generated until one of those is saved.
          </p>
        )}
        <p className="text-sm">
          <Link href={`/claims/${id}/financial#bank-accounts`} className="text-teal-dark underline">
            Financial circumstances — bank accounts and the no-bank explanation
          </Link>
        </p>
      </section>
    </div>
  );
}

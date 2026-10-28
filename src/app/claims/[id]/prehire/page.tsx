import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { RecordVersionField } from "@/components/SaveClashNotice";
import { requireStaff } from "@/lib/auth/session";
import { accountCanOverridePreHireChecks } from "@/lib/db/permissions";
import {
  bankStatementPosition,
  listHireDrivers,
  listLicenceChecks,
  listPrehireOverrides,
} from "@/lib/db/prehire-checks";
import { sectionVersion } from "@/lib/db/record-version";
import { formatUkDate, formatUkDateTime, londonTodayIso } from "@/lib/dates";
import { GOV_LICENCE_CHECK_URL, formatLicenceDate, hireCheckAnchor, latestLicenceCheck, licenceCheckIsStale } from "@/lib/domain/prehire-checks";
import { licenceCheckWindowDays } from "@/lib/db/licence-window";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const button = "inline-flex min-h-11 items-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white";

export async function PrehireChecksScreen({
  params,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const staff = await requireStaff();
  const mayOverride = accountCanOverridePreHireChecks(staff.id, staff.role);
  const creditHire = String(data.claim.claim_type || "") !== "fault";
  const drivers = listHireDrivers(id);
  const checks = listLicenceChecks(id);
  const overrides = listPrehireOverrides(id);
  const licenceOverride = overrides.find((row) => row.check_kind === "licence");
  const bankOverride = overrides.find((row) => row.check_kind === "bank");
  const bank = bankStatementPosition(id);
  const today = londonTodayIso();
  const windowDays = licenceCheckWindowDays();
  const snapshots = checks.map((row) => ({
    driverKey: row.driver_key,
    checkedOn: row.checked_on,
    recordedAt: row.recorded_at,
    result: row.result,
  }));

  return (
    <div className="space-y-4">
      {drivers.length === 0 ? <p className="text-sm">Nobody is recorded as the person who will drive.</p> : null}
      {drivers.map((driver) => {
        const latest = latestLicenceCheck(snapshots, driver.key);
        const stale = latest && latest.result !== "problem" ? licenceCheckIsStale(latest.checkedOn, today, windowDays) : false;
        const done = Boolean(latest && latest.result !== "problem" && !stale);
        return (
          <div key={driver.key} id={hireCheckAnchor(driver.key)} className="space-y-3 rounded-lg border border-line p-4">
            <h3 className="font-serif text-lg text-navy-deep">{driver.name}</h3>
            {driver.licenceNumber ? (
              <p className="text-sm">Licence number: {driver.licenceNumber}</p>
            ) : (
              <p className="text-sm">
                <Link href={driver.licenceHref} className="text-teal-dark underline">
                  Add licence number
                </Link>
              </p>
            )}
            <p className="text-sm">
              <a className="text-teal-dark underline" href={GOV_LICENCE_CHECK_URL} target="_blank" rel="noreferrer">
                Open GOV.UK licence check
              </a>
            </p>
            {done && latest ? (
              <p className="text-sm text-ok">Done. Checked {formatLicenceDate(latest.checkedOn)}.</p>
            ) : latest?.result === "problem" ? (
              <p className="text-sm">Problem found. This check is not done. Recheck, choose another driver, or use an override.</p>
            ) : stale && latest ? (
              <p className="text-sm">Licence check is older than {windowDays} days — please recheck.</p>
            ) : (
              <p className="text-sm">Still needed.</p>
            )}
            <form method="post" action={`/claims/${id}/prehire/save`} encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
              <SubmitKeyInput />
              <RecordVersionField version={sectionVersion("licence-check", `${id}:${driver.key}`)} />
              <input type="hidden" name="driverKey" value={driver.key} />
              <label className="text-sm">
                Date checked
                <input name="checkedOn" type="date" required max={today} defaultValue={today} className={field} />
              </label>
              <fieldset className="text-sm">
                <legend>Result</legend>
                <label className="mt-1 flex items-center gap-2">
                  <input type="radio" name="result" value="ok" required defaultChecked />
                  OK to drive
                </label>
                <label className="mt-1 flex items-center gap-2">
                  <input type="radio" name="result" value="problem" />
                  Problem found
                </label>
              </fieldset>
              <label className="text-sm">
                Categories
                <input name="category" required className={field} />
              </label>
              <label className="text-sm">
                Penalty points
                <input name="penaltyPoints" type="number" min={0} max={99} step={1} defaultValue={0} required className={field} />
              </label>
              <label className="text-sm">
                Expiry date
                <input name="licenceExpiresOn" type="date" required className={field} />
              </label>
              <label className="text-sm">
                Check code (office only)
                <input name="checkCode" autoComplete="off" className={field} />
              </label>
              <label className="text-sm sm:col-span-2">
                Notes
                <textarea name="notes" rows={2} className={field} />
              </label>
              <label className="text-sm sm:col-span-2">
                Screenshot or PDF
                <input
                  name="document"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                  className={field}
                />
              </label>
              <button className={button} type="submit">
                Save licence check
              </button>
            </form>
          </div>
        );
      })}
      {licenceOverride ? (
        <p className="text-sm">
          Licence check overridden by {licenceOverride.recorded_by_name || "Unknown"} on {formatUkDate(licenceOverride.recorded_at)}:{" "}
          {licenceOverride.reason}
        </p>
      ) : null}
      {mayOverride && !licenceOverride ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-dark underline">Override (authorised users only)</summary>
          <OverrideForm claimId={id} checkKind="licence" />
        </details>
      ) : null}

      {creditHire ? (
        <div id="bank" data-bank-step="yes" className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="font-serif text-lg text-navy-deep">Bank statements</h3>
          <p className="text-sm">Upload the client&apos;s recent bank statements, or record that they have no bank account.</p>
          {bank.statements.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {bank.statements.map((row) => (
                <li key={row.id}>
                  <Link href={`/documents/${row.id}`} className="text-teal-dark underline">
                    {row.title}
                  </Link>
                  {row.period ? ` · ${row.period}` : ""} · {formatUkDateTime(row.createdAt)}
                </li>
              ))}
            </ul>
          ) : null}
          {bank.bankAccounts.length > 0 ? (
            <p className="text-sm">Bank account listed: {bank.bankAccounts.map((row) => row.label).join(", ")}.</p>
          ) : null}
          {bank.noBankExplanation ? <p className="text-sm">Client has no bank account: {bank.noBankExplanation}</p> : null}
          {bank.satisfied ? <p className="text-sm text-ok">Done.</p> : <p className="text-sm">Still needed.</p>}
          <form method="post" action={`/claims/${id}/hire/bank`} encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <SubmitKeyInput />
            <RecordVersionField version={sectionVersion("bank-check", id)} />
            <input type="hidden" name="returnHash" value="#bank" />
            <label className="text-sm">
              Statement
              <input
                name="document"
                type="file"
                required
                accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                className={field}
              />
            </label>
            <label className="text-sm">
              Statement period (optional)
              <input name="statementPeriod" className={field} />
            </label>
            <button className={button} type="submit">
              Upload
            </button>
          </form>
          <form method="post" action={`/claims/${id}/hire/no-bank`} className="space-y-3">
            <SubmitKeyInput />
            <RecordVersionField version={sectionVersion("bank-check", id)} />
            <input type="hidden" name="returnHash" value="#bank" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="noBank" value="yes" required />
              Client has no bank account
            </label>
            <label className="block text-sm">
              Explanation
              <textarea name="explanation" required rows={2} className={field} defaultValue={bank.noBankExplanation} />
            </label>
            <button className={button} type="submit">
              Save
            </button>
          </form>
          {bankOverride ? (
            <p className="text-sm">
              Bank-statement check overridden by {bankOverride.recorded_by_name || "Unknown"} on {formatUkDate(bankOverride.recorded_at)}:{" "}
              {bankOverride.reason}
            </p>
          ) : null}
          {mayOverride && !bankOverride && !bank.satisfied ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-teal-dark underline">Override (authorised users only)</summary>
              <OverrideForm claimId={id} checkKind="bank" />
            </details>
          ) : null}
          <p className="text-sm">
            <Link href={`/claims/${id}/financial#bank-accounts`} className="text-teal-dark underline">
              Financial circumstances
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OverrideForm({ claimId, checkKind }: { claimId: string; checkKind: "licence" | "bank" }) {
  return (
    <form method="post" action={`/claims/${claimId}/prehire/override`} className="mt-3 space-y-3">
      <SubmitKeyInput />
      <input type="hidden" name="checkKind" value={checkKind} />
      <label className="block text-sm">
        Reason
        <textarea name="reason" required rows={2} maxLength={1000} autoComplete="off" className={field} />
      </label>
      <button className={button} type="submit">
        Save override
      </button>
    </form>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const target = new URL(`http://local/claims/${id}/hire`);
  target.hash = "checks";
  for (const [key, value] of Object.entries(query)) {
    if (value) target.searchParams.set(key, value);
  }
  redirect(`${target.pathname}${target.search}${target.hash}`);
}

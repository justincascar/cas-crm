import { PageHeader } from "@/components/ClaimTable";
import { RecordVersionField, SaveClashNotice } from "@/components/SaveClashNotice";
import { ValidatedForm } from "@/components/ValidatedForm";
import Link from "next/link";
import { actionSaveAgreementLimits, actionSaveChaseIntervals, actionSaveDefaultVehicleLocation, actionSaveGtaMarkup, actionSaveStorageDailyRate, actionTestMailboxConnection } from "@/app/settings-actions";
import { isAdministrator } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { dbLocation, getSettings, listStaff } from "@/lib/db/queries";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { getStorageDailyRatePence } from "@/lib/db/storage-charge";
import { recoveryCardFeePercent, recoveryFeeSchedule } from "@/lib/db/recovery-fee-settings";
import { RECOVERY_FEE_DEFS, filledPounds } from "@/lib/domain/recovery-fees";
import { getAgreementApproachingDay, getAgreementMaxDays, getChaseIntervalDays } from "@/lib/db/chase";
import { getRepairGapThresholdDays } from "@/lib/db/repair-progress";
import { getSendingHours } from "@/lib/db/sending-hours";
import { describeSendingHours } from "@/lib/domain/sending-hours";
import { listInsurerPaymentTerms } from "@/lib/db/insurers";
import { accountCanManageBankDetails } from "@/lib/db/permissions";
import { canExportAndAudit } from "@/lib/db/audit-view";
import { PAYMENT_DUE_ON_RECEIPT, PAYMENT_DUE_ON_RECEIPT_SENTENCE } from "@/lib/constants";
import { getGtaMarkupPercent } from "@/lib/db/hire-agreement";
import { licenceCheckWindowDays } from "@/lib/db/licence-window";
import { getInsurerPaymentDetails } from "@/lib/db/payment-details";
import { loadClash, sectionVersion } from "@/lib/db/record-version";
import { gtaTableFor, listGtaTables } from "@/lib/db/gta-rates";
import { fleetGroupChoices, listFleetGtaRules } from "@/lib/db/fleet-details";
import { EmailSendModeBanner } from "@/components/EmailSendModeBanner";
import { CAS_CLAIMS_MAILBOX, INDICATIVE_DEFAULTS } from "@/lib/constants";
import { mailboxIsConnected } from "@/lib/email/microsoft-graph";
import { emailSendBanner } from "@/lib/email/send-mode";
import { formatGbp } from "@/lib/money";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { currentCasInsuranceDocument } from "@/lib/db/company-insurance";
import { PAYMENT_REQUEST_PACK_MISSING } from "@/lib/email/payment-request-pack";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; mailboxCheck?: string; mailboxCheckError?: string; clash?: string }>;
}) {
  const staffUser = await requireStaff();
  const { error, saved, mailboxCheck, mailboxCheckError, clash: clashId } = await searchParams;
  const clash = loadClash(clashId);
  const versionFor = (scope: string) => (clash?.scope === scope ? clash.expectedVersion : sectionVersion(scope, "office"));
  const settings = getSettings();
  const staff = listStaff();
  const admin = isAdministrator(staffUser.role);
  const defaultVehicleLocation = getDefaultVehicleLocation();
  const storageDailyRate = getStorageDailyRatePence();
  const engineerChaseIntervalDays = getChaseIntervalDays("engineer_report");
  const liabilityChaseIntervalDays = getChaseIntervalDays("liability_response");
  const repairChaseIntervalDays = getChaseIntervalDays("repair_authorisation");
  const paymentChaseIntervalDays = getChaseIntervalDays("repair_payment");
  const canManageBank = accountCanManageBankDetails(staffUser.id, staffUser.role);
  const canAudit = canExportAndAudit(staffUser.id);
  const insurerTerms = listInsurerPaymentTerms();
  const agreementRenewalAlertDay = getChaseIntervalDays("hire_agreement_renewal");
  const agreementRenewalApproachingDay = getAgreementApproachingDay();
  const agreementMaxDays = getAgreementMaxDays();
  const repairProgressGapDays = getRepairGapThresholdDays();
  const sendingHours = getSendingHours();
  const gtaMarkupPercent = getGtaMarkupPercent();
  const gtaTables = listGtaTables();
  const gtaInForce = gtaTableFor();
  const fleetGtaRules = listFleetGtaRules();
  const fleetGroups = fleetGroupChoices();
  const paymentDetails = getInsurerPaymentDetails();
  const casInsurance = currentCasInsuranceDocument();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Prototype configuration. Administrator and staff can open every file. Driver and bodyshop / mechanic can open only the jobs assigned to them today."
      />
      <EmailSendModeBanner />
      <SaveClashNotice clash={clash} reloadHref="/settings" />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {saved === "insurance" ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">
          CAS insurance certificate stored. Nothing was sent.
        </p>
      ) : saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p>
      ) : null}
      {mailboxCheck ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">{mailboxCheck}</p>
      ) : null}
      {mailboxCheckError ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{mailboxCheckError}</p>
      ) : null}
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Hire agreement length</h2>
        <p className="mt-2 text-sm">
          Confirmed 27 October 2026. The agreement is <strong>89 days</strong>. Renewal alerts start on day{" "}
          <strong>80</strong> and are overdue on day <strong>88</strong>. That margin is deliberate. Hire charges are
          not changed by the alert. A renewal does not restart the day count.
        </p>
        <ValidatedForm action={actionSaveAgreementLimits} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
          <RecordVersionField version={versionFor("settings-agreement")} />
          <label className="text-sm">
            Approaching (amber) day
            <input
              name="agreementRenewalApproachingDay"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={agreementRenewalApproachingDay}
            />
          </label>
          <label className="text-sm">
            Renewal due (red) day
            <input
              name="agreementRenewalAlertDay"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={agreementRenewalAlertDay}
            />
          </label>
          <label className="text-sm">
            Agreement maximum days
            <input
              name="agreementMaxDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={agreementMaxDays}
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white sm:col-span-3">
            Save agreement day limits
          </button>
        </ValidatedForm>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Licence check window</h2>
        <p className="mt-2 text-sm">
          A licence check older than this blocks the agreement and the handover. Justin confirmed 21 days on 29/10/2026,
          the same period as a GOV.UK check code.
        </p>
        <form method="post" action="/settings/licence-window" className="mt-4 flex flex-wrap items-end gap-3">
          <RecordVersionField version={versionFor("settings-licence-window")} />
          <label className="text-sm">
            Days
            <input
              name="licenceCheckWindowDays"
              type="number"
              min={1}
              max={365}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={licenceCheckWindowDays()}
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save licence check window
          </button>
        </form>
      </section>
      <p className="text-sm">
        <Link href="/settings/roles" className="font-semibold text-teal-dark underline">
          Who can do what
        </Link>{" "}
        — what each role can see and do, checked on the server.
      </p>
      {canAudit ? (
        <section className="rounded-xl border border-line bg-card p-5" data-export-audit>
          <h2 className="font-serif text-xl text-navy-deep">Full export and audit</h2>
          <p className="mt-2 text-sm">
            The full export is one zip: a CSV file for every table (claims, people, money, history and the rest) and every stored document. Passwords and
            sign-in sessions are left out. The audit view shows who changed what and when, on any claim. Only you can use these.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a href="/settings/export" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
              Download the full export
            </a>
            <Link href="/audit" className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-navy">
              Open the audit view
            </Link>
          </div>
        </section>
      ) : null}
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Chaser sending hours</h2>
        <p className="mt-2 text-sm">
          Now: {describeSendingHours(sendingHours)}, UK time. A chase email is only sent inside these hours, once the
          mailbox is live. Justin confirmed Monday to Friday, 09:00 to 17:00 UK time on 29/10/2026.
        </p>
        <form method="post" action="/settings/sending-hours" className="mt-4 flex flex-wrap items-end gap-3">
          <RecordVersionField version={versionFor("settings-sending-hours")} />
          <fieldset className="text-sm">
            <legend>Days</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, day) => (
                <label key={name} className="flex items-center gap-1">
                  <input type="checkbox" name="day" value={day} defaultChecked={sendingHours.days.includes(day)} />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm">
            From
            <input name="start" type="time" required className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm" defaultValue={sendingHours.start} />
          </label>
          <label className="text-sm">
            Until
            <input name="end" type="time" required className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm" defaultValue={sendingHours.end} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save sending hours
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Repair progress gap — review prompt</h2>
        <p className="mt-2 text-sm">
          A gap of this many days between two repair steps, in date order, is flagged until someone explains it. The
          next day counts as 1. {Math.max(repairProgressGapDays - 1, 0)} is not flagged. {repairProgressGapDays} is.
          Nothing recorded since the last step for that long is flagged as well. Justin confirmed 7 days on 15/10/2026.
          It is not a legal limit, and it does not change hire agreement renewal days.
        </p>
        <form method="post" action="/settings/repair-gap" className="mt-4 flex flex-wrap items-end gap-3">
          <RecordVersionField version={versionFor("settings-repair-gap")} />
          <label className="text-sm">
            Days
            <input
              name="repairProgressGapDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-32 rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={repairProgressGapDays}
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save review prompt
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Payment details for insurers</h2>
        <p className="mt-1 text-sm text-slate">
          The account insurers should use when paying CAS. Leave all three blank until the details are entered here. They are not invented, and a
          total-loss notification says they are not yet on file until all three are saved. Nothing is sent automatically.
        </p>
        <form method="post" action="/settings/payment-details" className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
          <RecordVersionField version={versionFor("bank-details")} />
          <label className="text-sm">
            Account name
            <input
              name="accountName"
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={paymentDetails.accountName}
              autoComplete="off"
            />
          </label>
          <label className="text-sm">
            Sort code
            <input
              name="sortCode"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={paymentDetails.sortCode}
              autoComplete="off"
            />
          </label>
          <label className="text-sm">
            Account number
            <input
              name="accountNumber"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={paymentDetails.accountNumber}
              autoComplete="off"
            />
          </label>
          {canManageBank ? (
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white sm:col-span-3">
              Save payment details
            </button>
          ) : (
            <p className="text-sm sm:col-span-3">Only Justin can change the bank details.</p>
          )}
        </form>
        <h3 className="mt-6 font-semibold text-navy">Insurer payment term</h3>
        <p className="mt-1 text-sm text-slate">
          CAS’s default is {PAYMENT_DUE_ON_RECEIPT}. Invoices and payment requests say: {PAYMENT_DUE_ON_RECEIPT_SENTENCE} A different term can be
          saved for one insurer. It is not shown as a number of days, and it is not the chase reminder interval.
        </p>
        <form method="post" action="/settings/insurer-payment-term" className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
          <RecordVersionField version={versionFor("settings-insurer-term")} />
          <label className="text-sm sm:col-span-1">
            Insurer
            <select name="insurerName" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" defaultValue="">
              <option value="">Choose</option>
              {insurerTerms.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name}
                  {row.paymentTerm ? ` — ${row.paymentTerm}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-1">
            Term for this insurer
            <input name="paymentTerm" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder={PAYMENT_DUE_ON_RECEIPT} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save this insurer’s term
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">CAS insurance certificate</h2>
        <p className="mt-1 text-sm text-slate">
          CAS&apos;s own insurance certificate, kept once for the company. It is not stored on each claim, and it is not invented. Storing a file
          here does not send an email. A payment-request email ticks the current copy when one is stored.
        </p>
        {casInsurance ? (
          <p className="mt-3 text-sm">
            Current certificate: {casInsurance.original_filename} · version {casInsurance.version} ·{" "}
            {formatUkDateTime(casInsurance.created_at)} ·{" "}
            <Link className="text-teal-dark underline" href={`/documents/${casInsurance.id}`}>
              View
            </Link>
          </p>
        ) : (
          <p className="mt-3 rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">{PAYMENT_REQUEST_PACK_MISSING.casInsurance}</p>
        )}
        <form method="post" action="/settings/cas-insurance" encType="multipart/form-data" className="mt-4 space-y-3">
          <RecordVersionField version={versionFor("settings-insurance")} />
          <label className="block text-sm">
            {casInsurance ? "Store a newer copy" : "Certificate file"}
            <input
              name="document"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
              className="mt-1 block w-full text-sm"
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            {casInsurance ? "Store a newer copy" : "Store certificate"}
          </button>
          {casInsurance ? (
            <p className="text-sm text-slate">The earlier copy stays available to tick by hand. Only the current copy is pre-ticked.</p>
          ) : null}
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Environment</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row label="Status" value={settings.environment || "prototype"} />
          <Row label="File prefix" value={settings.file_prefix} />
          <Row label="Agreement maximum days" value={String(agreementMaxDays)} />
          <Row label="Renewal approaching (amber) day" value={String(agreementRenewalApproachingDay)} />
          <Row label="Renewal due (red) day" value={String(agreementRenewalAlertDay)} />
          <Row
            label="Email sending"
            value={emailSendBanner().text}
          />
          <Row
            label="Claims mailbox"
            value={
              mailboxIsConnected()
                ? `${CAS_CLAIMS_MAILBOX}. Microsoft 365 credentials are saved on this computer. They do not send email unless the mode above is live.`
                : `${CAS_CLAIMS_MAILBOX}. Microsoft 365 credentials are not set.`
            }
          />
          <Row label="Database file" value={dbLocation()} />
        </dl>
        <form action={actionTestMailboxConnection} className="mt-4">
          <button type="submit" className="rounded-md border border-navy bg-white px-4 py-2 text-sm font-semibold text-navy">
            Check Microsoft 365 sign-in
          </button>
          <p className="mt-2 text-sm text-slate">
            This asks Microsoft to accept the saved credentials. It does not send an email. Ordinary simulated use does not need it.
          </p>
        </form>
      </section>
      <section id="gta-rate" className="scroll-mt-16 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">GTA daily rate</h2>
        <p className="mt-1 text-sm text-slate">
          Daily rate = the GTA figure for the group charged, from the table in force, plus this uplift. A hire keeps the rate it was given.
        </p>
        <ValidatedForm action={actionSaveGtaMarkup} className="mt-4 flex flex-wrap items-end gap-3">
          <RecordVersionField version={versionFor("settings-gta")} />
          <label className="text-sm">
            Uplift (%)
            <input
              name="gtaMarkupPercent"
              type="number"
              min={0}
              max={500}
              step="0.1"
              required
              className="mt-1 w-32 rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={gtaMarkupPercent}
            />
          </label>
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
            Save uplift
          </button>
        </ValidatedForm>
        {gtaInForce ? (
          <div className="mt-5" data-gta-in-force={gtaInForce.effectiveFrom}>
            <h3 className="text-sm font-semibold text-navy">
              Table in force from {formatUkDate(gtaInForce.effectiveFrom)}
            </h3>
            <p className="mt-1 text-xs text-slate">Source: {gtaInForce.source}</p>
            <ul className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-sm tabular sm:grid-cols-5 lg:grid-cols-7">
              {Object.entries(gtaInForce.rates).map(([group, pence]) => (
                <li key={group}>
                  {group} {formatGbp(pence)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue">
            No GTA table is in force today. No daily rate can be taken until the published table is added below.
          </p>
        )}
        {gtaTables.length > 1 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-teal-dark underline">Other tables ({gtaTables.length - 1})</summary>
            <ul className="mt-2 space-y-1">
              {gtaTables
                .filter((table) => table.id !== gtaInForce?.id)
                .map((table) => (
                  <li key={table.id}>
                    From {formatUkDate(table.effectiveFrom)} · {Object.keys(table.rates).length} groups · {table.source}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-teal-dark underline">Add a new GTA table</summary>
          <form method="post" action="/settings/gta-table" className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Applies to hires reserved from
              <input name="effectiveFrom" type="date" required className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              Source (the published table and its date)
              <input name="source" required className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm sm:col-span-2">
              Figures in pounds excluding VAT, one group per line (for example S1 42.32)
              <textarea name="figures" required rows={8} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm" />
            </label>
            <button className="rounded-md bg-navy px-4 py-2 text-sm text-white sm:w-fit" type="submit">
              Add table
            </button>
          </form>
        </details>
      </section>
      <section id="fleet-gta-rules" className="scroll-mt-16 rounded-xl border border-line bg-card p-5" data-fleet-gta-rules={fleetGtaRules.length}>
        <h2 className="font-serif text-xl text-navy-deep">GTA group of fleet cars</h2>
        <p className="mt-1 text-sm text-slate">
          A rule here suggests the GTA group for a fleet car with this make and model when its record has none. The model can be the whole model or its
          first words, as on the V5C. Where no rule matches, or two rules disagree, nothing is suggested and staff choose. A suggestion is checked before it
          is saved. No rules are set up for you.
        </p>
        {fleetGtaRules.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {fleetGtaRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3" data-fleet-gta-rule={rule.id}>
                <span>
                  {rule.make} {rule.model} → <strong>{rule.gtaGroup}</strong>
                  <span className="text-slate">
                    {" "}
                    · added {formatUkDate(rule.createdAt)}
                    {rule.createdByName ? ` by ${rule.createdByName}` : ""}
                  </span>
                </span>
                <form method="post" action="/settings/fleet-gta-rules">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <button type="submit" className="text-teal-dark underline">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm">No rules yet. Staff choose each fleet car&apos;s group.</p>
        )}
        <form method="post" action="/settings/fleet-gta-rules" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="action" value="add" />
          <label className="text-sm">
            Make
            <input name="make" required className="mt-1 w-40 rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder="e.g. TOYOTA" />
          </label>
          <label className="text-sm">
            Model, or its first words
            <input name="model" required className="mt-1 w-56 rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder="e.g. YARIS ICON" />
          </label>
          <label className="text-sm">
            GTA group
            <select name="group" required defaultValue="" className="mt-1 rounded-md border border-line bg-white px-3 py-2 text-sm">
              <option value="" disabled>
                Choose
              </option>
              {fleetGroups.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
            Add rule
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Indicative charge defaults</h2>
        <p className="mt-1 text-sm text-slate">
          Recovery, out of hours, environmental, winch and the card fee fill in on the Recovery screen. A different figure
          can still be typed on that job. The card fee is added only when Card fee is ticked. Storage and the other
          amounts are not added unless someone enters them. A range is not a chosen rate.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>Storage {formatGbp(INDICATIVE_DEFAULTS.storage_per_day_net_pence)}/day + VAT</li>
          <li>Recovery {formatGbp(INDICATIVE_DEFAULTS.recovery_net_pence)} + VAT</li>
          <li>Out of hours {formatGbp(INDICATIVE_DEFAULTS.ooh_net_pence)} + VAT</li>
          <li>Environmental {formatGbp(INDICATIVE_DEFAULTS.environmental_net_pence)} + VAT</li>
          <li>Winch {formatGbp(INDICATIVE_DEFAULTS.winch_net_pence)} + VAT</li>
          <li>Card fee {(INDICATIVE_DEFAULTS.card_fee_rate * 100).toFixed(1)}% of the amount paid, VAT included, then VAT on that fee</li>
          <li>Gate fee {formatGbp(INDICATIVE_DEFAULTS.gate_fee_net_pence)} + VAT</li>
          <li>
            CDW {formatGbp(INDICATIVE_DEFAULTS.cdw_per_day_net_pence_range[0])}–
            {formatGbp(INDICATIVE_DEFAULTS.cdw_per_day_net_pence_range[1])}/day + VAT
          </li>
          <li>Delivery/collection {formatGbp(INDICATIVE_DEFAULTS.delivery_collection_net_pence)} + VAT</li>
        </ul>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Chase reminder intervals</h2>
        <p className="mt-1 text-sm text-slate">
          After an outstanding request is marked as sent, the file is flagged if the outcome has not been logged within
          this many calendar days. Each type has its own default. The payment reminder uses the same three-day demonstration
          default. It is not the insurer payment term. The default is due on receipt unless that insurer has its own term. A longer interval can still be set on an individual
          file (for example where an insurer has agreed a slower chase). Reminders only — no email is sent
          automatically. Changing these numbers later does not reopen a chase that has already been cancelled, paused,
          or cleared by a logged outcome, and does not overwrite a per-file override.
        </p>
        <ValidatedForm action={actionSaveChaseIntervals} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
          <RecordVersionField version={versionFor("settings-chase-intervals")} />
          <label className="text-sm">
            Engineer report (days)
            <input
              name="engineerChaseIntervalDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={engineerChaseIntervalDays}
            />
          </label>
          <label className="text-sm">
            Liability response (days)
            <input
              name="liabilityChaseIntervalDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={liabilityChaseIntervalDays}
            />
          </label>
          <label className="text-sm">
            Repair authorisation (days)
            <input
              name="repairAuthChaseIntervalDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={repairChaseIntervalDays}
            />
          </label>
          <label className="text-sm">
            Payment reminder (days)
            <input
              name="paymentChaseIntervalDays"
              type="number"
              min={1}
              step={1}
              required
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={paymentChaseIntervalDays}
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white sm:col-span-3">
            Save chase intervals
          </button>
        </ValidatedForm>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Storage daily rate</h2>
        <p className="mt-1 text-sm text-slate">
          Used when a file has no rate of its own. The standard is £39 a day. Changing this does not change a rate already stored on a file.
        </p>
        <ValidatedForm action={actionSaveStorageDailyRate} className="mt-4 flex flex-wrap items-end gap-3">
          <RecordVersionField version={versionFor("settings-storage-rate")} />
          <label className="text-sm">
            Daily rate (£)
            <input
              name="storageDailyRate"
              inputMode="decimal"
              required
              defaultValue={(storageDailyRate / 100).toFixed(2)}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save storage rate
          </button>
        </ValidatedForm>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Recovery standard fees</h2>
        <p className="mt-1 text-sm text-slate">
          These fill in on a new claim. Changing a fee here does not change a fee already stored on a file. Amounts are plus VAT.
        </p>
        <form action="/settings/recovery-fees" method="post" className="mt-4 grid gap-3 sm:grid-cols-2">
          <RecordVersionField version={versionFor("settings-recovery-fees")} />
          {RECOVERY_FEE_DEFS.map((fee) => (
            <label key={fee.key} className="block text-sm">
              {fee.label} (£)
              <input
                name={fee.settingKey}
                defaultValue={filledPounds(recoveryFeeSchedule()[fee.key])}
                className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              />
            </label>
          ))}
          <label className="block text-sm">
            Card fee (%)
            <input
              name="recovery_card_fee_percent"
              defaultValue={String(recoveryCardFeePercent())}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-slate">Added only when a payment is recorded as Paying by card, or a draft invoice is prepared for a card payment. Worked out on the net amount being paid, then VAT is added to the fee. Any head of loss.</span>
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white sm:col-span-2">
            Save recovery fees
          </button>
        </form>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Default vehicle location</h2>
        <p className="mt-1 text-sm text-slate">
          Used on letters (including Instruct Engineer) when a claim has no vehicle location recorded. Recovered
          vehicles normally sit at CAS premises. A location saved on a file is never overwritten by this default.
        </p>
        <ValidatedForm action={actionSaveDefaultVehicleLocation} className="mt-4 space-y-3">
          <RecordVersionField version={versionFor("settings-vehicle-location")} />
          <label className="block text-sm">
            Address
            <textarea
              name="defaultVehicleLocation"
              required
              rows={3}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
              defaultValue={defaultVehicleLocation}
            />
          </label>
          <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            Save default location
          </button>
        </ValidatedForm>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Engineers</h2>
        <p className="mt-1 text-sm text-slate">
          Instruction letters use this saved list (name, address, email). Instruct Engineer prepares a mailto email — it is not auto-sent.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/settings/engineers" className="font-semibold text-teal-dark underline">
            Manage engineers
          </Link>
        </p>
      </section>
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Staff (all signed-in staff see every file)</h2>
        <p className="mt-1 text-sm text-slate">
          Demonstration passwords are in docs/AUTH-NOTES.md. Passwords are stored hashed. This PC only — not a shared office login server.
        </p>
        {admin ? (
          <p className="mt-2 text-sm">
            <Link href="/settings/staff" className="font-semibold text-teal-dark underline">
              Manage staff logins
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate">Only an administrator can add, disable or reset staff logins.</p>
        )}
        <ul className="mt-3 space-y-1 text-sm">
          {staff.map((s) => (
            <li key={s.id}>
              {s.name} — {s.role} — {s.email}
              {s.username ? ` — username ${s.username}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] gap-3">
      <dt className="text-slate">{label}</dt>
      <dd className="ref">{value}</dd>
    </div>
  );
}

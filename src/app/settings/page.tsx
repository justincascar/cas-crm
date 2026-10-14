import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import Link from "next/link";
import { actionSaveAgreementLimits, actionSaveChaseIntervals, actionSaveDefaultVehicleLocation, actionSaveGtaMarkup, actionSaveStorageDailyRate, actionTestMailboxConnection } from "@/app/settings-actions";
import { isAdministrator } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/session";
import { dbLocation, getSettings, listStaff } from "@/lib/db/queries";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { getStorageDailyRatePence } from "@/lib/db/storage-charge";
import { getAgreementApproachingDay, getAgreementMaxDays, getChaseIntervalDays } from "@/lib/db/chase";
import { getRepairGapThresholdDays } from "@/lib/db/repair-progress";
import { listInsurerPaymentTerms } from "@/lib/db/insurers";
import { accountCanManageBankDetails } from "@/lib/db/permissions";
import { PAYMENT_DUE_ON_RECEIPT, PAYMENT_DUE_ON_RECEIPT_SENTENCE } from "@/lib/constants";
import { getGtaMarkupPercent } from "@/lib/db/hire-agreement";
import { getInsurerPaymentDetails } from "@/lib/db/payment-details";
import { GTA_RATE_PERIOD_LABEL } from "@/lib/documents/gta";
import { EmailSendModeBanner } from "@/components/EmailSendModeBanner";
import { CAS_CLAIMS_MAILBOX, INDICATIVE_DEFAULTS } from "@/lib/constants";
import { mailboxIsConnected } from "@/lib/email/microsoft-graph";
import { emailSendBanner } from "@/lib/email/send-mode";
import { formatGbp } from "@/lib/money";
import { formatUkDateTime } from "@/lib/dates";
import { currentCasInsuranceDocument } from "@/lib/db/company-insurance";
import { PAYMENT_REQUEST_PACK_MISSING } from "@/lib/email/payment-request-pack";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; mailboxCheck?: string; mailboxCheckError?: string }>;
}) {
  const staffUser = await requireStaff();
  const { error, saved, mailboxCheck, mailboxCheckError } = await searchParams;
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
  const insurerTerms = listInsurerPaymentTerms();
  const agreementRenewalAlertDay = getChaseIntervalDays("hire_agreement_renewal");
  const agreementRenewalApproachingDay = getAgreementApproachingDay();
  const agreementMaxDays = getAgreementMaxDays();
  const repairProgressGapDays = getRepairGapThresholdDays();
  const gtaMarkupPercent = getGtaMarkupPercent();
  const paymentDetails = getInsurerPaymentDetails();
  const casInsurance = currentCasInsuranceDocument();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Prototype configuration. Administrator and staff can open every file. Driver and bodyshop / mechanic can open only the jobs assigned to them today."
      />
      <EmailSendModeBanner />
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
      <section className="rounded-xl border border-warn/40 bg-[#fff6e8] p-5">
        <h2 className="font-serif text-xl text-navy-deep">Hire agreement length — decision needed</h2>
        <p className="mt-2 text-sm">
          The supplied Hire Pack caps the Rental Period at <strong>89 days</strong> from the date of the agreement. CRM
          renewal alerts use a separate CAS operational limit of <strong>{agreementMaxDays} days</strong>, with an amber
          warning from day <strong>{agreementRenewalApproachingDay}</strong> and a red reminder from day{" "}
          <strong>{agreementRenewalAlertDay}</strong>. Neither the pack wording nor this operational limit has been
          silently aligned. Confirm with the solicitor which figure is correct before live enforcement.
        </p>
        <ValidatedForm action={actionSaveAgreementLimits} className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
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
        <h2 className="font-serif text-xl text-navy-deep">Repair progress gap — review prompt</h2>
        <p className="mt-2 text-sm">
          An inclusive gap of this many days between two recorded repair steps is flagged until someone explains it. 14
          days is not flagged. {repairProgressGapDays} is. This is a review prompt awaiting confirmation. It is not a
          legal limit, and it does not change hire agreement renewal days.
        </p>
        <form method="post" action="/settings/repair-gap" className="mt-4 flex flex-wrap items-end gap-3">
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
          <Row label="Agreement maximum days" value={settings.agreement_max_days} />
          <Row label="Renewal approaching (amber) day" value={settings.agreement_renewal_approaching_day} />
          <Row label="Renewal due (red) day" value={settings.agreement_renewal_alert_day} />
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
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">GTA daily rate</h2>
        <p className="mt-1 text-sm text-slate">
          The daily rate on a hire agreement is the GTA ceiling for the client&apos;s own vehicle group, plus this markup.
          The ceilings are the supplied table for hires from {GTA_RATE_PERIOD_LABEL}. The July 2025 – June 2026 workbook is not used. The
          vehicle CAS supplies is recorded separately and is not used for the rate.
        </p>
        <ValidatedForm action={actionSaveGtaMarkup} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            CAS markup (%)
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
            Save markup
          </button>
        </ValidatedForm>
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
          <li>Card fee {(INDICATIVE_DEFAULTS.card_fee_rate * 100).toFixed(1)}% of the net charges, before VAT, then VAT on that fee</li>
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
        <h2 className="font-serif text-xl text-navy-deep">Default vehicle location</h2>
        <p className="mt-1 text-sm text-slate">
          Used on letters (including Instruct Engineer) when a claim has no vehicle location recorded. Recovered
          vehicles normally sit at CAS premises. A location saved on a file is never overwritten by this default.
        </p>
        <ValidatedForm action={actionSaveDefaultVehicleLocation} className="mt-4 space-y-3">
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

import Link from "next/link";
import { ClaimTable, PageHeader, SearchForm } from "@/components/ClaimTable";
import { formatGbp } from "@/lib/money";
import { requireStaff } from "@/lib/auth/session";
import { dbLocation, getDashboard } from "@/lib/db/queries";
import { formatUkDate } from "@/lib/dates";
import type { ChaseView } from "@/lib/db/chase";
import type { PaymentAttentionRow } from "@/lib/db/payment-review";
import { chaseStageRowClass, chaseStageShortLabel, chaseStageTextClass } from "@/lib/domain/chase";
import { BANK_DETAILS_MISSING_SETTINGS, paymentDetailsComplete } from "@/lib/domain/payment-details";
import { getInsurerPaymentDetails, latestBankDetailsChange } from "@/lib/db/payment-details";
import { getRepairGapThresholdDays } from "@/lib/db/repair-progress";

const toneClass: Record<string, string> = {
  info: "border-l-teal",
  warn: "border-l-warn",
  bad: "border-l-overdue",
  ok: "border-l-ok",
};

function AttentionTable({
  title,
  hint,
  rows,
  stage,
}: {
  title: string;
  hint: string;
  rows: PaymentAttentionRow[];
  stage: string;
}) {
  return (
    <section className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">{title}</h2>
      <p className="mb-4 text-sm text-slate">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate">None.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Client</th>
              <th>Stage</th>
              <th>Next action</th>
              <th>Since</th>
              <th>Handler</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="bg-[#fff6e8]">
                <td>
                  <Link href={row.href} className="ref text-teal-dark hover:underline">
                    {row.fileReference}
                  </Link>
                </td>
                <td>{row.clientName}</td>
                <td className="font-semibold text-warn">{stage}</td>
                <td>
                  <Link href={row.href} className="text-navy-deep underline">
                    {row.label}
                  </Link>
                </td>
                <td>{row.occurredAt ? formatUkDate(row.occurredAt) : "Open"}</td>
                <td>{row.handlerName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ChaseDueTable({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: ChaseView[];
}) {
  return (
    <section className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">{title}</h2>
      <p className="mb-4 text-sm text-slate">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate">None due.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Client</th>
              <th>Stage</th>
              <th>Next action</th>
              <th>Due</th>
              <th>Handler</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.claimId}`} className={chaseStageRowClass(row.severity)}>
                <td>
                  <Link href={`/claims/${row.claimId}`} className="ref text-teal-dark hover:underline">
                    {row.fileReference}
                  </Link>
                </td>
                <td>{row.clientName || "Unknown"}</td>
                <td className={chaseStageTextClass(row.severity)}>{chaseStageShortLabel(row.severity)}</td>
                <td>{row.label || row.dueLabel}</td>
                <td>{row.dueAt ? formatUkDate(row.dueAt) : "Unknown"}</td>
                <td>{row.handlerName || "Unassigned"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  await requireStaff();
  const data = getDashboard();
  const path = dbLocation();
  const bankDetailsMissing = !paymentDetailsComplete(getInsurerPaymentDetails());
  const bankChange = latestBankDetailsChange();
  const repairGapDays = getRepairGapThresholdDays();

  return (
    <div>
      <PageHeader
        title="Claims desk"
        subtitle="Counts open the matching list. Claimed, agreed and received are shown separately and are never added together."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link href="/jobs" className="min-h-11 rounded-md bg-navy px-4 py-2 text-center text-base font-semibold text-white">
              My jobs today
            </Link>
            <SearchForm action="/claims" />
          </div>
        }
      />

      {bankDetailsMissing ? (
        <p className="mt-4 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm font-semibold">{BANK_DETAILS_MISSING_SETTINGS}</p>
      ) : null}
      {bankChange ? (
        <p className="mt-4 rounded-md border border-line bg-card px-4 py-3 text-sm">
          Bank details changed on {formatUkDate(bankChange.at)} by {bankChange.actorName}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {data.cards.map((card) => (
          <Link
            key={card.key}
            href={card.href || `/claims?queue=${card.key}`}
            className={`rounded-xl border border-line border-l-4 bg-card p-4 shadow-[0_1px_0_rgba(16,28,36,0.04)] ${toneClass[card.tone] || "border-l-teal"}`}
          >
            <p className="text-xs uppercase tracking-[0.12em] text-slate">{card.label}</p>
            <p className="mt-2 font-serif text-4xl tabular text-navy-deep">{card.count}</p>
          </Link>
        ))}
      </section>

      <AttentionTable
        title="Awaiting decision"
        hint="A payment has been recorded and does not cover that head of loss. It stays here until someone opens it. Recording the payment does not make the choice."
        rows={data.awaitingDecisions}
        stage="Awaiting decision"
      />
      <AttentionTable
        title="Payments to review"
        hint="Money arrived on a head that was already accepted as the final figure. It was not added to the agreed or received figures."
        rows={data.paymentsAfterSettlement}
        stage="Review"
      />
      <ChaseDueTable
        title="Liability response chases due"
        hint="Starts when a liability enquiry has been sent. Clears only when a staff member logs an insurer decision (accepted, rejected or partial), or pauses/cancels this chase. Disputed / unclear on the file is not a decision. Reminder only — no email is sent automatically."
        rows={data.chasesDueByKind.liability_response}
      />
      <ChaseDueTable
        title="Engineer report chases due"
        hint="Reminders only — no email is sent automatically. Logging the report received, or pausing/cancelling on the file, clears the flag immediately."
        rows={data.chasesDueByKind.engineer_report}
      />
      <ChaseDueTable
        title="Repair authorisation and total-loss agreement"
        hint="The same chase. On a repairable file it is called a repair authorisation chase. On a total loss it is called a total-loss agreement chase. It starts when that request has been marked as sent, and clears when staff log the authorisation or agreement, or payment received. Reminder only — no email is sent automatically."
        rows={data.chasesDueByKind.repair_authorisation}
      />
      <ChaseDueTable
        title="Client paper chases due"
        hint="Driving licence, insurance certificate and logbook (V5C) are due 24 hours after the client welcome was marked as sent. Bank statements are due 24 hours after the hire agreement is generated. Each repeats 24 hours after a reminder is marked sent, and clears as soon as the paper is on file. Reminder only — no email is sent automatically."
        rows={data.chasesDue.filter((row) => String(row.kind).startsWith("document_"))}
      />
      <ChaseDueTable
        title="Total-loss payment chases due"
        hint="After the total-loss notification is marked sent: every 3 days until the insurer confirms they are sending payment, then every 7 days until the amount received matches the agreed vehicle-damage figure. A part-payment does not clear it. Reminder only — no email is sent automatically."
        rows={data.chasesDue.filter((row) => row.kind === "total_loss_payment")}
      />
      <ChaseDueTable
        title="Repair invoice payments"
        hint="Follows the agreed repair invoice only. Storage is not included. The first email is prepared for you to send. After that, a reminder is due on the payment reminder interval (three days unless this file has an override). A part-payment pauses it. Nothing is sent until you click Send. Payment is due on receipt unless that insurer has its own term."
        rows={data.chasesDue.filter((row) => row.kind === "repair_payment")}
      />
      <ChaseDueTable
        title="Total-loss settlement payments"
        hint="Follows the agreed total-loss settlement. A part-payment pauses this chase and is not treated as paid. Full payment stops it and flags hire and storage for review. Nothing is sent until you click Send."
        rows={data.chasesDue.filter((row) => row.kind === "settlement_payment")}
      />
      <ChaseDueTable
        title="Hire payment chases due"
        hint="Starts only after the replacement has been handed over, the hire end is confirmed, and a hire payment request has been recorded as sent. With no handover there is no figure and no chase. It follows the agreed figure, or the confirmed claimed figure if nothing is agreed. A part-payment pauses it. Nothing is sent until you click Send, and nothing is sent while bank details are missing in Settings."
        rows={data.chasesDue.filter((row) => row.kind === "hire_payment")}
      />
      <ChaseDueTable
        title="Storage payment chases due"
        hint="Starts only after a storage start date exists, the storage end is confirmed, and a storage payment request has been recorded as sent. With no start date there is no figure and no chase. It follows the agreed figure, or the confirmed claimed figure if nothing is agreed. A part-payment pauses it. Full payment flags the other charges for review and does not close them. Nothing is sent until you click Send."
        rows={data.chasesDue.filter((row) => row.kind === "storage_payment")}
      />
      <ChaseDueTable
        title="Recovery payment chases due"
        hint="Starts once the recovery claimed figure is on the file and a recovery payment request has been recorded as sent. Recovery has no end date. Nothing is sent until you click Send."
        rows={data.chasesDue.filter((row) => row.kind === "recovery_payment")}
      />
      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Repair progress gaps to explain</h2>
        <p className="mb-4 text-sm text-slate">
          A repair step {repairGapDays} or more days after the previous one, or nothing recorded for that many days
          since the last step. The next day counts as 1. {repairGapDays - 1} days is not flagged. An explanation of the
          gap since the last step is looked at again after another {repairGapDays} days. Chasers do not reset the gap.
          Confirmed by Justin on 15/10/2026. This is a review prompt, not a legal limit.
        </p>
        {data.repairProgressGaps.length === 0 ? (
          <p className="text-sm text-slate">None.</p>
        ) : (
          <table className="ledger-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Client</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {data.repairProgressGaps.map((row) => (
                <tr key={`${row.claimId}-${row.wording}`} className="bg-[#fff6e8]">
                  <td>
                    <Link href={`/claims/${row.claimId}#hire-repair-chronology`} className="ref text-teal-dark hover:underline">
                      {row.fileReference}
                    </Link>
                  </td>
                  <td>{row.clientName}</td>
                  <td>{row.wording}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <ChaseDueTable
        title="Hire agreement renewals"
        hint="Counted from the current signed hire agreement start date, not the fleet booking dates. Amber from day 70 (approaching), red from day 80 (due), red overdue from day 88 if still not renewed. Courtesy cars are excluded unless a hire agreement is on the file. Clears only when a renewal is logged — it does not disappear just because time passes. Reminder only — no email is sent automatically."
        rows={data.chasesDueByKind.hire_agreement_renewal}
      />

      <section className="mt-8 grid gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-line bg-card p-5 xl:col-span-2">
          <h2 className="font-serif text-xl text-navy-deep">Tasks by handler</h2>
          <p className="mb-4 text-sm text-slate">Due today and overdue only. Open tasks for the full list.</p>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Handler</th>
                <th>Due today</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byHandler).map(([name, counts]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="tabular">{counts.today}</td>
                  <td className="tabular text-overdue">{counts.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Fleet snapshot</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>Available: <strong className="tabular">{data.fleetMap.available || 0}</strong></li>
            <li>Reserved: <strong className="tabular">{data.fleetMap.reserved || 0}</strong></li>
            <li>On hire / courtesy: <strong className="tabular">{data.fleetMap.on_hire || 0}</strong></li>
            <li>Maintenance: <strong className="tabular">{data.fleetMap.maintenance || 0}</strong></li>
          </ul>
          <p className="mt-4 text-xs text-slate">Reservation does not start charges. See Hire / Fleet.</p>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Amounts by head of loss</h2>
        <p className="mb-4 text-sm text-slate">
          Claimed, offered, agreed and received are four different figures. An offer is not a payment.
        </p>
        <div className="overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Head</th>
                <th>Claimed</th>
                <th>Offered</th>
                <th>Agreed</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byHead).map(([head, sums]) => (
                <tr key={head}>
                  <td>{data.headLabels[head] || head}</td>
                  <td className="tabular">{formatGbp(sums.claimed)}</td>
                  <td className="tabular">{formatGbp(sums.offered)}</td>
                  <td className="tabular">{formatGbp(sums.agreed)}</td>
                  <td className="tabular">{formatGbp(sums.received)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Distinct totals</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.claimed)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.offered)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.agreed)}</strong>
                </td>
                <td className="tabular">
                  <strong>{formatGbp(data.totals.received)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-xl text-navy-deep">All prototype files</h2>
        <ClaimTable rows={data.claims} />
      </section>

      <p className="mt-8 text-xs text-slate">
        Data is stored on this PC at <span className="ref">{path}</span> (kept off OneDrive to avoid file locking).
        Changes survive closing the browser.
      </p>
    </div>
  );
}

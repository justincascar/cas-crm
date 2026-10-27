import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ClaimTable, PageHeader, SearchForm } from "@/components/ClaimTable";
import { RuleHint } from "@/components/dashboard/RuleHint";
import { TodaysWork, type PreparedDeskEmail } from "@/components/dashboard/TodaysWork";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { formatGbp } from "@/lib/money";
import { requireStaff } from "@/lib/auth/session";
import { HEAD_LABELS, type HeadOfLoss } from "@/lib/constants";
import { dbLocation, getDashboard } from "@/lib/db/queries";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { draftPayload, listOpenClaimDrafts } from "@/lib/db/claim-drafts";
import { findPreparedChase, type ChaseView } from "@/lib/db/chase";
import { chaseStageRowClass, chaseStageTextClass, isChaseKind } from "@/lib/domain/chase";
import { liveEmailSending } from "@/lib/email/send-mode";
import { loadClash } from "@/lib/db/record-version";
import type { PaymentAttentionRow } from "@/lib/db/payment-review";
import { deskItemTitle, nothingDueLine } from "@/lib/domain/todays-work";
import { DASHBOARD_SCOPE_COOKIE, resolveDashboardScope, type DashboardScope } from "@/lib/domain/dashboard-scope";
import { dueRowClass, dueTextClass, dueWording, type DueTone } from "@/lib/domain/due-wording";
import type { HeadMoneyRow, OverpaymentNote } from "@/lib/domain/head-outstanding";
import { BANK_DETAILS_MISSING_SETTINGS, paymentDetailsComplete } from "@/lib/domain/payment-details";
import { getInsurerPaymentDetails, latestBankDetailsChange } from "@/lib/db/payment-details";
import { getRepairGapThresholdDays } from "@/lib/db/repair-progress";

type AttentionRow = Omit<PaymentAttentionRow, "head">;

const toneClass: Record<string, string> = {
  info: "border-l-teal",
  warn: "border-l-warn",
  bad: "border-l-overdue",
  ok: "border-l-ok",
};

function headName(head: string): string {
  return HEAD_LABELS[head as HeadOfLoss] || head;
}

function chaseWhen(row: ChaseView): { text: string; tone: DueTone } {
  if (row.kind === "hire_agreement_renewal") {
    if (row.severity === "red_overdue") {
      const timed = dueWording(row.dueAt);
      if (timed.tone === "overdue") return timed;
      return { text: "Overdue", tone: "overdue" };
    }
    if (row.severity === "amber") return { text: "Approaching", tone: "soon" };
    return { text: "Due", tone: "today" };
  }
  return dueWording(row.dueAt);
}

function AttentionTable({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: AttentionRow[];
}) {
  return (
    <section className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">{title}</h2>
      <RuleHint text={hint} />
      <table className="ledger-table ledger-fit">
        <thead>
          <tr>
            <th>File</th>
            <th>Client</th>
            <th>Item</th>
            <th>When</th>
            <th>Handler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const when = row.occurredAt ? dueWording(row.occurredAt) : { text: "Open", tone: "today" as DueTone };
            return (
            <tr key={row.id} className={dueRowClass(when.tone)}>
              <td>
                <Link href={row.href} className="ref text-teal-dark hover:underline">
                  {row.fileReference}
                </Link>
              </td>
              <td>{row.clientName}</td>
              <td>
                <Link href={row.href} className="text-navy-deep underline">
                  {row.label}
                </Link>
              </td>
              <td className={dueTextClass(when.tone)}>{when.text}</td>
              <td>{row.handlerName}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ChaseDueTable({ title, hint, rows }: { title: string; hint: string; rows: ChaseView[] }) {
  return (
    <section className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">{title}</h2>
      <RuleHint text={hint} />
      <table className="ledger-table ledger-fit">
        <thead>
          <tr>
            <th>File</th>
            <th>Client</th>
            <th>Item</th>
            <th>When</th>
            <th>Handler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const when = chaseWhen(row);
            const renewal = row.kind === "hire_agreement_renewal";
            return (
              <tr key={`${row.kind}-${row.claimId}`} className={renewal ? chaseStageRowClass(row.severity) : dueRowClass(when.tone)}>
                <td>
                  <Link href={`/claims/${row.claimId}`} className="ref text-teal-dark hover:underline">
                    {row.fileReference}
                  </Link>
                </td>
                <td>{row.clientName || "Unknown"}</td>
                <td>{deskItemTitle(row.label || row.dueLabel)}</td>
                <td className={renewal ? chaseStageTextClass(row.severity) : dueTextClass(when.tone)}>{when.text}</td>
                <td>{row.handlerName || "Unassigned"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ClaimedCell({ row }: { row: HeadMoneyRow }) {
  if (row.confirmedClaimedPence > 0 && row.provisionalClaimedPence > 0) {
    return (
      <div>
        <div>Confirmed {formatGbp(row.confirmedClaimedPence)}</div>
        <div>Provisional {formatGbp(row.provisionalClaimedPence)}</div>
      </div>
    );
  }
  if (row.provisionalClaimedPence > 0) return <span>Provisional {formatGbp(row.provisionalClaimedPence)}</span>;
  return <span>{formatGbp(row.confirmedClaimedPence)}</span>;
}

function OutstandingCell({ pence }: { pence: number | null }) {
  if (pence === null) return <span>none</span>;
  return <span>{formatGbp(Math.max(0, pence))}</span>;
}

function overpaymentText(note: OverpaymentNote): string {
  const compared = note.basis === "agreed" ? "agreed" : "confirmed claimed";
  return `${note.fileReference} ${headName(note.head)}: ${formatGbp(note.receivedPence)} received, ${formatGbp(note.comparisonPence)} ${compared}. This is an overpayment, not a normal balance.`;
}

function ScopeSwitch({ scope }: { scope: DashboardScope }) {
  const button = (value: DashboardScope, label: string) => (
    <button
      type="submit"
      name="scope"
      value={value}
      aria-pressed={scope === value}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${scope === value ? "bg-navy text-white" : "border border-line bg-card text-navy"}`}
    >
      {label}
    </button>
  );
  return (
    <form method="post" action="/dashboard-scope" className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate">Show</span>
      {button("mine", "My claims")}
      {button("all", "All claims")}
    </form>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; undo?: string; prepare?: string; workError?: string; clash?: string }>;
}) {
  const staff = await requireStaff();
  const query = await searchParams;
  const jar = await cookies();
  const scope = resolveDashboardScope(staff, query.scope, jar.get(DASHBOARD_SCOPE_COOKIE)?.value);
  const data = getDashboard({ handlerId: scope === "mine" ? staff.id : null });
  const clash = loadClash(query.clash);
  const preparedItem = query.prepare
    ? data.todaysWork.flatMap((row) => [row.lead, ...row.rest]).find((item) => item.id === query.prepare)
    : undefined;
  let prepared: PreparedDeskEmail | null = null;
  if (preparedItem?.chaseKind && isChaseKind(preparedItem.chaseKind)) {
    const email = findPreparedChase(preparedItem.chaseKind, preparedItem.claimId);
    if (email) {
      prepared = {
        itemId: preparedItem.id,
        claimId: preparedItem.claimId,
        correspondenceId: String(email.id),
        subject: String(email.subject || ""),
        to: String(email.to_address || ""),
        body: String(email.body || ""),
      };
    }
  }
  const path = dbLocation();
  const bankDetailsMissing = !paymentDetailsComplete(getInsurerPaymentDetails());
  const bankChange = latestBankDetailsChange();
  const repairGapDays = getRepairGapThresholdDays();
  const taskHandlers = Object.entries(data.byHandler).filter(([, counts]) => counts.today > 0 || counts.overdue > 0);

  const empty: string[] = [];
  const blocks: ReactNode[] = [];
  const keep = (name: string, count: number, node: ReactNode) => {
    if (count === 0) empty.push(name);
    else blocks.push(node);
  };

  const drafts = listOpenClaimDrafts();

  keep(
    "Today's work",
    data.todaysWork.length,
    <section key="today" className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Today&apos;s work</h2>
      <p className="mb-4 text-sm text-slate">One row per claim. The row is that claim&apos;s most urgent item. Deadline first, then money still running, then the rest.</p>
      {query.workError ? <p className="mb-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.workError}</p> : null}
      <SaveClashNotice clash={clash} reloadHref="/" />
      <TodaysWork
        rows={data.todaysWork}
        bankDetailsMissing={bankDetailsMissing}
        liveSending={liveEmailSending()}
        undoId={query.undo || null}
        prepared={prepared}
      />
    </section>,
  );
  const sections = DeskSections({ data, repairGapDays, taskHandlers, blocks, keep });
  const quiet = nothingDueLine(empty);

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

      <ScopeSwitch scope={scope} />

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
            href={card.href}
            className={`rounded-xl border border-line border-l-4 bg-card p-4 shadow-[0_1px_0_rgba(16,28,36,0.04)] ${toneClass[card.tone] || "border-l-teal"}`}
          >
            <p className="text-xs uppercase tracking-[0.12em] text-slate">{card.label}</p>
            <p className="mt-2 font-serif text-4xl tabular text-navy-deep">{card.count}</p>
            {card.note ? <p className="mt-2 text-xs text-slate">{card.note}</p> : null}
          </Link>
        ))}
      </section>

      {drafts.length ? (
        <section className="mt-8 rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">New enquiries / incomplete</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {drafts.map((draft) => {
              const fields = draftPayload(draft);
              const name = [fields.client_forename, fields.client_surname].filter(Boolean).join(" ") || "Unnamed enquiry";
              return (
                <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {name}
                    <span className="ml-2 text-slate">saved {formatUkDateTime(draft.updated_at)}</span>
                  </span>
                  <Link className="font-semibold text-navy" href={`/claims/new?draft=${draft.id}`}>
                    Continue
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {sections}

      {quiet ? <p className="mt-8 text-sm text-slate">{quiet}</p> : null}
      <p className="mt-3 text-sm">
        <Link href="/gaps" className="text-teal-dark underline">
          Gaps to explain before any dispute
          {data.finishedRepairGaps.length > 0 ? ` (${data.finishedRepairGaps.length})` : ""}
        </Link>
      </p>

      <section className="mt-8">
        <div className="max-w-md rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Fleet snapshot</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              Available:{" "}
              <Link href="/hire?status=available" className="font-semibold tabular text-teal-dark underline">
                {data.fleetMap.available || 0}
              </Link>
            </li>
            <li>
              Reserved:{" "}
              <Link href="/hire?status=reserved" className="font-semibold tabular text-teal-dark underline">
                {data.fleetMap.reserved || 0}
              </Link>
            </li>
            <li>
              On hire / courtesy:{" "}
              <Link href="/hire?status=on_hire" className="font-semibold tabular text-teal-dark underline">
                {data.fleetMap.on_hire || 0}
              </Link>
            </li>
            <li>
              Maintenance:{" "}
              <Link href="/hire?status=maintenance" className="font-semibold tabular text-teal-dark underline">
                {data.fleetMap.maintenance || 0}
              </Link>
            </li>
          </ul>
          {data.activeHireNote ? <p className="mt-3 text-xs text-slate">{data.activeHireNote}</p> : null}
          <p className="mt-4 text-xs text-slate">Reservation does not start charges. See Hire / Fleet.</p>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Amounts by head of loss</h2>
        <RuleHint text="Claimed, offered, agreed and received are four different figures. An offer is not a payment." />
        <table className="ledger-table ledger-fit">
          <thead>
            <tr>
              <th>Head</th>
              <th>Claimed</th>
              <th>Offered</th>
              <th>Agreed</th>
              <th>Received</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data.moneyHeads.map((row) => (
              <tr key={row.head}>
                <td>{headName(row.head)}</td>
                <td className="tabular">
                  <ClaimedCell row={row} />
                </td>
                <td className="tabular">{formatGbp(row.offeredPence)}</td>
                <td className="tabular">{formatGbp(row.agreedPence)}</td>
                <td className="tabular">{formatGbp(row.receivedPence)}</td>
                <td className="tabular">
                  <OutstandingCell pence={row.outstandingPence} />
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Confirmed totals</strong>
              </td>
              <td className="tabular">
                <strong>{formatGbp(data.moneyConfirmed.claimedPence)}</strong>
              </td>
              <td className="tabular">
                <strong>{formatGbp(data.moneyConfirmed.offeredPence)}</strong>
              </td>
              <td className="tabular">
                <strong>{formatGbp(data.moneyConfirmed.agreedPence)}</strong>
              </td>
              <td className="tabular">
                <strong>{formatGbp(data.moneyConfirmed.receivedPence)}</strong>
              </td>
              <td className="tabular">
                <strong>
                  Outstanding <OutstandingCell pence={data.moneyConfirmed.outstandingPence} />
                </strong>
                {data.moneyConfirmed.overpaidPence > 0 ? (
                  <div className="font-semibold">Overpaid {formatGbp(data.moneyConfirmed.overpaidPence)}</div>
                ) : null}
              </td>
            </tr>
            {data.moneyConfirmed.overpaidPence > 0 ? (
              <tr>
                <td>Overpaid, to review</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td className="tabular font-semibold">{formatGbp(data.moneyConfirmed.overpaidPence)}</td>
              </tr>
            ) : null}
            <tr>
              <td>
                <strong>Provisional totals</strong>
              </td>
              <td className="tabular">
                <strong>Provisional {formatGbp(data.moneyProvisional.claimedPence)}</strong>
              </td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
        {data.moneyOverpayments.length > 0 ? (
          <div className="mt-4 space-y-1 text-sm text-overdue">
            {data.moneyOverpayments.map((note) => (
              <p key={`${note.claimId}-${note.head}`}>{overpaymentText(note)}</p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-xl text-navy-deep">All prototype files</h2>
        <ClaimTable rows={data.claims} compact />
      </section>

      <p className="mt-8 text-xs text-slate">
        Data is stored on this PC at <span className="ref">{path}</span> (kept off OneDrive to avoid file locking).
        Changes survive closing the browser.
      </p>
    </div>
  );
}

function DeskSections({
  data,
  repairGapDays,
  taskHandlers,
  blocks,
  keep,
}: {
  data: ReturnType<typeof getDashboard>;
  repairGapDays: number;
  taskHandlers: Array<[string, { today: number; overdue: number }]>;
  blocks: ReactNode[];
  keep: (name: string, count: number, node: ReactNode) => void;
}) {
  keep(
    "Awaiting decision",
    data.awaitingDecisions.length,
    <AttentionTable
      key="awaiting"
      title="Awaiting decision"
      hint="A payment has been recorded and does not cover that head of loss. It stays here until someone opens it. Recording the payment does not make the choice."
      rows={data.awaitingDecisions}
    />,
  );
  const claimNames = new Map(data.claims.map((row) => [row.id, { client: row.client_name || "Unknown", handler: row.handler_name || "Unassigned" }]));
  const overpaidRows: AttentionRow[] = data.moneyOverpayments.map((note) => ({
    id: `overpaid-${note.claimId}-${note.head}`,
    claimId: note.claimId,
    fileReference: note.fileReference,
    clientName: claimNames.get(note.claimId)?.client || "Unknown",
    handlerName: claimNames.get(note.claimId)?.handler || "Unassigned",
    label: `Overpaid, to review — ${headName(note.head)} ${formatGbp(note.overpaidPence)}`,
    href: `/claims/${note.claimId}`,
    occurredAt: null,
  }));
  const reviewRows: AttentionRow[] = [...data.paymentsAfterSettlement, ...overpaidRows];
  keep(
    "Payments to review",
    reviewRows.length,
    <AttentionTable
      key="review"
      title="Payments to review"
      hint="Money arrived on a head that was already accepted as the final figure. It was not added to the agreed or received figures. An overpayment is listed on its own and is not taken off money owed on another head."
      rows={reviewRows}
    />,
  );
  keep(
    "Liability response chases due",
    data.chasesDueByKind.liability_response.length,
    <ChaseDueTable
      key="liability"
      title="Liability response chases due"
      hint="Starts when a liability enquiry has been sent. Clears only when a staff member logs an insurer decision (accepted, rejected or partial), or pauses/cancels this chase. Disputed / unclear on the file is not a decision. Reminder only — no email is sent automatically."
      rows={data.chasesDueByKind.liability_response}
    />,
  );
  keep(
    "Engineer report chases due",
    data.chasesDueByKind.engineer_report.length,
    <ChaseDueTable
      key="engineer"
      title="Engineer report chases due"
      hint="Reminders only — no email is sent automatically. Logging the report received, or pausing/cancelling on the file, clears the flag immediately."
      rows={data.chasesDueByKind.engineer_report}
    />,
  );
  keep(
    "Repair authorisation and total-loss agreement",
    data.chasesDueByKind.repair_authorisation.length,
    <ChaseDueTable
      key="repair-auth"
      title="Repair authorisation and total-loss agreement"
      hint="The same chase. On a repairable file it is called a repair authorisation chase. On a total loss it is called a total-loss agreement chase. It starts when that request has been marked as sent, and clears when staff log the authorisation or agreement, or payment received. Reminder only — no email is sent automatically."
      rows={data.chasesDueByKind.repair_authorisation}
    />,
  );
  keep(
    "Client paper chases due",
    data.chasesDue.filter((row) => String(row.kind).startsWith("document_")).length,
    <ChaseDueTable
      key="papers"
      title="Client paper chases due"
      hint="Driving licence, insurance certificate and logbook (V5C) are due 24 hours after the client welcome was marked as sent. Bank statements are due 24 hours after the hire agreement is generated. Each repeats 24 hours after a reminder is marked sent, and clears as soon as the paper is on file. Reminder only — no email is sent automatically."
      rows={data.chasesDue.filter((row) => String(row.kind).startsWith("document_"))}
    />,
  );
  keep(
    "Total-loss payment chases due",
    data.chasesDue.filter((row) => row.kind === "total_loss_payment").length,
    <ChaseDueTable
      key="tl-pay"
      title="Total-loss payment chases due"
      hint="After the total-loss notification is marked sent: every 3 days until the insurer confirms they are sending payment, then every 7 days until the amount received matches the agreed vehicle-damage figure. A part-payment does not clear it. Reminder only — no email is sent automatically."
      rows={data.chasesDue.filter((row) => row.kind === "total_loss_payment")}
    />,
  );
  keep(
    "Repair invoice payments",
    data.chasesDue.filter((row) => row.kind === "repair_payment").length,
    <ChaseDueTable
      key="repair-pay"
      title="Repair invoice payments"
      hint="Follows the agreed repair invoice only. Storage is not included. The first email is prepared for you to send. After that, a reminder is due on the payment reminder interval (three days unless this file has an override). A part-payment pauses it. Nothing is sent until you click Send. Payment is due on receipt unless that insurer has its own term."
      rows={data.chasesDue.filter((row) => row.kind === "repair_payment")}
    />,
  );
  keep(
    "Total-loss settlement payments",
    data.chasesDue.filter((row) => row.kind === "settlement_payment").length,
    <ChaseDueTable
      key="settlement"
      title="Total-loss settlement payments"
      hint="Follows the agreed total-loss settlement. A part-payment pauses this chase and is not treated as paid. Full payment stops it and flags hire and storage for review. Nothing is sent until you click Send."
      rows={data.chasesDue.filter((row) => row.kind === "settlement_payment")}
    />,
  );
  keep(
    "Hire payment chases due",
    data.chasesDue.filter((row) => row.kind === "hire_payment").length,
    <ChaseDueTable
      key="hire-pay"
      title="Hire payment chases due"
      hint="Starts only after the replacement has been handed over, the hire end is confirmed, and a hire payment request has been recorded as sent. With no handover there is no figure and no chase. It follows the agreed figure, or the confirmed claimed figure if nothing is agreed. A part-payment pauses it. Nothing is sent until you click Send, and nothing is sent while bank details are missing in Settings."
      rows={data.chasesDue.filter((row) => row.kind === "hire_payment")}
    />,
  );
  keep(
    "Storage payment chases due",
    data.chasesDue.filter((row) => row.kind === "storage_payment").length,
    <ChaseDueTable
      key="storage-pay"
      title="Storage payment chases due"
      hint="Starts only after a storage start date exists, the storage end is confirmed, and a storage payment request has been recorded as sent. With no start date there is no figure and no chase. It follows the agreed figure, or the confirmed claimed figure if nothing is agreed. A part-payment pauses it. Full payment flags the other charges for review and does not close them. Nothing is sent until you click Send."
      rows={data.chasesDue.filter((row) => row.kind === "storage_payment")}
    />,
  );
  keep(
    "Recovery payment chases due",
    data.chasesDue.filter((row) => row.kind === "recovery_payment").length,
    <ChaseDueTable
      key="recovery-pay"
      title="Recovery payment chases due"
      hint="Starts once the recovery claimed figure is on the file and a recovery payment request has been recorded as sent. Recovery has no end date. Nothing is sent until you click Send."
      rows={data.chasesDue.filter((row) => row.kind === "recovery_payment")}
    />,
  );
  keep(
    "Repair progress gaps to explain",
    data.repairProgressGaps.length,
    <section key="gaps" className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Repair progress gaps to explain</h2>
      <RuleHint
        text={`A repair step ${repairGapDays} or more days after the previous one, or nothing recorded for that many days since the last step. The next day counts as 1. ${repairGapDays - 1} days is not flagged. An explanation of the gap since the last step is looked at again after another ${repairGapDays} days. Chasers do not reset the gap. Confirmed by Justin on 15/10/2026. This is a review prompt, not a legal limit.`}
      />
      <table className="ledger-table ledger-fit">
        <thead>
          <tr>
            <th>File</th>
            <th>Client</th>
            <th>Item</th>
            <th>When</th>
            <th>Handler</th>
          </tr>
        </thead>
        <tbody>
          {data.repairProgressGaps.map((row) => {
            const days = row.days;
            const overdue = days > 0;
            const wording = !overdue ? "Due today" : days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
            return (
            <tr key={`${row.claimId}-${row.wording}`} className={dueRowClass(overdue ? "overdue" : "today")}>
              <td>
                <Link href={`/claims/${row.claimId}#hire-repair-chronology`} className="ref text-teal-dark hover:underline">
                  {row.fileReference}
                </Link>
              </td>
              <td>{row.clientName}</td>
              <td>{deskItemTitle(row.wording)}</td>
              <td className={dueTextClass(overdue ? "overdue" : "today")}>{wording}</td>
              <td>{row.handlerName}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </section>,
  );
  keep(
    "Hire agreement renewals",
    data.chasesDueByKind.hire_agreement_renewal.length,
    <ChaseDueTable
      key="renewals"
      title="Hire agreement renewals"
      hint="Counted from the handover date on the current signed hire agreement. Alerts start on day 80 and are overdue on day 88. The agreement is 89 days. Courtesy cars are excluded unless a hire agreement is on the file. Clears only when a renewal is logged. Reminder only — no email is sent automatically."
      rows={data.chasesDueByKind.hire_agreement_renewal}
    />,
  );
  keep(
    "Tasks by handler",
    taskHandlers.length,
    <section key="tasks" className="mt-8 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Tasks by handler</h2>
      <RuleHint text="Due today and overdue only. Open tasks for the full list." />
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Handler</th>
            <th>Due today</th>
            <th>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {taskHandlers.map(([name, counts]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="tabular">{counts.today}</td>
              <td className="tabular text-overdue">{counts.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>,
  );
  return <>{blocks}</>;
}

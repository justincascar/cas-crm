import Link from "next/link";
import { cookies } from "next/headers";
import { PageHeader, SearchForm } from "@/components/ClaimTable";
import { TodaysWork, type PreparedDeskEmail } from "@/components/dashboard/TodaysWork";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { formatGbp } from "@/lib/money";
import { requireStaff } from "@/lib/auth/session";
import { countClaims, dbLocation, getDashboard } from "@/lib/db/queries";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { listAgedDebt } from "@/lib/db/aged-debt";
import { draftPayload, listOpenClaimDrafts } from "@/lib/db/claim-drafts";
import { findPreparedChase } from "@/lib/db/chase";
import { isChaseKind } from "@/lib/domain/chase";
import { liveEmailSending } from "@/lib/email/send-mode";
import { loadClash } from "@/lib/db/record-version";
import { DASHBOARD_SCOPE_COOKIE, resolveDashboardScope, type DashboardScope } from "@/lib/domain/dashboard-scope";
import { BANK_DETAILS_MISSING_SETTINGS, paymentDetailsComplete } from "@/lib/domain/payment-details";
import { getInsurerPaymentDetails, latestBankDetailsChange } from "@/lib/db/payment-details";

type Count = { key: string; label: string; value: string; href: string; tone: string };

const toneClass: Record<string, string> = {
  info: "border-l-teal",
  warn: "border-l-warn",
  bad: "border-l-overdue",
  ok: "border-l-ok",
};

function withHandler(href: string, handlerId: string | null): string {
  if (!handlerId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}handler=${encodeURIComponent(handlerId)}`;
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
  searchParams: Promise<{ scope?: string; undo?: string; prepare?: string; workError?: string; clash?: string; work?: string }>;
}) {
  const staff = await requireStaff();
  const query = await searchParams;
  const jar = await cookies();
  const scope = resolveDashboardScope(staff, query.scope, jar.get(DASHBOARD_SCOPE_COOKIE)?.value);
  const handlerId = scope === "mine" ? staff.id : null;
  const data = getDashboard({ handlerId });
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
  const bankDetailsMissing = !paymentDetailsComplete(getInsurerPaymentDetails());
  const bankChange = latestBankDetailsChange();
  const drafts = listOpenClaimDrafts();

  // One next step per claim. The claim's other items are on the claim itself.
  const allOpen = data.todaysWork.map((row) => ({ ...row, rest: [] }));
  const dueToday = allOpen.filter((row) => row.lead.tone === "today" || row.lead.tone === "overdue");
  const overdueRows = allOpen.filter((row) => row.lead.tone === "overdue");
  const actionToday = dueToday.length;
  const overdue = overdueRows.length;
  // The counts open the matching list, so a count always equals the rows shown under it.
  const work = query.work === "today" || query.work === "overdue" ? query.work : "all";
  const todaysWork = work === "today" ? dueToday : work === "overdue" ? overdueRows : allOpen;
  const workLink = (value: string) => {
    const params = new URLSearchParams();
    if (value !== "all") params.set("work", value);
    const text = params.toString();
    return `/${text ? `?${text}` : ""}#todays-work`;
  };
  const creditHire = countClaims("active_hire_credit", handlerId);
  const courtesy = countClaims("active_hire_courtesy", handlerId);
  const owed = Object.values(listAgedDebt(undefined, handlerId).totals).reduce((sum, pence) => sum + pence, 0);
  const counts: Count[] = [
    { key: "action_today", label: "Need action today", value: String(actionToday), href: workLink("today"), tone: "warn" },
    { key: "overdue", label: "Overdue", value: String(overdue), href: workLink("overdue"), tone: "bad" },
    {
      key: "on_hire",
      label: "Cars on hire",
      value: `${creditHire} credit · ${courtesy} courtesy`,
      href: withHandler("/claims?queue=active_hire", handlerId),
      tone: "info",
    },
    { key: "storage", label: "In storage", value: String(countClaims("storage", handlerId)), href: withHandler("/claims?queue=storage", handlerId), tone: "info" },
    { key: "money", label: "Money awaited", value: formatGbp(owed), href: "/financials/aged-debt", tone: "warn" },
    { key: "fleet", label: "Fleet free today", value: String(Number(data.fleetMap.available || 0)), href: "/hire?status=available", tone: "ok" },
  ];

  return (
    <div>
      <PageHeader
        title="Claims desk"
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-dashboard-counts>
        {counts.map((count) => (
          <Link
            key={count.key}
            href={count.href}
            data-count={count.key}
            className={`rounded-xl border border-line border-l-4 bg-card p-4 shadow-[0_1px_0_rgba(16,28,36,0.04)] ${toneClass[count.tone] || "border-l-teal"}`}
          >
            <p className="text-xs uppercase tracking-[0.12em] text-slate">{count.label}</p>
            <p className="mt-2 font-serif text-3xl tabular text-navy-deep">{count.value}</p>
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

      <section id="todays-work" className="mt-8 scroll-mt-24 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Open claims by next step</h2>
        <nav className="mt-2 mb-3 flex flex-wrap gap-2 text-sm" aria-label="Show" data-work-filter={work}>
          {[
            ["all", `All open (${allOpen.length})`],
            ["today", `Need action today (${actionToday})`],
            ["overdue", `Overdue (${overdue})`],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={workLink(value)}
              aria-current={work === value ? "true" : undefined}
              className={`rounded-md px-3 py-1.5 font-semibold ${work === value ? "bg-navy text-white" : "border border-line bg-white text-navy"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {query.workError ? <p className="mb-3 rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.workError}</p> : null}
        <SaveClashNotice clash={clash} reloadHref="/" />
        {todaysWork.length === 0 ? (
          <p className="mt-2 text-sm text-slate">{work === "all" ? "No open claims need a step." : "Nothing in this list."}</p>
        ) : (
          <TodaysWork
            rows={todaysWork}
            bankDetailsMissing={bankDetailsMissing}
            liveSending={liveEmailSending()}
            undoId={query.undo || null}
            prepared={prepared}
          />
        )}
      </section>

      <p className="mt-6 text-sm">
        <Link href="/claims" className="text-teal-dark underline">
          All claims
        </Link>
        {" · "}
        <Link href="/financials" className="text-teal-dark underline">
          Financials
        </Link>
        {" · "}
        <Link href="/gaps" className="text-teal-dark underline">
          Gaps to explain{data.finishedRepairGaps.length > 0 ? ` (${data.finishedRepairGaps.length})` : ""}
        </Link>
      </p>

      <p className="mt-8 text-xs text-slate">
        Data is stored on this PC at <span className="ref">{dbLocation()}</span>.
      </p>
    </div>
  );
}

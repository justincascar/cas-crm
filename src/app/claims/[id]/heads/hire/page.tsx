import { recoveryCardFeePercent } from "@/lib/db/recovery-fee-settings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { ChargeDecisionPanel } from "@/components/claims/ChargeDecisionPanel";
import { ChargeOffers } from "@/components/claims/ChargeOffers";
import { FigureResolution } from "@/components/claims/FigureResolution";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate } from "@/lib/dates";
import { HIRE_INCLUSIVE_DAY_NOTE, HIRE_NOT_STARTED, FAULT_COURTESY_NOT_CREDIT_HIRE } from "@/lib/domain/hire-charge";
import { ukDayLabel } from "@/lib/domain/storage-charge";
import { formatGbp } from "@/lib/money";
import { latestChargeDecision } from "@/lib/db/charge-decision";
import { figureFlag } from "@/lib/db/figure-resolution";
import { accountCanAcceptPaymentSettlement, accountCanApproveSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";
import { loadClash, sectionVersion } from "@/lib/db/record-version";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { SeparateRecordConfirm } from "@/components/SeparateRecordConfirm";
import { hireChargeForClaim } from "@/lib/db/hire-charge";
import { loadHeadSection } from "@/lib/db/head-screen";
import { agreedOnFor, listChargeOffers } from "@/lib/db/vehicle-offers";

function shownDay(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return ukDayLabel(value);
  return formatUkDate(value);
}

export async function HireHeadScreen({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ figureError?: string; offerError?: string; offerWarn?: string; offerAmount?: string; offerOn?: string; offerNote?: string; offerHead?: string; offerDays?: string; offerRate?: string; decisionError?: string; clash?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const hireClash = loadClash(query.clash);
  const data = getClaim(id);
  if (!data) notFound();
  const view = hireChargeForClaim(id);
  const section = loadHeadSection(id, "hire");
  const charge = view.charge;
  const calculated = charge.status === "calculated" ? charge.totalPence : null;
  const flag = figureFlag(id, "hire", view.stored.claimedPence, calculated);
  const claimedForMoney = section.claimedPence;
  const provisional = !view.confirmedEndDay && claimedForMoney > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hire"
        subtitle={`${String(data.claim.file_reference)} · ${String(data.claim.client_name || "Unknown client")}. The charge is calculated from the handover and the signed agreement.`}
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
      </p>
      <SaveClashNotice
        clash={hireClash && (hireClash.recordKey === id || hireClash.recordKey.startsWith(`${id}:`)) ? hireClash : null}
        reloadHref={`/claims/${id}/heads/hire`}
      />
      {query.figureError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.figureError}</p> : null}
      {query.offerError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.offerError}</p> : null}
      {query.offerWarn ? (
        <SeparateRecordConfirm
          message={query.offerWarn}
          action={`/claims/${id}/vehicle-offers`}
          confirmField="confirmDuplicate"
          cancelHref={`/claims/${id}/heads/hire`}
          fields={{
            intent: "record_offer",
            returnTo: `/claims/${id}/heads/hire`,
            amount: query.offerAmount || "",
            offeredOn: query.offerOn || "",
            note: query.offerNote || "",
            head: query.offerHead || "hire",
            offeredDays: query.offerDays || "",
            offeredDailyRate: query.offerRate || "",
          }}
        />
      ) : null}
      {query.decisionError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.decisionError}</p> : null}

      <section className="space-y-4 rounded-xl border border-line bg-card p-5" aria-label="Hire details">
        <h2 className="font-serif text-xl text-navy-deep">Hire details</h2>
        <p className="text-sm text-slate">
          Hire starts on the day the replacement was handed over. A booking or a reservation does not start it. Fault courtesy is not credit
          hire. The daily rate is the rate on the signed agreement, from the client&apos;s own vehicle group, not the car that was supplied.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate">Handover</dt>
            <dd className="font-semibold">{view.handoverDay ? shownDay(view.handoverDay) : HIRE_NOT_STARTED}</dd>
          </div>
          <div>
            <dt className="text-slate">Chargeable end</dt>
            <dd className="font-semibold">
              {view.confirmedEndDay
                ? shownDay(view.confirmedEndDay)
                : view.proposedEndDay
                  ? `Proposed end awaiting confirmation: ${shownDay(view.proposedEndDay)}`
                  : "Hire continuing"}
            </dd>
          </div>
          <div>
            <dt className="text-slate">Vehicle supplied</dt>
            <dd>{view.suppliedVehicle || "Not recorded"}. The group of this car is not the daily rate.</dd>
          </div>
          <div>
            <dt className="text-slate">Credit hire</dt>
            <dd>{view.creditHire ? "Yes" : "No"}</dd>
          </div>
        </dl>
        {view.agreements.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {view.agreements.map((agreement) => (
              <li key={agreement.id}>
                Agreement {agreement.sequence}
                {agreement.startDay ? `, from ${shownDay(agreement.startDay)}` : ", start day not recorded"}
                {agreement.signed ? ", signed" : ", not signed"}
                {agreement.ratePence ? `, ${formatGbp(agreement.ratePence)} a day on this agreement` : ", no daily rate stored on this agreement"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No hire agreement is stored on this file.</p>
        )}
        {charge.status === "calculated" && charge.swapDays.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {charge.swapDays.map((day) => (
              <li key={day}>Vehicle swap on {shownDay(day)}. This does not add a day. The rate stays the agreement rate.</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Hire charge">
        <h2 className="font-serif text-xl text-navy-deep">Hire charge</h2>
        {view.stored.claimedPence > 0 ? null : <p className="text-sm font-semibold">No hire recorded yet</p>}
        {view.stored.claimedPence <= 0 && charge.status === "calculated" ? (
          <form method="post" action={`/claims/${id}/record-charge`}>
            <input type="hidden" name="head" value="hire" />
            <p className="mb-3 text-sm text-slate">
              The calculated charge is shown below. It is recorded only when you press Record hire.
            </p>
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
              Record hire
            </button>
          </form>
        ) : null}
        <p className="text-sm text-slate">{HIRE_INCLUSIVE_DAY_NOTE} Days, net, VAT and the total are calculated. They are not typed.</p>
        {charge.status === "not_started" ? <p className="text-sm font-semibold">{HIRE_NOT_STARTED}</p> : null}
        {charge.status === "courtesy" ? <p className="text-sm font-semibold">{FAULT_COURTESY_NOT_CREDIT_HIRE}</p> : null}
        {charge.status === "no_rate" ? <p className="text-sm">{charge.note}</p> : null}
        {charge.status === "end_before_start" ? (
          <p className="text-sm">The chargeable end is before the handover. No figure is shown, and the claimed figure has not been changed.</p>
        ) : null}
        {charge.status === "calculated" ? (
          <div className="space-y-3 text-sm">
            {charge.label ? <p className="font-semibold">{charge.label}</p> : <p className="font-semibold">Final</p>}
            <ul className="space-y-1">
              {charge.lines.map((line) => (
                <li key={`${line.sequence}-${line.fromDay}`}>
                  {line.label}: {formatGbp(line.ratePence)} a day, {formatGbp(line.netPence)} net
                </li>
              ))}
              {charge.extras.map((extra) => (
                <li key={extra.key}>
                  {extra.label}
                  {extra.days ? ` × ${formatGbp(extra.ratePence)}` : ` ${formatGbp(extra.ratePence)}`}: {formatGbp(extra.netPence)} net
                </li>
              ))}
            </ul>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-slate">Days</dt>
                <dd className="font-semibold">{charge.days}</dd>
              </div>
              <div>
                <dt className="text-slate">Net</dt>
                <dd className="font-semibold tabular">{formatGbp(charge.netPence)}</dd>
              </div>
              <div>
                <dt className="text-slate">VAT</dt>
                <dd className="font-semibold tabular">{formatGbp(charge.vatPence)}</dd>
              </div>
              <div>
                <dt className="text-slate">Total</dt>
                <dd className="font-semibold tabular">{formatGbp(charge.totalPence)}</dd>
              </div>
            </dl>
            {charge.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <FigureResolution
              claimId={id}
              head="hire"
              differs={flag.differs}
              keptLabel={flag.mode === "kept" ? flag.label : null}
              storedPence={view.stored.claimedPence}
              calculatedPence={calculated}
              recordVersion={sectionVersion("figure", `${id}:hire`)}
            />
          </div>
        ) : (
          <FigureResolution
            claimId={id}
            head="hire"
            differs={flag.differs}
            keptLabel={flag.mode === "kept" ? flag.label : null}
            storedPence={view.stored.claimedPence}
            calculatedPence={calculated}
            recordVersion={sectionVersion("figure", `${id}:hire`)}
          />
        )}
      </section>

      <HeadOfLossScreen
        claimId={id}
        section={section}
        claimedNote={provisional ? "Provisional until the hire end is confirmed." : charge.status === "calculated" ? charge.label : null}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="hire" recordVersion={sectionVersion("money", `${id}:hire`)} />
            <div className="mt-4">
              <PaymentReviewPanel
                cardFeePercent={recoveryCardFeePercent()}
                claimId={id}
                lockedHead={{ head: "hire", label: "Hire", receivedPence: section.receivedPence, agreedPence: section.agreedPence || 0, claimedPence: claimedForMoney }}
              />
            </div>
          </>
        }
      />
      <ChargeDecisionPanel
        claimId={id}
        head="hire"
        decision={latestChargeDecision(id, "hire")}
        canApproveSettlement={accountCanApproveSettlement(staff.id, staff.role)}
        recordVersion={sectionVersion("money", `${id}:hire`)}
      />
      <ChargeOffers
        claimId={id}
        head="hire"
        offers={listChargeOffers(id, "hire")}
        claimedPence={claimedForMoney}
        claimedUnderReview={flag.differs}
        agreedOn={agreedOnFor(id, "hire")}
        hasAgreed={(section.agreedPence || 0) > 0}
      />
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const target = new URL(`http://local/claims/${id}/money/hire`);
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value) target.searchParams.set(key, value);
  }
  redirect(`${target.pathname}${target.search}`);
}

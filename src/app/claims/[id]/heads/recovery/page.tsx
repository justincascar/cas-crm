import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { ScreenForm } from "@/components/claim-file/ScreenForm";
import { ChargeDecisionPanel } from "@/components/claims/ChargeDecisionPanel";
import { ChargeOffers } from "@/components/claims/ChargeOffers";
import { FigureResolution } from "@/components/claims/FigureResolution";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { SeparateRecordConfirm } from "@/components/SeparateRecordConfirm";
import { requireStaff } from "@/lib/auth/session";
import { getClaimScreen } from "@/lib/claim-screens";
import { formatUkDate, formatUkTime, toLondonDateTimeLocal } from "@/lib/dates";
import { RecoveryFeeFields, feeDefaultsFromLines } from "@/components/claims/RecoveryFeeFields";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { ValidatedForm } from "@/components/ValidatedForm";
import { recoveryFeeSchedule } from "@/lib/db/recovery-fee-settings";
import { recoveryDisplayLines, recoveryReviewFlags } from "@/lib/db/recovery-display";
import { headScreenPath } from "@/lib/domain/head-screen";
import { formatGbp } from "@/lib/money";
import { latestChargeDecision } from "@/lib/db/charge-decision";
import { figureFlag } from "@/lib/db/figure-resolution";
import { loadHeadSection } from "@/lib/db/head-screen";
import { accountCanAcceptPaymentSettlement, accountCanApproveSettlement } from "@/lib/db/permissions";
import { getClaim, listKnownAgents, listKnownInsurers } from "@/lib/db/queries";
import { seedScreenDefaults } from "@/lib/db/screens";
import { recoveryCarrierName, recoveryClaimForClaim, recoveryJobForClaim, recoveryLineForClaim } from "@/lib/db/storage-charge";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { getScreenData } from "@/lib/db/screens";
import { loadClash, screenVersion, sectionVersion } from "@/lib/db/record-version";
import { SHARED_RECOVERY_AT, sharedVersionFields } from "@/lib/db/shared-fields";
import { SaveClashNotice } from "@/components/SaveClashNotice";
import { agreedOnFor, listChargeOffers } from "@/lib/db/vehicle-offers";

function shownDay(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [year, month, day] = text.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(text);
}

export async function RecoveryHeadScreen({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; field?: string; clash?: string; figureError?: string; offerError?: string; offerWarn?: string; offerAmount?: string; offerOn?: string; offerNote?: string; offerHead?: string; offerDays?: string; offerRate?: string; decisionError?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const def = getClaimScreen("recovery");
  if (!def) notFound();
  const decision = recoveryClaimForClaim(id);
  const recorded = Boolean(recoveryLineForClaim(id));
  const job = recoveryJobForClaim(id);
  const screen = getScreenData(id, "recovery");
  const storage = getScreenData(id, "storage");
  const storedTo = [storage.name, storage.address, storage.postcode].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
  const from = String(job?.location || screen.location || "").trim();
  const who = recoveryCarrierName(id) || String(screen.name || "").trim();
  const date = job?.recovered_at || screen.recoveryDate || "";
  const recoveryLines = recoveryDisplayLines(id);
  const recoveryFlags = recoveryReviewFlags(id);
  const section = loadHeadSection(id, "recovery");
  const calculated = decision.totalPence > 0 ? decision.totalPence : null;
  const flag = figureFlag(id, "recovery", section.claimedPence, calculated);
  const loadedValues = seedScreenDefaults(id, "recovery");
  const screenClash = loadClash(query.clash);
  const clashForScreen =
    screenClash &&
    ((screenClash.scope === "screen" && screenClash.recordKey === `${id}:recovery`) ||
      (screenClash.scope === SHARED_RECOVERY_AT && screenClash.recordKey === id))
      ? screenClash
      : null;
  const values = clashForScreen ? { ...loadedValues, ...clashForScreen.submitted } : loadedValues;
  const recordVersion = clashForScreen && clashForScreen.scope === "screen" ? clashForScreen.expectedVersion : screenVersion(id, "recovery");
  const extraHidden = sharedVersionFields(id, "recovery");
  if (clashForScreen?.scope === SHARED_RECOVERY_AT) extraHidden.recoveryAtVersion = clashForScreen.expectedVersion;
  const recoveryDone = data.events.some((event) => String(event.event_type) === "recovery_completed");
  const arrivedText = date ? `${shownDay(date)}${String(date).includes("T") ? ` ${formatUkTime(String(date))}` : ""}` : "a date not recorded";
  const savedLines = recoveryDisplayLines(id);
  const decisionNet = savedLines.reduce((sum, line) => sum + line.netPence, 0);
  const decisionVat = savedLines.reduce((sum, line) => sum + line.vatPence, 0);
  const decisionGross = savedLines.reduce((sum, line) => sum + line.grossPence, 0);
  const arrivedLocal = job?.recovered_at && String(job.recovered_at).includes("T") ? toLondonDateTimeLocal(String(job.recovered_at)) : "";
  const recordForm = (
    <ValidatedForm action={`/claims/${id}/recovery/record`} method="post" className="space-y-4" initialError={query.error} initialErrorField={query.field}>
      <SubmitKeyInput />
      <label className="block text-sm">
        Recovered from
        <input name="recoveryLocation" defaultValue={from} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Arrived at the yard (date)
          <input name="arrivedDate" type="date" required defaultValue={arrivedLocal.slice(0, 10)} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          Time
          <input name="arrivedTime" type="time" required defaultValue={arrivedLocal.slice(11, 16)} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
        </label>
      </div>
      <RecoveryFeeFields fees={recoveryFeeSchedule()} defaults={feeDefaultsFromLines(savedLines)} />
      <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
        {recoveryDone ? "Save recovery" : "Record recovery"}
      </button>
    </ValidatedForm>
  );
  const chargeNote =
    decision.source === "screen"
      ? "This claimed figure is the total already calculated on the recovery screen: the standard charge, any extras and the card fee, plus VAT. It is not a second £395 on top."
      : decision.source === "job"
        ? "This claimed figure is the recovery job charges, plus VAT."
        : decision.source === "kept"
          ? "A claimed figure is already on this file. Opening this page has not replaced it, and it has not added another £395."
          : "This is the standard recovery charge of £395, plus VAT. Nothing else has been added.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery"
        subtitle={`${String(data.claim.file_reference)} · ${String(data.claim.client_name || "Unknown client")}`}
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
        {" · "}
        <Link href={headScreenPath(id, "storage")} className="text-teal-dark underline">
          Storage
        </Link>
      </p>
      {query.error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p>
      ) : null}

      {query.saved === "recovery" && !query.error ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Recovery recorded.</p>
      ) : null}

      <section id="record" className="scroll-mt-16 space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Record the recovery" data-recovery-step={recoveryDone ? "done" : "open"}>
        <h2 className="font-serif text-xl text-navy-deep">Record the recovery</h2>
        {recoveryDone ? (
          <details>
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-sm">
              <span data-done-line>
                At the yard from {arrivedText} · {formatGbp(decisionNet)} + VAT {formatGbp(decisionVat)} = {formatGbp(decisionGross)}
              </span>
              <span className="text-teal-dark underline">Change</span>
            </summary>
            <div className="mt-4">{recordForm}</div>
          </details>
        ) : (
          <>
            <p className="text-sm">When the car has arrived at the yard, record it here. Storage starts that day.</p>
            {recordForm}
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Recovery details">
        <h2 className="font-serif text-xl text-navy-deep">Recovery details</h2>
        <p className="text-sm text-slate">Taken from the recovery job and the recovery screen. Saving the charges below does not change a storage date.</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate">Date and time</dt>
            <dd>
              {shownDay(date)}
              {date && date.includes("T") ? ` ${formatUkTime(date)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-slate">From</dt>
            <dd>{from || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-slate">To</dt>
            <dd>{storedTo || `${getDefaultVehicleLocation()} — the CAS premises, because no storage address is saved on this file`}</dd>
          </div>
          <div>
            <dt className="text-slate">Who carried it out</dt>
            <dd>{who || "Not recorded"}</dd>
          </div>
        </dl>
        {recoveryFlags.length ? (
          <ul className="space-y-2">
            {recoveryFlags.map((flagText) => (
              <li key={flagText} className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
                {flagText}
              </li>
            ))}
          </ul>
        ) : null}
        {recoveryLines.length ? (
          <div>
            <h3 className="text-sm font-semibold text-navy-deep">Each charge</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {recoveryLines.map((line) => (
                <li key={line.key}>
                  {line.label}: {formatGbp(line.netPence)} net, VAT {formatGbp(line.vatPence)}, {formatGbp(line.grossPence)}
                  {line.reason ? ` — ${line.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Recovery charge">
        <h2 className="font-serif text-xl text-navy-deep">Recovery charge</h2>
        {recorded ? (
          <p className="text-sm">{chargeNote}</p>
        ) : (
          <p className="text-sm font-semibold">No recovery recorded yet</p>
        )}
        <p className="text-sm font-semibold tabular">
          Net {formatGbp(decision.netPence)} · VAT {formatGbp(decision.vatPence)} · Total {formatGbp(decision.totalPence)}
        </p>
        {query.figureError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.figureError}</p> : null}
        {query.offerError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.offerError}</p> : null}
        {query.offerWarn ? (
          <SeparateRecordConfirm
            message={query.offerWarn}
            action={`/claims/${id}/vehicle-offers`}
            confirmField="confirmDuplicate"
            cancelHref={`/claims/${id}/heads/recovery`}
            fields={{
              intent: "record_offer",
              returnTo: `/claims/${id}/heads/recovery`,
              amount: query.offerAmount || "",
              offeredOn: query.offerOn || "",
              note: query.offerNote || "",
              head: query.offerHead || "recovery",
              offeredDays: query.offerDays || "",
              offeredDailyRate: query.offerRate || "",
            }}
          />
        ) : null}
        {query.decisionError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.decisionError}</p> : null}
        <FigureResolution
          claimId={id}
          head="recovery"
          differs={flag.differs}
          keptLabel={flag.mode === "kept" ? flag.label : null}
          storedPence={section.claimedPence}
          calculatedPence={calculated}
          recordVersion={sectionVersion("figure", `${id}:recovery`)}
        />
        <SaveClashNotice
          clash={
            screenClash && (screenClash.recordKey === id || screenClash.recordKey.startsWith(`${id}:`))
              ? screenClash
              : null
          }
          reloadHref={`/claims/${id}/heads/recovery`}
        />
        <ScreenForm
          claimId={id}
          actorId={staff.id}
          def={def}
          values={values}
          saved={query.saved === "1"}
          clientRole={String(data.claim.client_role || "")}
          insurers={listKnownInsurers()}
          agents={listKnownAgents()}
          error={query.error}
          errorField={query.field}
          recordVersion={recordVersion}
          extraHidden={extraHidden}
          hideSections={["Charges"]}
        />
      </section>

      <HeadOfLossScreen
        claimId={id}
        section={section}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="recovery" recordVersion={sectionVersion("money", `${id}:recovery`)} />
            <div className="mt-4">
              <PaymentReviewPanel
                claimId={id}
                lockedHead={{
                  head: "recovery",
                  label: "Recovery",
                  receivedPence: section.receivedPence,
                  agreedPence: section.agreedPence || 0,
                  claimedPence: section.claimedPence,
                }}
              />
            </div>
          </>
        }
      />
      <ChargeDecisionPanel
        claimId={id}
        head="recovery"
        decision={latestChargeDecision(id, "recovery")}
        canApproveSettlement={accountCanApproveSettlement(staff.id, staff.role)}
        recordVersion={sectionVersion("money", `${id}:recovery`)}
      />
      <ChargeOffers
        claimId={id}
        head="recovery"
        offers={listChargeOffers(id, "recovery")}
        claimedPence={section.claimedPence}
        claimedUnderReview={flag.differs}
        agreedOn={agreedOnFor(id, "recovery")}
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
  const target = new URL(`http://local/claims/${id}/money/recovery`);
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value) target.searchParams.set(key, value);
  }
  redirect(`${target.pathname}${target.search}`);
}

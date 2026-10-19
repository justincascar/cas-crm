import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { ChargeDecisionPanel } from "@/components/claims/ChargeDecisionPanel";
import { ChargeOffers } from "@/components/claims/ChargeOffers";
import { FigureResolution } from "@/components/claims/FigureResolution";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { SeparateRecordConfirm } from "@/components/SeparateRecordConfirm";
import { StorageDateReview } from "@/components/claims/StorageDateReview";
import { StorageEndDateReview } from "@/components/claims/StorageEndDateReview";
import { ChargeableStorageNote, StorageAuthorisationEndPanel } from "@/components/claims/StorageAuthorisationEnd";
import { requireStaff } from "@/lib/auth/session";
import { STORAGE_START_MISSING_REVIEW } from "@/lib/constants";
import { formatUkDate } from "@/lib/dates";
import { headScreenPath } from "@/lib/domain/head-screen";
import {
  STORAGE_INCLUSIVE_DAY_NOTE,
  prefillBlankStorageLocation,
  storageLocationFromSetting,
  storageLocationWasBlank,
} from "@/lib/domain/storage-charge";
import { formatGbp } from "@/lib/money";
import { latestChargeDecision } from "@/lib/db/charge-decision";
import { figureFlag } from "@/lib/db/figure-resolution";
import { accountCanAcceptPaymentSettlement, accountCanApproveSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";
import { getScreenData } from "@/lib/db/screens";
import { loadClash, screenVersion, sectionVersion } from "@/lib/db/record-version";
import { sharedVersionFields } from "@/lib/db/shared-fields";
import { RecordVersionField, SaveClashNotice } from "@/components/SaveClashNotice";
import { claimStorageChargeEnded, storageAuthorisationEndForClaim } from "@/lib/db/storage-authorisation-end";
import {
  effectiveStorageRatePence,
  latestManualStorageEndReason,
  storageChargeForClaim,
  storageLineForClaim,
} from "@/lib/db/storage-charge";
import { getStorageDateReview, getStorageEndDateReview } from "@/lib/db/storage-recovery-date";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { loadHeadSection } from "@/lib/db/head-screen";
import { agreedOnFor, listChargeOffers } from "@/lib/db/vehicle-offers";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function shownDay(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

export default async function StorageHeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; clash?: string; figureError?: string; offerError?: string; offerWarn?: string; offerAmount?: string; offerOn?: string; offerNote?: string; offerHead?: string; offerDays?: string; offerRate?: string; decisionError?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  const saved = getScreenData(id, "storage");
  const defaults = storageLocationFromSetting(getDefaultVehicleLocation());
  const blankLocation = storageLocationWasBlank(saved);
  const location = prefillBlankStorageLocation(saved, defaults);
  const startDay = data.claim.storage_started_on ? String(data.claim.storage_started_on).slice(0, 10) : "";
  const endDay = data.claim.storage_billing_end_on ? String(data.claim.storage_billing_end_on).slice(0, 10) : "";
  const charge = storageChargeForClaim(id);
  const storageRecorded = Boolean(storageLineForClaim(id));
  const rate = effectiveStorageRatePence(data.claim.storage_rate_pence == null ? null : Number(data.claim.storage_rate_pence));
  const decision = storageAuthorisationEndForClaim(id);
  const manualReason = latestManualStorageEndReason(id);
  const proposed = decision.kind === "suggest" ? decision.date : decision.kind === "conflict" ? decision.suggestedDate : null;
  const section = loadHeadSection(id, "storage");
  const calculated = charge?.status === "calculated" ? charge.totalPence : null;
  const flag = figureFlag(id, "storage", section.claimedPence, calculated);
  const provisional = !endDay && section.claimedPence > 0;
  const returnTo = headScreenPath(id, "storage");
  const screenClash = loadClash(query.clash);
  const detailsClash =
    screenClash && screenClash.scope === "screen" && screenClash.recordKey === `${id}:storage` ? screenClash : null;
  const rateClash =
    screenClash && screenClash.scope === "storage-rate" && screenClash.recordKey === id ? screenClash : null;
  const storageVersion = detailsClash ? detailsClash.expectedVersion : screenVersion(id, "storage");
  const sharedStorage = sharedVersionFields(id, "storage");
  const rateVersion = rateClash ? rateClash.expectedVersion : sectionVersion("storage-rate", id);
  const entered = (name: string, current: string) =>
    detailsClash && Object.prototype.hasOwnProperty.call(detailsClash.submitted, name) ? detailsClash.submitted[name] : current;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        subtitle={`${String(data.claim.file_reference)} · ${String(data.claim.client_name || "Unknown client")}. Where the vehicle is, and what is charged for storage, stay separate.`}
      />
      <p className="text-sm">
        <Link href={`/claims/${id}`} className="text-teal-dark underline">
          Back to the file
        </Link>
        {" · "}
        <Link href={headScreenPath(id, "recovery")} className="text-teal-dark underline">
          Recovery
        </Link>
      </p>
      {query.error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{query.error}</p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ef] px-4 py-3 text-sm">Saved. Payments already recorded were not changed.</p>
      ) : null}

      <section className="space-y-4 rounded-xl border border-line bg-card p-5" aria-label="Storage details">
        <h2 className="font-serif text-xl text-navy-deep">Storage details</h2>
        <p className="text-sm text-slate">
          This is where the vehicle is, and the dates storage is charged. Saving these boxes does not change a payment.
        </p>
        <SaveClashNotice
          clash={
            screenClash && (screenClash.recordKey === id || screenClash.recordKey.startsWith(`${id}:`))
              ? screenClash
              : null
          }
          reloadHref={returnTo}
        />
        <StorageDateReview claimId={id} review={getStorageDateReview(id)} returnTo={returnTo} />
        {startDay ? (
          <StorageEndDateReview claimId={id} review={getStorageEndDateReview(id)} returnTo={returnTo} />
        ) : null}
        {startDay ? <StorageAuthorisationEndPanel claimId={id} decision={decision} returnTo={returnTo} /> : (
          <>
            {decision.kind === "review" ? (
              <StorageAuthorisationEndPanel claimId={id} decision={decision} returnTo={returnTo} />
            ) : null}
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
              Start date missing. A storage end cannot be proposed or confirmed.
              {endDay ? ` ${STORAGE_START_MISSING_REVIEW}.` : ""}
            </p>
          </>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate">Where the vehicle is</dt>
            <dd>
              {[location.name, location.address, location.postcode].filter(Boolean).join(", ") || "Not recorded"}
              {blankLocation ? " — filled from the CAS premises default because these boxes were blank." : ""}
            </dd>
          </div>
          <div>
            <dt className="text-slate">Chargeable end</dt>
            <dd>
              {endDay
                ? shownDay(endDay)
                : proposed
                  ? `Proposed end awaiting confirmation: ${shownDay(proposed)}`
                  : "Storage continuing"}
            </dd>
          </div>
        </dl>
        {manualReason ? <p className="text-sm">Reason the end date is not the proposed storage end: {manualReason}</p> : null}
        <ChargeableStorageNote ended={claimStorageChargeEnded(id)} endDay={endDay || null} />
        <p className="text-sm text-slate">
          The car can still be here after charging stops. The dashboard can still show it on site. It is not counted as chargeable storage once
          the confirmed end has passed.
        </p>
        <form method="post" action={`/claims/${id}/storage-details`} className="grid gap-3 sm:grid-cols-2">
          <RecordVersionField version={storageVersion} />
          <input type="hidden" name="storageStartVersion" value={sharedStorage.storageStartVersion || ""} />
          <input type="hidden" name="storageEndVersion" value={sharedStorage.storageEndVersion || ""} />
          <input
            type="hidden"
            name="loadedJson"
            value={JSON.stringify({
              name: location.name,
              address: location.address,
              postcode: location.postcode,
              telMain: location.telMain,
              email: location.email,
              ref: saved.ref || "",
              invoiceNo: saved.invoiceNo || "",
              startDate: startDay,
              endDate: endDay,
            })}
          />
          <label className="text-sm">
            Name
            <input name="name" defaultValue={entered("name", location.name)} className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Address
            <textarea name="address" defaultValue={entered("address", location.address)} rows={2} className={field} />
          </label>
          <label className="text-sm">
            Postcode
            <input name="postcode" defaultValue={entered("postcode", location.postcode)} className={field} />
          </label>
          <label className="text-sm">
            Tel
            <input name="telMain" defaultValue={entered("telMain", location.telMain)} className={field} />
          </label>
          <label className="text-sm">
            Email
            <input name="email" defaultValue={entered("email", location.email)} className={field} />
          </label>
          <label className="text-sm">
            Ref
            <input name="ref" defaultValue={entered("ref", saved.ref || "")} className={field} />
          </label>
          <label className="text-sm">
            Invoice no.
            <input name="invoiceNo" defaultValue={entered("invoiceNo", saved.invoiceNo || "")} className={field} />
          </label>
          <label className="text-sm">
            Start date
            <input name="startDate" type="date" defaultValue={entered("startDate", startDay)} className={field} />
          </label>
          {startDay ? (
            <>
              <label className="text-sm">
                Chargeable end date
                <input name="endDate" type="date" defaultValue={entered("endDate", endDay)} className={field} />
              </label>
              <label className="text-sm sm:col-span-2">
                Reason, if this end date is not the proposed storage end
                <textarea name="endDateReason" rows={2} className={field} defaultValue="" />
              </label>
            </>
          ) : null}
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save storage details
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Storage charge">
        <h2 className="font-serif text-xl text-navy-deep">Storage charge</h2>
        {storageRecorded ? null : <p className="text-sm font-semibold">No storage recorded yet</p>}
        {!storageRecorded && charge?.status === "calculated" ? (
          <form method="post" action={`/claims/${id}/record-charge`}>
            <input type="hidden" name="head" value="storage" />
            <p className="mb-3 text-sm text-slate">
              The calculated charge is shown below. It is recorded only when you press Record storage.
            </p>
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
              Record storage
            </button>
          </form>
        ) : null}
        <p className="text-sm text-slate">{STORAGE_INCLUSIVE_DAY_NOTE} Net, VAT and the total are calculated. They are not typed.</p>
        {charge?.status === "missing_start" ? <p className="text-sm font-semibold">Start date missing</p> : null}
        {charge?.status === "end_before_start" ? (
          <p className="text-sm">The chargeable end is before the start date. No figure is shown, and the claimed figure has not been changed.</p>
        ) : null}
        {query.figureError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.figureError}</p> : null}
        {query.offerError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.offerError}</p> : null}
        {query.offerWarn ? (
          <SeparateRecordConfirm
            message={query.offerWarn}
            action={`/claims/${id}/vehicle-offers`}
            confirmField="confirmDuplicate"
            cancelHref={returnTo}
            fields={{
              intent: "record_offer",
              returnTo,
              amount: query.offerAmount || "",
              offeredOn: query.offerOn || "",
              note: query.offerNote || "",
              head: query.offerHead || "storage",
              offeredDays: query.offerDays || "",
              offeredDailyRate: query.offerRate || "",
            }}
          />
        ) : null}
        {query.decisionError ? <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">{query.decisionError}</p> : null}
        {charge?.status === "calculated" ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate">Days</dt>
              <dd className="font-semibold">
                {charge.days}
                {charge.label ? ` — ${charge.label}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate">Daily rate</dt>
              <dd className="font-semibold">
                {formatGbp(charge.ratePence)}
                {rate.overridden ? " — rate on this file" : " — standard rate"}
              </dd>
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
        ) : null}
        <FigureResolution
          claimId={id}
          head="storage"
          differs={flag.differs}
          keptLabel={flag.mode === "kept" ? flag.label : null}
          storedPence={section.claimedPence}
          calculatedPence={calculated}
          recordVersion={sectionVersion("figure", `${id}:storage`)}
        />
        <form method="post" action={`/claims/${id}/storage-rate`} className="grid gap-3 sm:grid-cols-2">
          <RecordVersionField version={rateVersion} />
          <label className="text-sm">
            Daily rate on this file (£)
            <input name="dailyRate" inputMode="decimal" required defaultValue={rateClash ? rateClash.submitted.dailyRate || "" : (rate.pence / 100).toFixed(2)} className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Reason for changing the rate on this file
            <textarea name="reason" rows={2} className={field} />
            <span className="mt-1 block text-slate">Required only when the rate changes. Payments already recorded are not changed.</span>
          </label>
          <button className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save rate for this file
          </button>
        </form>
      </section>

      <HeadOfLossScreen
        claimId={id}
        section={section}
        claimedNote={provisional ? "Provisional until the storage end is confirmed." : charge?.status === "calculated" ? charge.label : null}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="storage" recordVersion={sectionVersion("money", `${id}:storage`)} />
            <div className="mt-4">
              <PaymentReviewPanel
                claimId={id}
                lockedHead={{
                  head: "storage",
                  label: "Storage",
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
        head="storage"
        decision={latestChargeDecision(id, "storage")}
        canApproveSettlement={accountCanApproveSettlement(staff.id, staff.role)}
        recordVersion={sectionVersion("money", `${id}:storage`)}
      />
      <ChargeOffers
        claimId={id}
        head="storage"
        offers={listChargeOffers(id, "storage")}
        claimedPence={section.claimedPence}
        claimedUnderReview={flag.differs}
        agreedOn={agreedOnFor(id, "storage")}
        hasAgreed={(section.agreedPence || 0) > 0}
      />
    </div>
  );
}

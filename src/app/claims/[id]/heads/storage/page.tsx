import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { HeadAgreedForm } from "@/components/claims/HeadAgreedForm";
import { HeadOfLossScreen } from "@/components/claims/HeadOfLossScreen";
import { PaymentReviewPanel } from "@/components/claims/PaymentReviewPanel";
import { StorageDateReview } from "@/components/claims/StorageDateReview";
import { StorageEndDateReview } from "@/components/claims/StorageEndDateReview";
import { ChargeableStorageNote, StorageAuthorisationEndPanel } from "@/components/claims/StorageAuthorisationEnd";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate } from "@/lib/dates";
import { headScreenPath } from "@/lib/domain/head-screen";
import {
  STORAGE_INCLUSIVE_DAY_NOTE,
  prefillBlankStorageLocation,
  storageLocationFromSetting,
  storageLocationWasBlank,
} from "@/lib/domain/storage-charge";
import { formatGbp } from "@/lib/money";
import { accountCanAcceptPaymentSettlement } from "@/lib/db/permissions";
import { getClaim } from "@/lib/db/queries";
import { getScreenData } from "@/lib/db/screens";
import { claimStorageChargeEnded, storageAuthorisationEndForClaim } from "@/lib/db/storage-authorisation-end";
import {
  effectiveStorageRatePence,
  latestManualStorageEndReason,
  storageChargeForClaim,
  syncStorageClaimed,
} from "@/lib/db/storage-charge";
import { getStorageDateReview, getStorageEndDateReview } from "@/lib/db/storage-recovery-date";
import { getDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { loadHeadSection } from "@/lib/db/head-screen";

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
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const data = getClaim(id);
  if (!data) notFound();
  syncStorageClaimed(id);
  const saved = getScreenData(id, "storage");
  const defaults = storageLocationFromSetting(getDefaultVehicleLocation());
  const blankLocation = storageLocationWasBlank(saved);
  const location = prefillBlankStorageLocation(saved, defaults);
  const startDay = data.claim.storage_started_on ? String(data.claim.storage_started_on).slice(0, 10) : "";
  const endDay = data.claim.storage_billing_end_on ? String(data.claim.storage_billing_end_on).slice(0, 10) : "";
  const charge = storageChargeForClaim(id);
  const rate = effectiveStorageRatePence(data.claim.storage_rate_pence == null ? null : Number(data.claim.storage_rate_pence));
  const decision = storageAuthorisationEndForClaim(id);
  const manualReason = latestManualStorageEndReason(id);
  const proposed = decision.kind === "suggest" ? decision.date : decision.kind === "conflict" ? decision.suggestedDate : null;
  const section = loadHeadSection(id, "storage");
  const returnTo = headScreenPath(id, "storage");

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
          This is where the vehicle is, and the dates storage is charged. Saving these boxes does not change a payment. Two people saving at
          the same time: the later save is kept.
        </p>
        <StorageDateReview claimId={id} review={getStorageDateReview(id)} returnTo={returnTo} />
        {startDay ? (
          <StorageEndDateReview claimId={id} review={getStorageEndDateReview(id)} returnTo={returnTo} />
        ) : null}
        {startDay ? <StorageAuthorisationEndPanel claimId={id} decision={decision} returnTo={returnTo} /> : (
          <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
            Start date missing. A storage end cannot be proposed or confirmed.
          </p>
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
        {manualReason ? <p className="text-sm">Reason the end date is not the repair authorisation date: {manualReason}</p> : null}
        <ChargeableStorageNote ended={claimStorageChargeEnded(id)} endDay={endDay || null} />
        <p className="text-sm text-slate">
          The car can still be here after charging stops. The dashboard can still show it on site. It is not counted as chargeable storage once
          the confirmed end has passed.
        </p>
        <form method="post" action={`/claims/${id}/storage-details`} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Name
            <input name="name" defaultValue={location.name} className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Address
            <textarea name="address" defaultValue={location.address} rows={2} className={field} />
          </label>
          <label className="text-sm">
            Postcode
            <input name="postcode" defaultValue={location.postcode} className={field} />
          </label>
          <label className="text-sm">
            Tel
            <input name="telMain" defaultValue={location.telMain} className={field} />
          </label>
          <label className="text-sm">
            Email
            <input name="email" defaultValue={location.email} className={field} />
          </label>
          <label className="text-sm">
            Ref
            <input name="ref" defaultValue={saved.ref || ""} className={field} />
          </label>
          <label className="text-sm">
            Invoice no.
            <input name="invoiceNo" defaultValue={saved.invoiceNo || ""} className={field} />
          </label>
          <label className="text-sm">
            Start date
            <input name="startDate" type="date" defaultValue={startDay} className={field} />
          </label>
          {startDay ? (
            <>
              <label className="text-sm">
                Chargeable end date
                <input name="endDate" type="date" defaultValue={endDay} className={field} />
              </label>
              <label className="text-sm sm:col-span-2">
                Reason, if this end date is not the repair authorisation date
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
        <p className="text-sm text-slate">{STORAGE_INCLUSIVE_DAY_NOTE} Net, VAT and the total are calculated. They are not typed.</p>
        {charge?.status === "missing_start" ? <p className="text-sm font-semibold">Start date missing</p> : null}
        {charge?.status === "end_before_start" ? (
          <p className="text-sm">The chargeable end is before the start date. No figure is shown, and the claimed figure has not been changed.</p>
        ) : null}
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
        <form method="post" action={`/claims/${id}/storage-rate`} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Daily rate on this file (£)
            <input name="dailyRate" inputMode="decimal" required defaultValue={(rate.pence / 100).toFixed(2)} className={field} />
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
        claimedNote={charge?.status === "calculated" ? charge.label : null}
        canAccept={accountCanAcceptPaymentSettlement(staff.id, staff.role)}
        actions={
          <>
            <HeadAgreedForm claimId={id} head="storage" />
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
    </div>
  );
}

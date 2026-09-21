import Link from "next/link";
import { notFound } from "next/navigation";
import { actionGenerateHireAgreement, actionGenerateHirePack, actionGenerateStorageRecovery, actionSaveHirePack } from "@/app/actions";
import { getGtaMarkupPercent } from "@/lib/db/hire-agreement";
import { GTA_GROUPS, GTA_NOT_CLASSIFIED, GTA_RATE_PERIOD_LABEL, gtaGroupLabel, groupChargedAboveClient, normaliseGtaGroup, standardDailyRatePence } from "@/lib/documents/gta";
import { AgeField } from "@/components/AgeField";
import { MobileField } from "@/components/MobileField";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireStaff } from "@/lib/auth/session";
import { getHirePack } from "@/lib/db/hire-pack";
import { RENTAL_PERIOD_DECISION } from "@/lib/documents/hire-pack-fields";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function pounds(pence: string | number | null | undefined) {
  const n = Number(pence || 0) / 100;
  return n ? String(n) : "";
}

export default async function HirePackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; field?: string }>;
}) {
  const { id } = await params;
  const staffUser = await requireStaff();
  const { error, field } = await searchParams;
  const pack = getHirePack(id);
  if (!pack) notFound();
  const s = pack.stored;
  const actorId = staffUser.id;
  const markup = getGtaMarkupPercent();
  const clientGroup = normaliseGtaGroup(String(pack.claim.client_gta_group || ""));
  const suppliedGroup = normaliseGtaGroup(String(pack.hire?.supplied_gta_group || ""));
  const charged = normaliseGtaGroup(String(s.group_charged || "")) || clientGroup;
  const calculated = standardDailyRatePence(charged, markup);
  const manual = Number(s.daily_rate_manual) === 1 && Number(s.daily_rate_pence || 0) > 0;
  const dailyValue = manual ? (Number(s.daily_rate_pence) / 100).toFixed(2) : calculated != null ? (calculated / 100).toFixed(2) : "";
  const suppliedHigher = !groupChargedAboveClient(charged, clientGroup) && groupChargedAboveClient(suppliedGroup, clientGroup);
  const chargedHigher = groupChargedAboveClient(charged, clientGroup);
  const parts = pack.parts;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Hire Pack — ${pack.ctx.agreementNumber}`}
        subtitle="Hire Agreement from CAS's Hire Pack.doc. Only the pages that apply to this file are generated. The daily rate follows the client's own vehicle GTA group. Missing items are listed, not invented. Signatures are not added."
        actions={
          <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
            Back to file
          </Link>
        }
      />

      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}

      <section className="rounded-xl border border-line bg-card p-5 text-sm">
        <h2 className="font-serif text-xl text-navy-deep">What this agreement will include</h2>
        <ul className="mt-3 space-y-2">
          <li>{parts.hire.reason}</li>
          <li>{parts.storageRecovery.reason}</li>
          <li>{parts.termsAndCancel.reason}</li>
        </ul>
        <p className="mt-3 text-slate">
          Generating now produces {parts.pageCount} pages. The hire vehicle page and the Storage &amp; Recovery page are left out when they do not apply. They are not printed as blank pages.
        </p>
      </section>

      {parts.hire.included && pack.missing.length > 0 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          Still needed before this matches a complete hire pack: {pack.missing.join(", ")}.
        </p>
      ) : parts.hire.included ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Mandatory hire pack fields are present.</p>
      ) : null}

      <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
        <strong>Decision needed:</strong> {RENTAL_PERIOD_DECISION.note} CRM alerts: {RENTAL_PERIOD_DECISION.alertDays}{" "}
        days. Supplied pack: {RENTAL_PERIOD_DECISION.packDays} days. Neither number has been changed.
      </p>

      {pack.srMissing.length > 0 ? (
        <p className="rounded-md border border-line bg-card px-4 py-3 text-sm">
          The separate Storage &amp; Recovery button still files that document on its own. Still needed on it: {pack.srMissing.join(", ")}.
          The Hire Agreement includes that page only when storage or recovery has been arranged through CAS.
        </p>
      ) : (
        <p className="rounded-md border border-line bg-card px-4 py-3 text-sm">
          The separate Storage &amp; Recovery button can still file that document on its own ({pack.srNumber}). The Hire Agreement
          includes that page only when storage or recovery has been arranged through CAS.
        </p>
      )}

      <ValidatedForm
        className="space-y-6"
        action={actionSaveHirePack}
        initialError={error}
        initialErrorField={field}
      >
        <input type="hidden" name="claimId" value={id} />
        <input type="hidden" name="actorId" value={actorId} />

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Hirer</legend>
          <p className="text-sm text-slate">
            {pack.ctx.hirerName || "Unknown"} — pulled from the claim. Complete the licence and telephone fields used on the agreement.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Title
              <input name="title" className={field} defaultValue={String(s.title || "")} />
            </label>
            <label className="text-sm">
              Date of birth
              <AgeField name="date_of_birth" kind="hirer" defaultValue={pack.ctx.hirerDob || ""} className={field} />
            </label>
            <label className="text-sm">
              Driving licence number
              <input name="licence_number" className={field} defaultValue={pack.ctx.licenceNumber || ""} />
            </label>
            <label className="text-sm">
              Licence date of issue
              <input name="licence_issued_on" type="date" className={field} defaultValue={String(s.licence_issued_on || "")} />
            </label>
            <label className="text-sm">
              Licence date of expiry
              <input name="licence_expires_on" type="date" className={field} defaultValue={String(s.licence_expires_on || "")} />
            </label>
            <label className="text-sm">
              Delivery address
              <input name="delivery_address" className={field} defaultValue={String(s.delivery_address || pack.ctx.hirerAddress)} />
            </label>
            <label className="text-sm">
              Home tel
              <input name="home_tel" className={field} defaultValue={String(s.home_tel || "")} />
            </label>
            <label className="text-sm">
              Work tel
              <input name="work_tel" className={field} defaultValue={String(s.work_tel || "")} />
            </label>
            <label className="text-sm">
              Mobile
              <MobileField name="mobile_tel" defaultValue={String(s.mobile_tel || "")} className={field} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Additional driver</legend>
          <p className="text-sm text-slate">
            The supplied pack has a full second driver column (name, date of birth, licence number, issue and expiry). Optional — not required to generate the hire agreement.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Name
              <input name="additional_name" className={field} defaultValue={String(s.additional_name || "")} />
            </label>
            <label className="text-sm">
              Address
              <input name="additional_address" className={field} defaultValue={String(s.additional_address || "")} />
            </label>
            <label className="text-sm">
              Date of birth
              <AgeField
                name="additional_dob"
                kind="driver"
                defaultValue={String(s.additional_dob || "")}
                className={field}
              />
            </label>
            <label className="text-sm">
              Licence number
              <input name="additional_licence" className={field} defaultValue={String(s.additional_licence || "")} />
            </label>
            <label className="text-sm">
              Licence issue
              <input name="additional_licence_issued_on" type="date" className={field} defaultValue={String(s.additional_licence_issued_on || "")} />
            </label>
            <label className="text-sm">
              Licence expiry
              <input name="additional_licence_expires_on" type="date" className={field} defaultValue={String(s.additional_licence_expires_on || "")} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Hire vehicle and period</legend>
          <p className="text-sm text-slate">
            Hire vehicle supplied: {pack.hire ? `${pack.hire.hire_make} ${pack.hire.hire_model} ${pack.hire.hire_reg}` : "None allocated yet"}.
            Its GTA group is {gtaGroupLabel(suppliedGroup)} and is not used to calculate the rate.
            Client&apos;s own vehicle: {pack.clientMake} {pack.clientModel} {pack.ctx.clientVehicleRegistration || "not on file"}.
            Its GTA group is {gtaGroupLabel(clientGroup)}.
          </p>
          {suppliedHigher ? (
            <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">
              A higher-group vehicle is being supplied ({gtaGroupLabel(suppliedGroup)}). The daily rate still follows the client&apos;s own group ({gtaGroupLabel(clientGroup)}).
            </p>
          ) : null}
          {chargedHigher ? (
            <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm">
              Group Charged is above the client&apos;s own vehicle group. That is above normal CAS policy. Record why below. Saving is not blocked.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Fuel
              <input name="hire_fuel" className={field} defaultValue={String(s.hire_fuel || pack.hire?.hire_fuel || "")} />
            </label>
            <label className="text-sm">
              Client&apos;s own vehicle GTA group
              <select name="client_gta_group" className={field} defaultValue={clientGroup || ""}>
                <option value="">{GTA_NOT_CLASSIFIED}</option>
                {GTA_GROUPS.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Group Charged
              <select name="group_charged" className={field} defaultValue={charged || ""}>
                <option value="">Same as the client&apos;s own group</option>
                {GTA_GROUPS.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Reason if Group Charged is above the client&apos;s group
              <input name="group_override_reason" className={field} defaultValue={String(s.group_override_reason || "")} />
            </label>
            <label className="text-sm">
              Date out
              <input name="date_out" type="datetime-local" className={field} defaultValue={String(s.date_out || "").slice(0, 16)} />
            </label>
            <label className="text-sm">
              Date in
              <input name="date_in" type="datetime-local" className={field} defaultValue={String(s.date_in || "").slice(0, 16)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Charges (pounds, plus VAT on the pack)</legend>
          <p className="text-sm text-slate">
            Daily rate is the GTA ceiling for Group Charged, plus {markup}% markup
            {calculated != null ? ` (${(calculated / 100).toFixed(2)} pounds before you edit it)` : ""}. Reference rates are the supplied table for{" "}
            {GTA_RATE_PERIOD_LABEL}, which replaces the July 2025 – June 2026 workbook. Other charges stay as entered on this file. They are not filled from a default.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Money name="daily_rate" label="Daily rate" value={dailyValue} />
            <Money name="cdw" label="Collision damage waiver" value={pounds(s.cdw_pence)} />
            <Money name="delivery_collection" label="Delivery & collection" value={pounds(s.delivery_collection_pence)} />
            <Money name="additional_driver" label="Additional driver" value={pounds(s.additional_driver_pence)} />
            <Money name="sat_nav" label="Sat nav" value={pounds(s.sat_nav_pence)} />
            <Money name="hands_free" label="Hands free" value={pounds(s.hands_free_pence)} />
            <Money name="child_seat" label="Child seat" value={pounds(s.child_seat_pence)} />
            <Money name="automatic" label="Automatic charge" value={pounds(s.automatic_pence)} />
            <Money name="estate" label="Estate charge" value={pounds(s.estate_pence)} />
            <Money name="tow_bar" label="Tow bar" value={pounds(s.tow_bar_pence)} />
            <Money name="roof_rack" label="Roof rack" value={pounds(s.roof_rack_pence)} />
            <Money name="insurance_daily" label="Insurance (daily)" value={pounds(s.insurance_daily_pence)} />
            <Money name="insurance" label="Insurance" value={pounds(s.insurance_pence)} />
            <Money name="admin" label="Admin fee" value={pounds(s.admin_pence)} />
            <Money name="storage_daily" label="Storage (own vehicle) / day" value={pounds(s.storage_daily_pence)} />
            <Money name="recovery" label="Recovery (own vehicle)" value={pounds(s.recovery_pence)} />
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Mitigation / statement of truth</legend>
          <label className="flex gap-2 text-sm">
            <input name="no_replacement_offer" type="checkbox" defaultChecked={Number(s.no_replacement_offer) === 1} />
            No replacement offer from the at-fault insurer
          </label>
          <label className="block text-sm">
            Offer received but declined because
            <input name="declined_offer_reason" className={field} defaultValue={String(s.declined_offer_reason || "")} />
          </label>
          <label className="flex gap-2 text-sm">
            <input name="understands_personal_liability" type="checkbox" defaultChecked={Number(s.understands_personal_liability) === 1} />
            Client understands personal liability if hiring on credit
          </label>
          <label className="block text-sm">
            I need a hire vehicle because
            <textarea name="need_reason" rows={3} className={field} defaultValue={String(s.need_reason || "")} />
          </label>
          <label className="flex gap-2 text-sm">
            <input name="own_vehicle_unusable" type="checkbox" defaultChecked={Number(s.own_vehicle_unusable) === 1} />
            Own vehicle unroadworthy / unusable
          </label>
          <label className="flex gap-2 text-sm">
            <input name="no_other_vehicle" type="checkbox" defaultChecked={Number(s.no_other_vehicle) === 1} />
            No other suitable vehicle available
          </label>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Financial means (impecuniosity)</legend>
          <p className="text-sm text-slate">
            Ability to pay is a separate test from need. Intake already asks for a statement of means and three months&apos; bank statements. Record that disclosure here rather than treating it as a disconnected step.
          </p>
          <label className="flex gap-2 text-sm">
            <input name="means_documents_requested" type="checkbox" defaultChecked={Number(s.means_documents_requested) === 1} />
            Statement of means and bank statements have been requested
          </label>
          <label className="flex gap-2 text-sm">
            <input name="means_documents_on_file" type="checkbox" defaultChecked={Number(s.means_documents_on_file) === 1} />
            Statement of means and/or bank statements are on this file
          </label>
          <label className="flex gap-2 text-sm">
            <input name="cannot_fund_hire" type="checkbox" defaultChecked={Number(s.cannot_fund_hire) === 1} />
            Client could not reasonably have funded a replacement from their own resources
          </label>
          <label className="flex gap-2 text-sm">
            <input name="no_other_credit" type="checkbox" defaultChecked={Number(s.no_other_credit) === 1} />
            Client did not have access to other credit that they could reasonably have used
          </label>
          <label className="block text-sm">
            Further notes
            <textarea name="means_notes" rows={3} className={field} defaultValue={String(s.means_notes || "")} />
          </label>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Your Own Vehicle Details (storage &amp; recovery)</legend>
          <p className="text-sm text-slate">
            The client&apos;s damaged vehicle — not the hire vehicle. Storage &amp; Recovery can be generated without a hire agreement. Solicitor-reviewed standalone wording is still to come.
          </p>
          <p className="text-sm">
            {pack.clientMake} {pack.clientModel} {pack.ctx.clientVehicleRegistration || "Unknown"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Mileage
              <input name="own_vehicle_mileage" type="number" className={field} defaultValue={s.own_vehicle_mileage ? String(s.own_vehicle_mileage) : ""} />
            </label>
            <label className="text-sm">
              Fuel (E / 1/4 / 1/2 / 3/4 / F)
              <input name="own_vehicle_fuel" className={field} defaultValue={String(s.own_vehicle_fuel || "")} />
            </label>
            <label className="text-sm sm:col-span-2">
              Tyre depths NSF / OSF / NSR / OSR
              <input name="own_vehicle_tyres" className={field} defaultValue={String(s.own_vehicle_tyres || "")} />
            </label>
            <label className="text-sm sm:col-span-2">
              Damage
              <input name="own_vehicle_damage" className={field} defaultValue={String(s.own_vehicle_damage || "")} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Handover / collection (hire vehicle)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Delivery mileage
              <input name="delivery_mileage" type="number" className={field} defaultValue={s.delivery_mileage ? String(s.delivery_mileage) : ""} />
            </label>
            <label className="text-sm">
              Collection mileage
              <input name="collection_mileage" type="number" className={field} defaultValue={s.collection_mileage ? String(s.collection_mileage) : ""} />
            </label>
            <label className="text-sm">
              Delivery fuel (E / 1/4 / 1/2 / 3/4 / F)
              <input name="delivery_fuel" className={field} defaultValue={String(s.delivery_fuel || "")} />
            </label>
            <label className="text-sm">
              Collection fuel
              <input name="collection_fuel" className={field} defaultValue={String(s.collection_fuel || "")} />
            </label>
            <label className="text-sm sm:col-span-2">
              Tyre depths NSF / OSF / NSR / OSR
              <input name="delivery_tyres" className={field} defaultValue={String(s.delivery_tyres || "")} />
            </label>
            <label className="text-sm">
              Interior cleanliness
              <input name="delivery_interior" className={field} defaultValue={String(s.delivery_interior || "")} />
            </label>
            <label className="text-sm">
              Damage on delivery
              <input name="delivery_damage" className={field} defaultValue={String(s.delivery_damage || "")} />
            </label>
            <label className="text-sm sm:col-span-2">
              Damage on collection
              <input name="collection_damage" className={field} defaultValue={String(s.collection_damage || "")} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-dashed border-copper/40 bg-[#fbf6ec] p-5">
          <legend className="font-serif text-xl text-navy-deep">Driver sheets (internal)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Driver name
              <input name="driver_name" className={field} defaultValue={String(s.driver_name || "")} />
            </label>
            <label className="text-sm">
              Delivery start
              <input name="driver_delivery_start" className={field} defaultValue={String(s.driver_delivery_start || "")} />
            </label>
            <label className="text-sm">
              Delivery finish
              <input name="driver_delivery_finish" className={field} defaultValue={String(s.driver_delivery_finish || "")} />
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
            Save pack information
          </button>
          <button className="rounded-md bg-teal px-4 py-2 text-sm text-white" type="submit" formAction={actionGenerateHireAgreement}>
            Generate Hire Agreement
          </button>
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit" formAction={actionGenerateHirePack}>
            Generate Hire Pack
          </button>
          <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit" formAction={actionGenerateStorageRecovery}>
            Generate Storage &amp; Recovery
          </button>
        </div>
      </ValidatedForm>
    </div>
  );
}

function Money({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="text-sm">
      {label}
      <input name={name} inputMode="decimal" className={field} defaultValue={value} placeholder="0.00" />
    </label>
  );
}

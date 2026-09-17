import Link from "next/link";
import { notFound } from "next/navigation";
import { actionGenerateHirePack, actionSaveHirePack } from "@/app/actions";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { getHirePack } from "@/lib/db/hire-pack";
import { formatGbp } from "@/lib/money";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function pounds(pence: string | number | null | undefined) {
  const n = Number(pence || 0) / 100;
  return n ? String(n) : "";
}

export default async function HirePackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff();
  const pack = getHirePack(id);
  if (!pack) notFound();
  const s = pack.stored;
  const actorId = String(pack.claim.handler_id || "staff-sian");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Hire Pack — ${pack.ctx.agreementNumber}`}
        subtitle="Built from CAS's Hire Pack.doc. Information is taken from this file. Missing items are listed, not invented. Driver sheets stay internal."
        actions={
          <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
            Back to file
          </Link>
        }
      />

      {pack.missing.length > 0 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          Still needed before this matches a complete pack: {pack.missing.join(", ")}.
        </p>
      ) : (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Mandatory pack fields are present.</p>
      )}

      <form className="space-y-6" action={actionSaveHirePack}>
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
              <input name="date_of_birth" type="date" className={field} defaultValue={pack.ctx.hirerDob || ""} />
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
              <input name="mobile_tel" className={field} defaultValue={String(s.mobile_tel || "")} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line bg-card p-5">
          <legend className="font-serif text-xl text-navy-deep">Additional driver</legend>
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
              <input name="additional_dob" type="date" className={field} defaultValue={String(s.additional_dob || "")} />
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
            Hire vehicle from fleet allocation: {pack.hire ? `${pack.hire.hire_make} ${pack.hire.hire_model} ${pack.hire.hire_reg}` : "None allocated yet"}.
            Client's own vehicle (storage/recovery page): {pack.clientMake} {pack.clientModel} {pack.ctx.clientVehicleRegistration || "Unknown"}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Fuel
              <input name="hire_fuel" className={field} defaultValue={String(s.hire_fuel || pack.hire?.hire_fuel || "")} />
            </label>
            <label className="text-sm">
              Vehicle group
              <input name="vehicle_group" className={field} defaultValue={String(s.vehicle_group || "")} />
            </label>
            <label className="text-sm">
              Group charged
              <input name="group_charged" className={field} defaultValue={String(s.group_charged || "")} />
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
          <p className="text-sm text-slate">Do not add extras automatically. Enter the actual rates for this agreement. Current daily rate on the hire episode: {formatGbp(Number(pack.hire?.rate_pence_per_day || 0))}.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Money name="daily_rate" label="Daily rate" value={pounds(s.daily_rate_pence)} />
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
          <button className="rounded-md bg-teal px-4 py-2 text-sm text-white" type="submit" formAction={actionGenerateHirePack}>
            Generate Hire Pack
          </button>
        </div>
      </form>
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

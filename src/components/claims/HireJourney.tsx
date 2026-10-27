import Link from "next/link";
import { HirePackScreen } from "@/app/claims/[id]/hire-pack/page";
import { PrehireChecksScreen } from "@/app/claims/[id]/prehire/page";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatGbp } from "@/lib/money";
import { formatUkDateTime, londonTodayIso } from "@/lib/dates";
import type { HireArea } from "@/lib/db/hire-choice";
import { FUEL_LEVELS } from "@/lib/db/handover";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const button = "inline-flex min-h-11 items-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white";

const MISSING: Record<string, string> = {
  agreementNumber: "CAS reference",
  hirerName: "Client name",
  hirerAddress: "Address",
  hirerDob: "Date of birth",
  licenceNumber: "Driving licence number",
  licenceIssuedOn: "Licence date of issue",
  licenceExpiresOn: "Licence date of expiry",
  hireMake: "Hire car make",
  hireModel: "Hire car model",
  hireRegistration: "Hire car registration",
  hireTransmission: "Hire car transmission",
  dateOut: "Handover date",
  dailyRatePence: "Daily rate",
  needReason: "Why a hire car is needed",
  clientVehicleRegistration: "Client vehicle registration",
};

function missingHref(claimId: string, key: string) {
  if (key === "dailyRatePence" || key === "clientVehicleRegistration") return `/claims/${claimId}/details/vehicle`;
  if (key.startsWith("hire")) return `/claims/${claimId}/hire#car`;
  if (key === "dateOut") return `/claims/${claimId}/hire#handover`;
  if (key === "licenceIssuedOn" || key === "licenceExpiresOn") return `/claims/${claimId}/hire#pack`;
  return `/claims/${claimId}/details/client`;
}

export function HireJourney({
  area,
  error,
  saved,
  handlers,
  filters,
}: {
  area: HireArea;
  error?: string;
  saved?: string;
  handlers: Array<{ id: string; name: string }>;
  filters: { date: string; transmission: string; vehicleClass: string; seats: string };
}) {
  const id = area.claimId;
  const carLabel = area.creditHire ? "hire car" : "courtesy car";
  return (
    <div className="space-y-6">
      <p>
        <Link href={area.next.href} className={button}>
          Next: {area.next.label}
        </Link>
      </p>
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved === "1" && !error ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}

      <section id="need" className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Hire needed?</h2>
        {!area.creditHire ? (
          <p className="mt-2 text-sm">This is a courtesy car. There is no daily charge to an insurer.</p>
        ) : null}
        <form method="post" action={`/claims/${id}/hire/need`} className="mt-4 space-y-3">
          <SubmitKeyInput />
          <input type="hidden" name="returnHash" value="#need" />
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="choice" value="yes" defaultChecked={area.need === "yes"} required />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="choice" value="not_yet" defaultChecked={area.need === "not_yet"} />
            Not yet – client keeps own car
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="choice" value="not_needed" defaultChecked={area.need === "no"} />
            Not needed
          </label>
          <label className="block text-sm">
            Reason if not needed
            <textarea name="reason" className={field} rows={2} defaultValue={area.need === "no" ? area.needReason : ""} />
          </label>
          <button className={button} type="submit">
            Save
          </button>
        </form>
      </section>

      {area.need === "yes" ? (
        <section id="checks" className="space-y-3">
          <h2 className="font-serif text-xl text-navy-deep">Pre-hire checks</h2>
          {area.checksMessage ? <p className="text-sm text-overdue">{area.checksMessage}</p> : <p className="text-sm text-ok">Checks are clear.</p>}
          <PrehireChecksScreen params={Promise.resolve({ id })} searchParams={Promise.resolve({})} />
        </section>
      ) : null}

      {area.need === "yes" && area.checksClear ? (
        <section id="car" className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Choose a car</h2>
          <p className="mt-2 text-sm">Only free cars are listed. A reservation does not start hire charges. The rate is taken from Settings now and is kept on this hire.</p>
          {area.chosen ? (
            <p className="mt-3 text-sm" data-chosen-car={area.chosen.registration}>
              Chosen: {area.chosen.label || area.chosen.registration}. Change it here. The old reservation is released.
            </p>
          ) : null}
          <form method="get" action={`/claims/${id}/hire`} className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              From
              <input type="date" name="date" className={field} defaultValue={filters.date} />
            </label>
            <label className="text-sm">
              Transmission
              <input name="transmission" className={field} defaultValue={filters.transmission} />
            </label>
            <label className="text-sm">
              Class
              <input name="class" className={field} defaultValue={filters.vehicleClass} />
            </label>
            <label className="text-sm">
              Seats at least
              <input name="seats" inputMode="numeric" className={field} defaultValue={filters.seats} />
            </label>
            <button className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy" type="submit">
              Show cars
            </button>
          </form>
          <form method="post" action={`/claims/${id}/hire/choose`} className="mt-4 space-y-3">
            <SubmitKeyInput />
            <input type="hidden" name="returnHash" value="#car" />
            {area.cars.map((car) => (
              <input key={car.id} type="hidden" name={`fleetVersion_${car.id}`} value={car.version} />
            ))}
            <label className="block text-sm">
              Car
              <select name="fleetVehicleId" className={field} required defaultValue={area.chosen?.fleetVehicleId || ""}>
                <option value="" disabled>
                  {area.cars.length ? "Choose one" : "No free car for these dates"}
                </option>
                {area.cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.label} · {car.transmission || "transmission not recorded"} · {car.seats ?? "?"} seats
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              How the client gets the car
              <select name="method" className={field} required defaultValue={area.delivery?.method || "deliver"}>
                <option value="deliver">Deliver to the client</option>
                <option value="collect">Client collects</option>
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Date
                <input type="date" name="date" required className={field} defaultValue={area.delivery?.date || filters.date || londonTodayIso()} />
              </label>
              <label className="text-sm">
                Time
                <input type="time" name="time" required className={field} defaultValue={area.delivery?.time || "09:00"} />
              </label>
            </div>
            <label className="block text-sm">
              Delivery address
              <input name="address" className={field} defaultValue={area.delivery?.address || area.address} />
            </label>
            <button className={button} type="submit">
              {area.startedAt ? "Change car" : "Reserve this car"}
            </button>
          </form>
          {!area.startedAt && area.chosen ? (
            <form method="post" action={`/claims/${id}/hire/cancel`} className="mt-3">
              <SubmitKeyInput />
              <input type="hidden" name="returnHash" value="#car" />
              <button className="text-sm text-teal-dark underline" type="submit">
                Cancel this reservation
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {area.need === "yes" && area.creditHire && area.chosen ? (
        <section id="pack" className="space-y-3">
          <h2 className="font-serif text-xl text-navy-deep">Hire pack</h2>
          <p className="text-sm">
            E-signature is not set up. Print the pack, sign it, and upload the signed copy. The licence number is taken from the client record and is not typed again here.
          </p>
          {area.packMissing.length ? (
            <ul className="list-disc pl-5 text-sm">
              {area.packMissing.map((key) => (
                <li key={key}>
                  <Link href={missingHref(id, key)} className="text-teal-dark underline">
                    {MISSING[key] || key}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ok">The pack has the details it needs from the file.</p>
          )}
          <p className="text-sm">Daily rate on this hire: {area.ratePence ? `${formatGbp(area.ratePence)} a day` : "Not on the file yet"}.</p>
          <HirePackScreen params={Promise.resolve({ id })} searchParams={Promise.resolve({})} />
        </section>
      ) : null}

      {area.need === "yes" && area.chosen && !area.startedAt ? (
        <section id="handover" className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Handover</h2>
          <p className="mt-2 text-sm" data-handover-car={area.chosen.registration}>
            Car: {area.chosen.label || area.chosen.registration}. To change it, use Choose a car.
          </p>
          <p className="mt-2 text-sm">
            Condition photographs stay on the{" "}
            <Link href={`/claims/${id}/handover`} className="text-teal-dark underline">
              handover page
            </Link>
            . Completing this record starts the {carLabel} on the date below.
          </p>
          <form method="post" action={`/claims/${id}/hire/handover`} className="mt-4 space-y-3">
            <SubmitKeyInput />
            <input type="hidden" name="returnHash" value="#handover" />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Handover date
                <input type="date" name="date" required className={field} defaultValue={area.delivery?.date || londonTodayIso()} />
              </label>
              <label className="text-sm">
                Time
                <input type="time" name="time" required className={field} defaultValue={area.delivery?.time || "09:00"} />
              </label>
              <label className="text-sm">
                Mileage out
                <input name="mileage" type="number" min={0} step={1} required className={field} />
              </label>
              <label className="text-sm">
                Fuel out
                <select name="fuelLevel" className={field} required defaultValue="full">
                  {FUEL_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              Who handed it over
              <select name="driverId" className={field} required defaultValue={handlers[0]?.id || ""}>
                {handlers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Condition note
              <textarea name="conditionNote" className={field} rows={2} />
            </label>
            <button className={button} type="submit">
              Complete handover
            </button>
          </form>
        </section>
      ) : null}

      {area.startedAt ? (
        <section id="on-hire" className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">On hire</h2>
          <p className="mt-2 text-sm">Started {formatUkDateTime(area.startedAt)}.</p>
          {area.dayCount != null ? <p className="text-sm">Day {area.dayCount}.</p> : null}
          {area.renewal ? <p className="text-sm">{area.renewal}</p> : null}
          {area.chosen ? <p className="text-sm">Car: {area.chosen.label}</p> : null}
          <p className="mt-3 text-sm">To swap the car, use Choose a car above. The day count does not restart.</p>
          <form method="post" action={`/claims/${id}/hire/collect`} className="mt-4 space-y-3">
            <h3 className="font-serif text-lg text-navy-deep">Collection</h3>
            <p className="text-sm">This arranges the driver job. Hire charges still end only when a handler confirms the car is back, or seven days after a qualifying total-loss payment.</p>
            <SubmitKeyInput />
            <input type="hidden" name="returnHash" value="#on-hire" />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Date
                <input type="date" name="date" required className={field} defaultValue={londonTodayIso()} />
              </label>
              <label className="text-sm">
                Time
                <input type="time" name="time" required className={field} defaultValue="09:00" />
              </label>
            </div>
            <label className="block text-sm">
              Address
              <input name="address" className={field} defaultValue={area.address} />
            </label>
            <button className={button} type="submit">
              {area.collectionJobId ? "Update collection" : "Arrange collection"}
            </button>
          </form>
          <p className="mt-3 text-sm">
            Photographs:{" "}
            <Link href={`/claims/${id}/handover`} className="text-teal-dark underline">
              handover page
            </Link>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}

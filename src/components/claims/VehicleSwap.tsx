import Link from "next/link";
import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDateTime, londonTodayIso } from "@/lib/dates";
import { FUEL_LEVELS } from "@/lib/db/handover";
import type { HireArea } from "@/lib/db/hire-choice";
import { CarOptionGroups } from "@/components/claims/CarOptions";
import { SWAP_AGREEMENT_FIELDS, type SwapView } from "@/lib/db/vehicle-swap";
import { fleetDetailLine, type FleetCarDetails, missingWords } from "@/lib/db/fleet-details";
import { chargedAboveSupplied } from "@/lib/db/hire-group-check";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const button = "inline-flex min-h-11 items-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white";
const quiet = "inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-navy";
const fileAccept = "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif";

function FuelSelect({ name }: { name: string }) {
  return (
    <select name={name} className={field} required defaultValue="">
      <option value="" disabled>
        Choose
      </option>
      {FUEL_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.label}
        </option>
      ))}
    </select>
  );
}

/**
 * R26: swapping the car on a running hire. First the replacement car is chosen. Then any of its details the new
 * agreement prints and its fleet record lacks are boxes here (R28), with a reason when the group charged is above its
 * group (R27), both cars' readings, and a new hire agreement for the client to sign.
 */
export function SwapStartForm({
  area,
  swapCar,
  swapCarDetails,
  groups,
}: {
  area: HireArea;
  swapCar?: string;
  swapCarDetails: FleetCarDetails | null;
  groups: string[];
}) {
  const id = area.claimId;
  const cars = [...area.cars, ...area.carsMissingDetails, ...area.otherVehicles].filter((car) => car.id !== area.chosen?.fleetVehicleId);
  const picked = swapCar && swapCarDetails && cars.some((car) => car.id === swapCar) ? swapCarDetails : null;
  if (!picked) {
    return (
      <form method="get" action={`/claims/${id}/hire#swap-start`} className="space-y-3" data-swap-choose>
        <p className="text-sm">
          {area.creditHire
            ? "The client signs a new hire agreement for the replacement car. The swap is completed when it is signed. The hire and its day count carry on."
            : "A courtesy car swap. The hire and its day count carry on."}
        </p>
        <label className="block text-sm">
          Replacement car
          <select name="swapCar" className={field} required defaultValue="">
            <option value="" disabled>
              {cars.length ? "Choose one" : "No free car for these dates"}
            </option>
            <CarOptionGroups area={area} exclude={area.chosen?.fleetVehicleId} />
          </select>
        </label>
        <button className={quiet} type="submit">
          Next
        </button>
      </form>
    );
  }
  const missing = area.creditHire ? SWAP_AGREEMENT_FIELDS.filter((key) => picked.missing.includes(key)) : [];
  const groupUnknown = missing.includes("gtaGroup");
  const above = area.creditHire && !groupUnknown && chargedAboveSupplied(area.groupCharged, picked.gtaGroup);
  const askReason = area.creditHire && Boolean(area.groupCharged) && (above || groupUnknown);
  return (
    <form method="post" action={`/claims/${id}/hire/swap`} className="space-y-4" data-swap-form>
      <SubmitKeyInput />
      <input type="hidden" name="intent" value="start" />
      <input type="hidden" name="fleetVehicleId" value={picked.fleetVehicleId} />
      <input type="hidden" name="swapCar" value={picked.fleetVehicleId} />
      <input type="hidden" name="returnHash" value="#swap-start" />
      <p className="text-sm" data-swap-car={picked.registration}>
        Replacement car: <strong>{[picked.make, picked.model, picked.registration].filter(Boolean).join(" ")}</strong>
        {fleetDetailLine(picked) ? ` · ${fleetDetailLine(picked)}` : ""}.{" "}
        <Link href={`/claims/${id}/hire#swap-start`} className="text-teal-dark underline">
          Choose another car
        </Link>
      </p>
      {missing.length ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] p-3 text-sm" data-swap-car-details>
          This car&apos;s fleet record has no {missingWords(missing)}, so it cannot be chosen yet.{" "}
          <Link href={`/hire/fleet-details?car=${picked.fleetVehicleId}&back=${encodeURIComponent(`/claims/${id}/hire?swapCar=${picked.fleetVehicleId}#swap-start`)}`} className="font-semibold underline">
            Complete it in Fleet
          </Link>{" "}
          and come back to this swap.
        </p>
      ) : null}
      {askReason ? (
        <label className="block text-sm" data-swap-above-reason>
          {above
            ? `Reason for charging group ${area.groupCharged} when this car is group ${picked.gtaGroup}`
            : `Reason, if group ${area.groupCharged} (the group charged) is above the group you enter for this car`}
          <textarea name="aboveSuppliedReason" rows={2} maxLength={1000} required={above} className={field} />
          <span className="mt-1 block text-slate">Kept on the file and shown in the history. The rate stays on group {area.groupCharged}.</span>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Date of the swap
          <input type="date" name="date" required className={field} defaultValue={londonTodayIso()} />
        </label>
        <label className="text-sm">
          Time
          <input type="time" name="time" required className={field} />
        </label>
      </div>
      <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">{area.chosen?.label || "The car"} coming back</legend>
        <label className="text-sm">
          Mileage in
          <input name="oldMileageIn" inputMode="numeric" required className={field} />
        </label>
        <label className="text-sm">
          Fuel in
          <FuelSelect name="oldFuelIn" />
        </label>
        <label className="text-sm sm:col-span-3">
          Condition
          <textarea name="oldCondition" rows={2} required className={field} placeholder="No new damage" />
        </label>
      </fieldset>
      <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Replacement car going out</legend>
        <label className="text-sm">
          Mileage out
          <input name="newMileageOut" inputMode="numeric" required className={field} />
        </label>
        <label className="text-sm">
          Fuel out
          <FuelSelect name="newFuelOut" />
        </label>
        <label className="text-sm sm:col-span-3">
          Condition
          <textarea name="newCondition" rows={2} required className={field} placeholder="No damage" />
        </label>
      </fieldset>
      <button className={button} type="submit">
        {area.creditHire ? "Record the swap and produce the new agreement" : "Record the swap"}
      </button>
    </form>
  );
}

/** On the On hire panel: the two clocks, a swap waiting for its signature, and past swaps. */
export function SwapStatus({ claimId, swap, mayOverride }: { claimId: string; swap: SwapView; mayOverride: boolean }) {
  return (
    <>
      {swap.agreementClock ? (
        <p className="mt-1 text-sm font-semibold" data-agreement-clock>
          {swap.agreementClock}
        </p>
      ) : null}
      {swap.open ? (
        <div className="mt-4 space-y-3 rounded-md border border-overdue/40 bg-[#f8ecec] p-3 text-sm" data-swap-waiting>
          <p className="font-semibold">
            Swap to {swap.open.newCar} on {formatUkDateTime(swap.open.swapAt)} is waiting for the new signed hire agreement. {swap.open.oldCar} stays on the
            hire until then.
          </p>
          <p>
            {swap.open.agreementDocumentId ? (
              <>
                <Link href={`/documents/${swap.open.agreementDocumentId}`} className="text-teal-dark underline">
                  Open the new agreement
                </Link>
                {" · "}
              </>
            ) : null}
            <Link href={`/claims/${claimId}/sign`} className="text-teal-dark underline">
              Client signs on this screen
            </Link>
          </p>
          <form method="post" action={`/claims/${claimId}/hire/swap`} encType="multipart/form-data" className="space-y-2">
            <SubmitKeyInput />
            <input type="hidden" name="intent" value="signed" />
            <label className="block">
              Or upload the signed paper copy (a photograph is fine)
              <input name="signedAgreement" type="file" required accept={fileAccept} className={field} />
            </label>
            <button className={button} type="submit">
              Upload and complete the swap
            </button>
          </form>
          {mayOverride ? (
            <form method="post" action={`/claims/${claimId}/hire/swap`} className="space-y-2" data-swap-override>
              <SubmitKeyInput />
              <input type="hidden" name="intent" value="override" />
              <label className="block">
                Complete without the signed agreement (Justin only). Reason
                <input name="reason" required className={field} />
              </label>
              <button className={quiet} type="submit">
                Complete the swap without it
              </button>
            </form>
          ) : null}
          <form method="post" action={`/claims/${claimId}/hire/swap`}>
            <SubmitKeyInput />
            <input type="hidden" name="intent" value="cancel" />
            <button className="text-teal-dark underline" type="submit">
              Cancel the swap
            </button>
          </form>
        </div>
      ) : null}
      {swap.history.length ? (
        <ul className="mt-2 text-sm text-slate" data-swap-history>
          {swap.history.map((row) => (
            <li key={row.at}>
              Swapped {row.from} for {row.to} on {formatUkDateTime(row.at)} · {row.how}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

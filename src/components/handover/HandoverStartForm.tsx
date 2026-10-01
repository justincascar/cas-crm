"use client";

import { useState } from "react";
import { SIGNATORY_RELATIONSHIPS, SIGNATURE_HONESTY } from "@/lib/domain/handover-signature";
import { SignaturePad } from "@/components/handover/SignaturePad";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";

type Booking = { id: string; label: string };
type Occasion = { kind: string; label: string; needsBooking: boolean };

export function HandoverStartForm({
  action,
  claimId,
  office,
  bookings,
  customerVehicle,
  occasions,
  initialVehicle,
  initialEventKind,
  drivers,
  defaultDriverId,
  defaultWhen,
}: {
  action: string;
  claimId: string;
  office: boolean;
  bookings: Booking[];
  customerVehicle: string;
  occasions: Occasion[];
  initialVehicle?: "hire" | "customer";
  initialEventKind?: string;
  drivers: Booking[];
  defaultDriverId: string;
  defaultWhen: string;
}) {
  const startVehicle = initialVehicle === "customer" || (initialVehicle === "hire" && bookings.length > 0) ? initialVehicle : bookings.length ? "hire" : "customer";
  const [vehicle, setVehicle] = useState<"hire" | "customer">(startVehicle);
  const shown = occasions.filter((event) => event.needsBooking === (vehicle === "hire"));
  const eventDefault = shown.some((event) => event.kind === initialEventKind) ? initialEventKind : shown[0]?.kind || "";
  const onlyBooking = bookings.length === 1 ? bookings[0] : null;

  return (
    <form method="post" action={action} encType="multipart/form-data" className="space-y-4 rounded-xl border border-line bg-card p-5">
      <h2 className="font-serif text-xl text-navy-deep">Record a handover</h2>
      <input type="hidden" name="claimId" value={claimId} />
      <label className="block text-sm">
        Vehicle
        <select
          name="vehicle"
          className={field}
          required
          value={vehicle}
          onChange={(event) => setVehicle(event.target.value === "customer" ? "customer" : "hire")}
        >
          <option value="hire">Hire car</option>
          <option value="customer">Customer&apos;s vehicle</option>
        </select>
      </label>
      <label className="block text-sm">
        What is happening
        <select name="eventKind" key={vehicle} className={field} required defaultValue={eventDefault}>
          {shown.map((event) => (
            <option key={event.kind} value={event.kind}>
              {event.label}
            </option>
          ))}
        </select>
      </label>
      {vehicle === "hire" ? (
        office ? (
          <label className="block text-sm">
            Which hire car
            <select name="hireEpisodeId" className={field} required defaultValue={bookings[0]?.id || ""}>
              {bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.label}
                </option>
              ))}
            </select>
          </label>
        ) : onlyBooking ? (
          <>
            <input type="hidden" name="hireEpisodeId" value={onlyBooking.id} />
            <p className="text-sm">Hire car: {onlyBooking.label}</p>
          </>
        ) : (
          <label className="block text-sm">
            Which hire car
            <select name="hireEpisodeId" className={field} required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.label}
                </option>
              ))}
            </select>
          </label>
        )
      ) : (
        <>
          <input type="hidden" name="hireEpisodeId" value="" />
          <p className="text-sm">Customer&apos;s vehicle: {customerVehicle}</p>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Mileage
          <input name="mileage" type="number" min={0} step={1} required className={field} />
        </label>
        <label className="text-sm">
          Fuel level
          <select name="fuelLevel" className={field} required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            <option value="empty">Empty</option>
            <option value="quarter">¼</option>
            <option value="half">½</option>
            <option value="three_quarters">¾</option>
            <option value="full">Full</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Driver who did this
        <select name="actualDriverId" className={field} required defaultValue={defaultDriverId}>
          <option value="">Choose the driver</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Date and time this happened
        <input name="actualOccurredAt" type="datetime-local" required className={field} defaultValue={defaultWhen} />
      </label>
      <p className="text-sm text-slate">
        These are the driver and the time it happened. They stay as you enter them when someone else types this up later. They are not taken from the sign-in, and they are not the moment you press save.
      </p>
      <fieldset className="space-y-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Client confirmation</legend>
        <p className="text-sm text-slate">{SIGNATURE_HONESTY}</p>
        <p className="text-sm text-slate">
          The time kept with the signature is the date and time this handover happened, above. It is not a separate clock, and it cannot be changed later. A correction is a new handover.
        </p>
        <label className="block text-sm">
          Printed name
          <input name="signatureName" className={field} autoComplete="name" />
        </label>
        <label className="block text-sm">
          Relationship to the claim
          <select name="signatureRelationship" className={field} defaultValue="">
            <option value="">Choose one</option>
            {SIGNATORY_RELATIONSHIPS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Signature
          <SignaturePad />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="signatureSkipped"
            value="yes"
            onChange={(event) => {
              if (!event.target.checked || !event.target.form) return;
              const png = event.target.form.elements.namedItem("signaturePng");
              if (png instanceof HTMLInputElement) png.value = "";
            }}
          />
          No signature — client not available or not willing to sign
        </label>
        <label className="block text-sm">
          Reason, if there is no signature
          <input name="signatureSkipReason" className={field} placeholder="For example: client not present" />
        </label>
      </fieldset>
      <label className="block text-sm">
        Damage and condition
        <textarea name="conditionNote" rows={3} className={field} placeholder="What you can see. If this corrects an earlier record, say what was wrong." />
      </label>
      <p className="text-sm text-slate">
        Save the mileage and fuel first. Each photograph is stored as soon as you take it, and the page moves on to the next one. A hire car needs Front, Rear, Driver&apos;s side, Passenger&apos;s side, then Interior. The customer&apos;s own vehicle needs those, then Dash and Chassis number. Damage photos are optional.
      </p>
      <button className="min-h-11 w-full rounded-md bg-navy px-4 py-3 text-base text-white sm:w-auto" type="submit">
        Save details and take photographs
      </button>
    </form>
  );
}

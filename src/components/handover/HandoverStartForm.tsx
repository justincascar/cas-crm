"use client";

import { useState } from "react";

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
}: {
  action: string;
  claimId: string;
  office: boolean;
  bookings: Booking[];
  customerVehicle: string;
  occasions: Occasion[];
}) {
  const [vehicle, setVehicle] = useState<"hire" | "customer">(bookings.length ? "hire" : "customer");
  const shown = occasions.filter((event) => event.needsBooking === (vehicle === "hire"));
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
        <select name="eventKind" key={vehicle} className={field} required defaultValue={shown[0]?.kind || ""}>
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
        Damage and condition
        <textarea name="conditionNote" rows={3} className={field} placeholder="What you can see. If this corrects an earlier record, say what was wrong." />
      </label>
      <p className="text-sm text-slate">
        Save the mileage and fuel first. Each photograph is stored as soon as you take it, and the page moves on to the next shot: Front, Rear, Driver&apos;s side, Passenger&apos;s side, then Interior. Damage photos are optional.
      </p>
      <button className="min-h-11 w-full rounded-md bg-navy px-4 py-3 text-base text-white sm:w-auto" type="submit">
        Save details and take photographs
      </button>
    </form>
  );
}

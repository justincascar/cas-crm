"use client";

import { useState } from "react";
import { actionReserveVehicle } from "@/app/actions";

export function ReserveForm({
  vehicles,
  claims,
}: {
  vehicles: Array<{ id: string; label: string }>;
  claims: Array<{ id: string; label: string }>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-card p-5 md:grid-cols-2"
      action={async (formData) => {
        const result = await actionReserveVehicle(formData);
        setMessage(result.error || "Reservation saved. Charges have not been started.");
      }}
    >
      <h2 className="font-serif text-xl text-navy-deep md:col-span-2">New reservation</h2>
      <label className="text-sm">
        Vehicle
        <select name="fleetVehicleId" className="mt-1 w-full rounded-md border border-line px-3 py-2">
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Claim (optional)
        <select name="claimId" className="mt-1 w-full rounded-md border border-line px-3 py-2">
          <option value="">Staff / unallocated</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Start
        <input name="startAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-line px-3 py-2" />
      </label>
      <label className="text-sm">
        End
        <input name="endAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-line px-3 py-2" />
      </label>
      <label className="text-sm">
        Kind
        <select name="kind" className="mt-1 w-full rounded-md border border-line px-3 py-2" defaultValue="hire">
          <option value="hire">Hire (charges still not started by reservation)</option>
          <option value="courtesy">Courtesy</option>
          <option value="staff">Staff booking</option>
        </select>
      </label>
      <input type="hidden" name="createdBy" value="staff-sian" />
      <div className="flex items-end">
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Reserve
        </button>
      </div>
      {message ? <p className="text-sm text-copper md:col-span-2">{message}</p> : null}
      <p className="text-xs text-slate md:col-span-2">
        Overlapping allocations, including staff bookings, are blocked. A reservation does not start hire charges.
      </p>
    </form>
  );
}

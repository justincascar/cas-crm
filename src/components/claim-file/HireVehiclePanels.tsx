import { actionReserveVehicle, actionSaveClaimScreen } from "@/app/actions";
import { ValidatedForm } from "@/components/ValidatedForm";
import type { ScreenValues } from "@/lib/db/screens";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

type FleetRow = Record<string, string | number | null>;

export function HireVehiclePanel({
  claimId,
  actorId,
  fleet,
  values,
  saved,
  error,
  errorField,
}: {
  claimId: string;
  actorId: string;
  fleet: FleetRow[];
  values: ScreenValues;
  saved?: boolean;
  error?: string;
  errorField?: string;
}) {
  const available = fleet.filter((v) => String(v.status) === "available");
  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Category</th>
              <th>Registration</th>
              <th>Make</th>
              <th>Model</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((v) => (
              <tr key={String(v.id)}>
                <td className="ref">{String(v.id)}</td>
                <td>{String(v.body_type || "Standard")}</td>
                <td>{String(v.registration)}</td>
                <td>{String(v.make)}</td>
                <td>{String(v.model)}</td>
                <td>{String(v.status).replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ValidatedForm
        action={actionReserveVehicle}
        className="space-y-3 rounded-xl border border-line bg-card p-5"
        initialError={error}
        initialErrorField={errorField}
      >
        <h2 className="font-serif text-xl text-navy-deep">Hire fleet vehicle</h2>
        <p className="text-sm text-slate">
          Allocating or reserving a vehicle does not start hire charges. Overlaps, including staff bookings, are blocked.
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="createdBy" value={actorId} />
        <input type="hidden" name="returnTo" value={`/claims/${claimId}/work/hire-vehicle`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Fleet vehicle
            <select name="fleetVehicleId" required className={field}>
              {available.length === 0 ? <option value="">None available</option> : null}
              {available.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {String(v.registration)} — {String(v.make)} {String(v.model)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Kind
            <select name="kind" className={field} defaultValue="hire">
              <option value="hire">Hire (charges not started)</option>
              <option value="courtesy">Courtesy — not credit hire</option>
            </select>
          </label>
          <label className="text-sm">
            Hold from
            <input name="startAt" type="datetime-local" required className={field} />
          </label>
          <label className="text-sm">
            Hold until
            <input name="endAt" type="datetime-local" required className={field} />
          </label>
        </div>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Reserve for this file
        </button>
      </ValidatedForm>

      <ValidatedForm action={actionSaveClaimScreen} className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Cross hire</h2>
        <p className="text-sm text-slate">Record a vehicle hired from another supplier. This does not invent a live booking.</p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="screenKey" value="hire-vehicle" />
        <input type="hidden" name="actorId" value={actorId} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="crossHire" value="yes" defaultChecked={values.crossHire === "yes"} />
          Cross hire
        </label>
        <label className="block text-sm">
          Notes
          <textarea name="crossHireNotes" rows={3} className={field} defaultValue={values.crossHireNotes || ""} />
        </label>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Save cross-hire note
        </button>
        {saved ? <p className="text-sm text-ok">Saved.</p> : null}
      </ValidatedForm>
    </div>
  );
}

export function ReserveHirePanel({
  claimId,
  actorId,
  fleet,
  reservations,
  error,
  errorField,
}: {
  claimId: string;
  actorId: string;
  fleet: FleetRow[];
  reservations: FleetRow[];
  error?: string;
  errorField?: string;
}) {
  const onHire = fleet.filter((v) => String(v.status) === "on_hire" || String(v.status) === "reserved");
  return (
    <div className="space-y-6">
      <ValidatedForm
        action={actionReserveVehicle}
        className="space-y-3 rounded-xl border border-line bg-card p-5"
        initialError={error}
        initialErrorField={errorField}
      >
        <h2 className="font-serif text-xl text-navy-deep">Reserve a vehicle currently on hire</h2>
        <p className="text-sm text-slate">
          This books a future hold after the current use. It does not start charges on this file, and overlapping dates are blocked.
        </p>
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="createdBy" value={actorId} />
        <input type="hidden" name="kind" value="hire" />
        <input type="hidden" name="returnTo" value={`/claims/${claimId}/work/reserve`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            Vehicle currently in use
            <select name="fleetVehicleId" required className={field}>
              {onHire.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {String(v.registration)} — {String(v.make)} {String(v.model)} ({String(v.status).replaceAll("_", " ")})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Hold from
            <input name="startAt" type="datetime-local" required className={field} />
          </label>
          <label className="text-sm">
            Hold until
            <input name="endAt" type="datetime-local" required className={field} />
          </label>
        </div>
        <button className="rounded-md bg-navy px-4 py-2 text-sm text-white" type="submit">
          Reserve this vehicle
        </button>
      </ValidatedForm>

      <section className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Make / model</th>
              <th>File</th>
              <th>Hold</th>
              <th>Charges started</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={String(r.id)}>
                <td className="ref">{String(r.registration)}</td>
                <td>
                  {String(r.make)} {String(r.model)}
                </td>
                <td>{String(r.file_reference || "—")}</td>
                <td>
                  {String(r.start_at).slice(0, 16).replace("T", " ")} – {String(r.end_at).slice(0, 16).replace("T", " ")}
                </td>
                <td>{Number(r.charges_started) ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

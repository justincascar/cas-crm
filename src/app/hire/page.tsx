import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { ReserveForm } from "@/components/ReserveForm";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import { listClaims, listFleet, listReservations } from "@/lib/db/queries";
import { sectionVersion } from "@/lib/db/record-version";
import { fleetSearchMatches } from "@/lib/db/fleet";
import { fleetStatesToday, listFleetRecordsToCheck } from "@/lib/db/fleet-availability";
import { vehicleClassLabel } from "@/lib/fleet/classes";
import { FleetDetailBox } from "@/components/FleetDetailBox";
import { fleetDetailLine, fleetGroupChoices, listFleetDetailsToComplete, missingWords } from "@/lib/db/fleet-details";
import { formatVehicleRegistration } from "@/lib/text";

function specLine(v: Record<string, string | number | null>) {
  const bits = [
    [v.make, v.model].filter(Boolean).join(" ").trim() || "Make/model not on file",
    vehicleClassLabel(v.vehicle_class ? String(v.vehicle_class) : "") || null,
    v.colour ? String(v.colour) : null,
    v.fuel ? String(v.fuel) : null,
    v.transmission ? String(v.transmission) : null,
    v.seats ? `${v.seats} seats` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

const STATE_LABEL: Record<string, string> = {
  available: "available",
  reserved: "reserved",
  on_hire: "on hire",
  off_road: "off road / maintenance",
  removed: "removed",
};

function FleetTable({
  rows,
  empty,
  states,
}: {
  rows: Array<Record<string, string | number | null>>;
  empty: string;
  states: ReturnType<typeof fleetStatesToday>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Registration</th>
            <th>Details</th>
            <th>Status</th>
            <th>Location</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-sm text-slate">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((v) => (
              <tr key={String(v.id)}>
                <td className="ref">{v.registration ? formatVehicleRegistration(String(v.registration)) : "Not on V5C"}</td>
                <td>{specLine(v)}</td>
                <td>
                  {STATE_LABEL[states.get(String(v.id))?.state || ""] || String(v.status).replaceAll("_", " ")}
                  {states.get(String(v.id))?.checks ? <span className="text-overdue"> · record to check</span> : null}
                </td>
                <td>{String(v.location || "")}</td>
                <td>
                  <Link href={`/hire/${v.id}`} className="text-sm text-teal-dark underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; saved?: string; show?: string; status?: string }>;
}) {
  await requireStaff();
  const { q, error, saved, show, status } = await searchParams;
  const includeRemoved = show === "removed";
  const states = fleetStatesToday();
  const toCheck = listFleetRecordsToCheck();
  const toComplete = listFleetDetailsToComplete();
  const groupChoices = fleetGroupChoices();
  const wanted = status === "maintenance" ? "off_road" : status;
  const fleet = listFleet({ includeRemoved }).filter((v) => {
    if (wanted && states.get(String(v.id))?.state !== wanted) return false;
    return fleetSearchMatches(v.registration ? String(v.registration) : "", q || "");
  });
  const real = fleet.filter((v) => Number(v.is_real) === 1 && !v.removed_at);
  const test = fleet.filter((v) => Number(v.is_real) !== 1 && !v.removed_at);
  const removed = fleet.filter((v) => v.removed_at);
  const reservations = listReservations();
  const claims = listClaims();
  const bookable = fleet.filter((v) => !v.removed_at);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hire / Fleet"
        subtitle="CAS's real fleet is kept separate from the fictional TEST vehicles (CAS 1–10). Opening a file or reserving a vehicle does not start hire charges."
        actions={
          <Link href="/hire/new" className="rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white">
            Add vehicle
          </Link>
        }
      />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p>
      ) : null}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-card p-4" method="get">
        <label className="text-sm">
          Search registration
          <input
            name="q"
            defaultValue={q || ""}
            className="mt-1 w-72 max-w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
            placeholder="As issued, e.g. S1 EOH"
          />
        </label>
        {includeRemoved ? <input type="hidden" name="show" value="removed" /> : null}
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
          Search
        </button>
        {q ? (
          <Link href={includeRemoved ? "/hire?show=removed" : "/hire"} className="text-sm text-teal-dark underline">
            Clear
          </Link>
        ) : null}
      </form>

      {status ? (
        <p className="text-sm">
          Filtered: {status.replaceAll("_", " ")}.{" "}
          <Link href={q ? `/hire?q=${encodeURIComponent(q)}` : "/hire"} className="text-teal-dark underline">
            Clear filter
          </Link>
        </p>
      ) : null}

      {toCheck.length > 0 ? (
        <section id="records-to-check" className="scroll-mt-4 rounded-xl border border-overdue/40 bg-[#f8ecec] p-5" data-records-to-check>
          <h2 className="font-serif text-xl text-navy-deep">Fleet records to check</h2>
          <p className="mt-1 text-sm">The status and the bookings disagree. These cars are not offered until a person checks them.</p>
          <ul className="mt-3 space-y-3 text-sm">
            {toCheck.map((row) => (
              <li key={row.key} className="rounded-md border border-line bg-white p-3" data-record-check={row.registration}>
                <p>
                  <strong>{row.registration}</strong> · {row.text}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link href={`/hire/${row.fleetVehicleId}`} className="text-teal-dark underline">
                    Open the car
                  </Link>
                  {row.claimId ? (
                    <Link href={`/claims/${row.claimId}/hire`} className="text-teal-dark underline">
                      Open the file
                    </Link>
                  ) : null}
                  {row.confirmable ? (
                    <form method="post" action="/hire/records">
                      <input type="hidden" name="action" value="confirm" />
                      <input type="hidden" name="fleetVehicleId" value={row.fleetVehicleId} />
                      <input type="hidden" name="checkKey" value={row.key} />
                      <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold text-navy">
                        Still with the customer
                      </button>
                    </form>
                  ) : null}
                  {row.closeBookingId ? (
                    <form method="post" action="/hire/records">
                      <input type="hidden" name="action" value="close" />
                      <input type="hidden" name="reservationId" value={row.closeBookingId} />
                      <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold text-navy">
                        Close this booking
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {toComplete.length > 0 ? (
        <section id="details-to-complete" className="scroll-mt-4 rounded-xl border border-warn bg-[#fff6e8] p-5" data-details-to-complete={toComplete.length}>
          <h2 className="font-serif text-xl text-navy-deep">Fleet details to complete</h2>
          <p className="mt-1 text-sm">
            {toComplete.length} real fleet {toComplete.length === 1 ? "car is" : "cars are"} missing details that a hire needs. Fuel and colour already
            read from the V5C are used. Gearbox, seats and GTA group are never guessed: enter them from the car. What you save goes on the fleet record
            and is carried into every hire of that car.
          </p>
          <ul className="mt-3 space-y-3 text-sm">
            {toComplete.map((car) => (
              <li key={car.fleetVehicleId} className="rounded-md border border-line bg-white p-3" data-complete-car={car.registration}>
                <p>
                  <strong>{car.registration || "No registration"}</strong> · {[car.make, car.model].filter(Boolean).join(" ") || "Make and model not on the V5C"}
                  {fleetDetailLine(car) ? <span className="text-slate"> · {fleetDetailLine(car)}</span> : null}
                </p>
                <p className="text-overdue">Missing: {missingWords(car.missing)}</p>
                <form method="post" action="/hire/details" className="mt-2 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="fleetVehicleId" value={car.fleetVehicleId} />
                  <input type="hidden" name="fleetVersion" value={car.version} />
                  {car.missing.map((field) => (
                    <FleetDetailBox key={field} field={field} car={car} groups={groupChoices} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
                  ))}
                  <div className="flex items-end gap-3">
                    <button type="submit" className="rounded-md bg-navy px-3 py-2 font-semibold text-white">
                      Save
                    </button>
                    <Link href={`/hire/${car.fleetVehicleId}`} className="text-teal-dark underline">
                      Open the car
                    </Link>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border-2 border-teal bg-[#e8f4f2] p-5">
        <h2 className="font-serif text-xl text-navy-deep">Hire Packs</h2>
        <p className="mt-1 text-sm text-slate">
          The client hire pack (delivery, damage, mitigation, agreement and collection) is generated from the claim file, not from the fleet list.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Client</th>
                <th>Position</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td className="ref">{c.file_reference}</td>
                  <td>{c.client_name || "Unknown"}</td>
                  <td>{c.current_position}</td>
                  <td>
                    <Link href={`/claims/${c.id}/hire-pack`} className="inline-block rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white">
                      Hire Pack
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl text-navy-deep">Real CAS fleet</h2>
        <p className="text-sm text-slate">
          Production vehicles from V5Cs. A later reset of TEST data must not wipe these records.
        </p>
        <FleetTable rows={real} states={states} empty="No real fleet vehicles match that search." />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl text-navy-deep">TEST fleet (fictional)</h2>
        <p className="text-sm text-slate">Demonstration vehicles CAS 1–10. Not production stock.</p>
        <FleetTable rows={test} states={states} empty="No TEST fleet vehicles match that search." />
      </section>

      {includeRemoved ? (
        <section className="space-y-3">
          <h2 className="font-serif text-xl text-navy-deep">Removed vehicles</h2>
          <p className="text-sm text-slate">Soft-removed only. Booking history stays on the record.</p>
          <FleetTable rows={removed} states={states} empty="No removed vehicles." />
        </section>
      ) : (
        <p className="text-sm text-slate">
          <Link href={q ? `/hire?q=${encodeURIComponent(q)}&show=removed` : "/hire?show=removed"} className="text-teal-dark underline">
            Show removed vehicles
          </Link>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>File</th>
              <th>Kind</th>
              <th>Start</th>
              <th>End</th>
              <th>Charges started</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={String(r.id)}>
                <td className="ref">{r.registration ? formatVehicleRegistration(String(r.registration)) : "—"}</td>
                <td>{String(r.file_reference || "—")}</td>
                <td>{String(r.kind)}</td>
                <td>{formatUkDateTime(String(r.start_at))}</td>
                <td>{formatUkDateTime(String(r.end_at))}</td>
                <td>{Number(r.charges_started) ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReserveForm
        vehicles={bookable.map((v) => ({
          id: String(v.id),
          label: `${v.registration || "No registration"} — ${v.make || ""} ${v.model || ""} (${STATE_LABEL[states.get(String(v.id))?.state || ""] || v.status})`,
        }))}
        claims={claims.map((c) => ({ id: c.id, label: `${c.file_reference} ${c.client_name || ""}` }))}
        versions={Object.fromEntries(bookable.map((v) => [String(v.id), sectionVersion("fleet", String(v.id))]))}
      />
    </div>
  );
}

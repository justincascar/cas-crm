import Link from "next/link";
import { notFound } from "next/navigation";
import { actionRemoveFleetVehicle, actionUpdateFleetVehicle } from "@/app/fleet-actions";
import { PageHeader } from "@/components/ClaimTable";
import { FleetVehicleFields } from "@/components/FleetVehicleFields";
import { ValidatedForm } from "@/components/ValidatedForm";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDate, formatUkDateTime } from "@/lib/dates";
import { getFleetVehicle, listBlockingReservations, listFleetVehicleDocuments } from "@/lib/db/fleet";
import { vehicleClassLabel } from "@/lib/fleet/classes";
import { formatVehicleRegistration } from "@/lib/text";

export default async function FleetVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const vehicle = getFleetVehicle(id);
  if (!vehicle) notFound();
  const documents = listFleetVehicleDocuments(id);
  const blocking = vehicle.removed_at ? [] : listBlockingReservations(id);
  const missing = vehicle.v5c_missing_json ? (JSON.parse(String(vehicle.v5c_missing_json)) as string[]) : [];
  const registration = vehicle.registration ? formatVehicleRegistration(String(vehicle.registration)) : "No registration on V5C";
  const removed = Boolean(vehicle.removed_at);
  const warnRemove = Boolean(error && /active or future reservation/i.test(error));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={registration}
        subtitle={`${vehicleClassLabel(vehicle.vehicle_class ? String(vehicle.vehicle_class) : "") || "Vehicle"} · ${
          Number(vehicle.is_real) === 1 ? "Real CAS fleet" : "TEST fleet (fictional)"
        }${removed ? " · Removed (record kept)" : ""}`}
        actions={
          <Link href="/hire" className="text-sm text-teal-dark underline">
            Back to fleet
          </Link>
        }
      />
      {error ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p>
      ) : null}
      {missing.length > 0 ? (
        <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
          These V5C fields were not legible and were left blank (not guessed): {missing.join(", ")}.
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">V5C document</h2>
        {documents.length === 0 ? (
          <p className="mt-2 text-sm text-slate">No stored V5C PDF on this record yet. Attach one below when you save.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {documents.map((doc) => (
              <li key={doc.id}>
                <a className="text-teal-dark underline" href={`/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
                  View {doc.document_type || "file"}: {doc.original_filename || doc.title}
                </a>
                <span className="ml-2 text-slate">
                  ({doc.byte_size ? `${doc.byte_size} bytes` : "file"} · {formatUkDateTime(doc.created_at)})
                </span>
                <span className="ml-2">
                  <Link className="text-teal-dark underline" href={`/documents/${doc.id}`}>
                    Document record
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Vehicle details</h2>
        <p className="mt-1 text-sm text-slate">
          First registered {vehicle.first_registered_on ? formatUkDate(String(vehicle.first_registered_on)) : "not on file"}.
          Gearbox and seating are staff-editable and were not taken from the V5C.
        </p>
        <ValidatedForm action={actionUpdateFleetVehicle} encType="multipart/form-data" className="mt-4 space-y-4">
          <input type="hidden" name="fleetVehicleId" value={id} />
          <FleetVehicleFields values={vehicle} />
          <button type="submit" className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white">
            Save details
          </button>
        </ValidatedForm>
      </section>

      {!removed ? (
        <section className="rounded-xl border border-overdue/30 bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Remove from fleet</h2>
          <p className="mt-1 text-sm text-slate">
            This is a soft removal. The record and any booking history stay. The vehicle can no longer be reserved.
          </p>
          {blocking.length > 0 ? (
            <p className="mt-3 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
              There {blocking.length === 1 ? "is an active or future reservation" : "are active or future reservations"} on this
              vehicle
              {blocking[0]?.file_reference ? ` (including ${blocking.map((r) => r.file_reference).filter(Boolean).join(", ")})` : ""}.
              Removing it is blocked unless you confirm below.
            </p>
          ) : null}
          <ValidatedForm action={actionRemoveFleetVehicle} className="mt-4 space-y-3">
            <input type="hidden" name="fleetVehicleId" value={id} />
            <label className="block text-sm">
              Reason (optional)
              <input name="removedReason" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
            </label>
            {blocking.length > 0 || warnRemove ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirmDespiteReservations" value="1" className="mt-1" />
                <span>I understand bookings stay on this record. Remove the vehicle from the fleet anyway.</span>
              </label>
            ) : null}
            <button type="submit" className="rounded-md border border-overdue px-4 py-2 text-sm font-semibold text-overdue">
              Remove vehicle
            </button>
          </ValidatedForm>
        </section>
      ) : (
        <p className="text-sm text-slate">
          Removed on {formatUkDateTime(String(vehicle.removed_at))}
          {vehicle.removed_reason ? ` — ${vehicle.removed_reason}` : ""}.
        </p>
      )}
    </div>
  );
}

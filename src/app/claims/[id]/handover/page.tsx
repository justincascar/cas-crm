import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { actionAddHandoverPhotos, actionAttachHandoverScan, actionRecordHandover } from "@/app/handover-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { formatUkDateTime } from "@/lib/dates";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import {
  DAMAGE_SHOT,
  FUEL_LEVELS,
  HANDOVER_EVENTS,
  listHireBookings,
  listVehicleHandovers,
  missingStandardShots,
  SCAN_SLOTS,
  STANDARD_SHOTS,
  type HandoverPhoto,
  type HandoverScan,
} from "@/lib/db/handover";
import { listMyJobs } from "@/lib/db/jobs";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const scanAccept = "application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/csv,text/html,text/xml,application/json,.pdf,.txt,.csv,.xml,.html,.json,.log";
const photoAccept = "image/jpeg,image/png,image/webp,image/gif";

/** The input itself is the button. A surrounding label would open the file chooser instead of the camera. */
function openCamera(name: string, label: string) {
  return (
    <div className="relative">
      <input
        name={name}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={label}
        className="block w-full text-[0px] file:min-h-11 file:w-full file:cursor-pointer file:rounded-md file:border-0 file:bg-navy file:px-3 file:py-3 file:text-base file:font-semibold file:text-transparent"
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base font-semibold text-white">{label}</span>
    </div>
  );
}

function chooseSaved(name: string, label: string, accept: string, multiple = false) {
  return (
    <label className="block text-sm text-slate">
      {label}
      <input name={name} type="file" accept={accept} multiple={multiple || undefined} className={field} />
    </label>
  );
}

function cameraOrFile(input: { cameraName: string; fileName: string; cameraLabel: string; fileLabel: string; accept: string }) {
  return (
    <div className="grid gap-3">
      {openCamera(input.cameraName, input.cameraLabel)}
      {chooseSaved(input.fileName, input.fileLabel, input.accept)}
    </div>
  );
}

function latestShot(photos: HandoverPhoto[], slot: string) {
  return [...photos].reverse().find((photo) => photo.slot === slot) || null;
}

function guidedShots(photos: HandoverPhoto[]) {
  const damage = photos.filter((photo) => photo.slot === DAMAGE_SHOT);
  return (
    <div className="space-y-4">
      {STANDARD_SHOTS.map((shot) => {
        const taken = latestShot(photos, shot.slot);
        return (
          <div key={shot.slot} className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{shot.label}</p>
              <p className={taken ? "text-sm font-medium text-ok" : "text-sm text-slate"}>{taken ? "Taken" : "Not taken yet"}</p>
            </div>
            {taken ? (
              <a href={`/documents/${taken.documentId}`}>
                <img src={`/documents/${taken.documentId}/file`} alt={shot.label} className="h-24 w-32 rounded-md border border-line object-cover" />
              </a>
            ) : (
              <div className="grid gap-3">
                {openCamera(`${shot.slot}Camera`, "Open camera")}
                {chooseSaved(`${shot.slot}File`, "Or choose a saved photo", photoAccept)}
              </div>
            )}
          </div>
        );
      })}
      <div className="rounded-md border border-line p-3">
        <p className="text-sm font-medium">Damage photos</p>
        <p className="mt-1 text-sm text-slate">Optional. Close-ups of any damage. Add as many as you need.</p>
        {damage.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-3">
            {damage.map((photo) => (
              <li key={photo.id}>
                <a href={`/documents/${photo.documentId}`}>
                  <img src={`/documents/${photo.documentId}/file`} alt="Damage" className="h-24 w-32 rounded-md border border-line object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 grid gap-3">
          {openCamera("damageCamera", "Open camera")}
          {chooseSaved("damageFiles", "Or choose saved photos", photoAccept, true)}
        </div>
      </div>
    </div>
  );
}

function scanFor(scans: HandoverScan[], slot: "pre" | "post") {
  return scans.find((scan) => scan.slot === slot) || null;
}

export default async function HandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staffUser = await requireSignedIn();
  const office = isOfficeRole(staffUser.role);
  const { id } = await params;
  const { error, saved } = await searchParams;
  const claim = getClaim(id);
  if (!claim) notFound();
  const assignedEpisodes = office
    ? null
    : new Set(
        listMyJobs(staffUser.id)
          .filter((job) => job.jobKind === "handover" && job.claimId === id && job.hireEpisodeId)
          .map((job) => job.hireEpisodeId as string),
      );
  if (assignedEpisodes && assignedEpisodes.size === 0) redirect("/jobs");
  const bookings = listHireBookings(id).filter((booking) => !assignedEpisodes || assignedEpisodes.has(booking.id));
  const records = listVehicleHandovers(id).filter((record) => !assignedEpisodes || (record.hireEpisodeId && assignedEpisodes.has(record.hireEpisodeId)));
  const events = assignedEpisodes ? HANDOVER_EVENTS.filter((event) => event.needsBooking) : HANDOVER_EVENTS;
  const fileRef = String(claim.claim.file_reference || "");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Handover — ${fileRef}`}
        subtitle="Condition of the hire vehicle or the client's own vehicle at delivery, collection, recovery or return. A saved record is locked. To correct it, record a new handover and explain the correction in the note."
        actions={
          office ? (
            <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
              Back to file
            </Link>
          ) : null
        }
      />

      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Handover saved.</p> : null}

      <ValidatedForm action={actionRecordHandover} encType="multipart/form-data" className="space-y-4 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Record a handover</h2>
        <input type="hidden" name="claimId" value={id} />
        <label className="block text-sm">
          Which handover
          <select name="eventKind" className={field} required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            {events.map((event) => (
              <option key={event.kind} value={event.kind}>
                {event.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Hire booking
          <select name="hireEpisodeId" className={field} defaultValue={bookings[0]?.id || ""}>
            {office ? <option value="">Not a hire vehicle</option> : null}
            {bookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {[booking.make, booking.model, booking.registration].filter(Boolean).join(" ") || "Hire vehicle"}
                {booking.started_at ? ` · out ${formatUkDateTime(booking.started_at)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate">
          {office
            ? "Choose the hire booking when the vehicle is the one CAS supplied. Leave it as “Not a hire vehicle” for the client's own car. Each handover stands on its own if the car is swapped."
            : "This is the vehicle assigned to you today."}
        </p>
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
              {FUEL_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Damage and condition
          <textarea name="conditionNote" rows={3} className={field} placeholder="What you can see. If this corrects an earlier record, say what was wrong." />
        </label>
        <div>
          <p className="text-sm font-medium">Condition photographs</p>
          <p className="mt-1 text-sm text-slate">Open camera starts the phone camera for that shot. If it does not, choose a photo already saved. The record stays incomplete until Front, Rear, Driver&apos;s side, Passenger&apos;s side and Interior are all taken. Damage photos are optional. You can add any that are missing after you save.</p>
          <div className="mt-3">{guidedShots([])}</div>
        </div>
        {office ? (
          <>
            <div className="grid gap-4">
              <div>
                <p className="text-sm font-medium">Pre-diagnostic scan</p>
                {cameraOrFile({
                  cameraName: "preScanCamera",
                  fileName: "preScan",
                  cameraLabel: "Photograph the scan",
                  fileLabel: "Or choose a saved scan file",
                  accept: scanAccept,
                })}
              </div>
              <div>
                <p className="text-sm font-medium">Post-diagnostic scan</p>
                {cameraOrFile({
                  cameraName: "postScanCamera",
                  fileName: "postScan",
                  cameraLabel: "Photograph the scan",
                  fileLabel: "Or choose a saved scan file",
                  accept: scanAccept,
                })}
              </div>
            </div>
            <p className="text-sm text-slate">Optional. Photograph the tool’s screen, or choose a PDF, image or text file already saved. Use one of those for each scan, not both. A missing scan does not mark the record incomplete.</p>
          </>
        ) : null}
        <button className="min-h-11 w-full rounded-md bg-navy px-4 py-3 text-base text-white sm:w-auto" type="submit">
          Save handover record
        </button>
      </ValidatedForm>

      <section className="space-y-4">
        <h2 className="font-serif text-xl text-navy-deep">Saved handovers</h2>
        {records.length === 0 ? <p className="text-sm text-slate">None recorded on this file yet.</p> : null}
        {records.map((record) => (
          <article key={record.id} className="rounded-xl border border-line bg-card p-5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-serif text-lg text-navy-deep">{record.eventLabel}</h3>
                <p className="text-slate">
                  {record.bookingLabel} · {formatUkDateTime(record.occurredAt)} · {record.recordedByName}
                </p>
              </div>
              {record.incomplete ? (
                <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2">
                  Incomplete — still needed: {missingStandardShots(record.photos.map((photo) => photo.slot)).map((shot) => shot.label).join(", ")}.
                </p>
              ) : (
                <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-3 py-2">Five standard photographs are on this record.</p>
              )}
            </div>
            <p className="mt-3">
              Mileage {record.mileage.toLocaleString("en-GB")} · Fuel {record.fuelLabel}
            </p>
            {record.conditionNote ? <p className="mt-2">{record.conditionNote}</p> : null}
            <ValidatedForm action={actionAddHandoverPhotos} encType="multipart/form-data" className="mt-4 space-y-3">
              <input type="hidden" name="claimId" value={id} />
              <input type="hidden" name="handoverId" value={record.id} />
              <p className="text-sm font-medium">Photographs</p>
              {guidedShots(record.photos)}
              <button className="min-h-11 w-full rounded-md border border-navy px-3 py-3 text-base text-navy sm:w-auto" type="submit">
                Attach
              </button>
            </ValidatedForm>
            <p className="mt-2 text-xs text-slate">This does not change the mileage or fuel already saved.</p>
            {office ? <div className="mt-4 space-y-3 border-t border-line pt-4">
              <h4 className="font-medium">Diagnostic scans</h4>
              {SCAN_SLOTS.map((slot) => {
                const scan = scanFor(record.scans, slot.slot);
                return (
                  <div key={slot.slot}>
                    {scan ? (
                      <p>
                        {slot.label}:{" "}
                        <a className="text-teal-dark underline" href={`/documents/${scan.documentId}`}>
                          {scan.filename}
                        </a>
                        <span className="text-slate"> · {formatUkDateTime(scan.attachedAt)}</span>
                      </p>
                    ) : (
                      <ValidatedForm action={actionAttachHandoverScan} encType="multipart/form-data" className="space-y-3">
                        <input type="hidden" name="claimId" value={id} />
                        <input type="hidden" name="handoverId" value={record.id} />
                        <input type="hidden" name="slot" value={slot.slot} />
                        <p className="text-sm font-medium">{slot.label}</p>
                        {cameraOrFile({
                          cameraName: "scanCamera",
                          fileName: "scan",
                          cameraLabel: "Photograph the scan",
                          fileLabel: "Or choose a saved scan file",
                          accept: scanAccept,
                        })}
                        <button className="min-h-11 w-full rounded-md border border-navy px-3 py-3 text-base text-navy sm:w-auto" type="submit">
                          Attach
                        </button>
                      </ValidatedForm>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-slate">Optional. Attaching a scan does not change the mileage, fuel or the incomplete flag.</p>
            </div> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

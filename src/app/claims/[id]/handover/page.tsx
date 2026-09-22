import Link from "next/link";
import { notFound } from "next/navigation";
import { actionAddHandoverPhotos, actionAttachHandoverScan, actionRecordHandover } from "@/app/handover-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { formatUkDateTime } from "@/lib/dates";
import { requireStaff } from "@/lib/auth/session";
import {
  FUEL_LEVELS,
  HANDOVER_CHECKS,
  HANDOVER_EVENTS,
  listHireBookings,
  listVehicleHandovers,
  SCAN_SLOTS,
  type HandoverScan,
} from "@/lib/db/handover";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const scanAccept = "application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/csv,text/html,text/xml,application/json,.pdf,.txt,.csv,.xml,.html,.json,.log";
const photoAccept = "image/jpeg,image/png,image/webp,image/gif";

function cameraOrFile(input: {
  cameraName: string;
  fileName: string;
  cameraLabel: string;
  fileLabel: string;
  accept: string;
  multiple?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <label className="block text-sm">
        {input.cameraLabel}
        <input name={input.cameraName} type="file" accept="image/*" capture="environment" className={field} />
      </label>
      <label className="block text-sm">
        {input.fileLabel}
        <input name={input.fileName} type="file" accept={input.accept} multiple={input.multiple} className={field} />
      </label>
    </div>
  );
}

function scanFor(scans: HandoverScan[], slot: "pre" | "post") {
  return scans.find((scan) => scan.slot === slot) || null;
}

function yesNo(name: string, label: string) {
  return (
    <fieldset className="text-sm">
      <legend>{label}</legend>
      <div className="mt-1 flex gap-4">
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input name={name} type="radio" value="yes" required className="h-5 w-5" /> Yes
        </label>
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input name={name} type="radio" value="no" required className="h-5 w-5" /> No
        </label>
      </div>
    </fieldset>
  );
}

export default async function HandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const claim = getClaim(id);
  if (!claim) notFound();
  const bookings = listHireBookings(id);
  const records = listVehicleHandovers(id);
  const fileRef = String(claim.claim.file_reference || "");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Handover — ${fileRef}`}
        subtitle="Condition of the hire vehicle or the client's own vehicle at delivery, collection, recovery or return. A saved record is locked. To correct it, record a new handover and explain the correction in the note."
        actions={
          <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
            Back to file
          </Link>
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
            {HANDOVER_EVENTS.map((event) => (
              <option key={event.kind} value={event.kind}>
                {event.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Hire booking
          <select name="hireEpisodeId" className={field} defaultValue={bookings[0]?.id || ""}>
            <option value="">Not a hire vehicle</option>
            {bookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {[booking.make, booking.model, booking.registration].filter(Boolean).join(" ") || "Hire vehicle"}
                {booking.started_at ? ` · out ${formatUkDateTime(booking.started_at)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate">Choose the hire booking when the vehicle is the one CAS supplied. Leave it as “Not a hire vehicle” for the client&apos;s own car. Each handover stands on its own if the car is swapped.</p>
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
        <div className="grid gap-3 sm:grid-cols-2">
          {HANDOVER_CHECKS.map((check) => (
            <div key={check.key}>{yesNo(check.key === "tyres_legal" ? "tyresLegal" : check.key === "spare_wheel" ? "spareWheel" : check.key === "tools_present" ? "toolsPresent" : "warningLightsOff", check.label)}</div>
          ))}
        </div>
        <label className="block text-sm">
          Damage and condition
          <textarea name="conditionNote" rows={3} className={field} placeholder="What you can see. If this corrects an earlier record, say what was wrong." />
        </label>
        <div>
          <p className="text-sm font-medium">Condition photographs</p>
          {cameraOrFile({
            cameraName: "photos",
            fileName: "photos",
            cameraLabel: "Take a photograph",
            fileLabel: "Or choose photographs already on the phone",
            accept: photoAccept,
            multiple: true,
          })}
        </div>
        <p className="text-sm text-slate">Take a photograph opens the phone camera. You can still choose a picture already saved. Photographs can be added after you save, for example if the signal drops on site. Until then the record is marked incomplete. Mileage and fuel are still kept.</p>
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
                <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2">Incomplete — no condition photographs yet.</p>
              ) : (
                <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-3 py-2">{record.photos.length} photograph{record.photos.length === 1 ? "" : "s"}</p>
              )}
            </div>
            <p className="mt-3">
              Mileage {record.mileage.toLocaleString("en-GB")} · Fuel {record.fuelLabel}
            </p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              <li>Spare wheel present: {record.spareWheel === "yes" ? "Yes" : "No"}</li>
              <li>Tools present: {record.toolsPresent === "yes" ? "Yes" : "No"}</li>
              <li>Warning lights off: {record.warningLightsOff === "yes" ? "Yes" : "No"}</li>
              <li>Tyres visibly legal: {record.tyresLegal === "yes" ? "Yes" : "No"}</li>
            </ul>
            {record.conditionNote ? <p className="mt-2">{record.conditionNote}</p> : null}
            {record.photos.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-3">
                {record.photos.map((photo) => (
                  <li key={photo.id}>
                    <a href={`/documents/${photo.documentId}`}>
                      <img src={`/documents/${photo.documentId}/file`} alt={photo.title} className="h-24 w-32 rounded-md border border-line object-cover" />
                    </a>
                    <p className="mt-1 text-xs text-slate">{formatUkDateTime(photo.takenAt)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <ValidatedForm action={actionAddHandoverPhotos} encType="multipart/form-data" className="mt-4 space-y-3">
              <input type="hidden" name="claimId" value={id} />
              <input type="hidden" name="handoverId" value={record.id} />
              <p className="text-sm font-medium">Add photographs</p>
              {cameraOrFile({
                cameraName: "photos",
                fileName: "photos",
                cameraLabel: "Take a photograph",
                fileLabel: "Or choose photographs already on the phone",
                accept: photoAccept,
                multiple: true,
              })}
              <button className="min-h-11 w-full rounded-md border border-navy px-3 py-3 text-base text-navy sm:w-auto" type="submit">
                Attach
              </button>
            </ValidatedForm>
            <p className="mt-2 text-xs text-slate">This does not change the mileage, fuel or checklist already saved.</p>
            <div className="mt-4 space-y-3 border-t border-line pt-4">
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
              <p className="text-xs text-slate">Optional. Attaching a scan does not change the mileage, fuel, checklist or the incomplete flag.</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

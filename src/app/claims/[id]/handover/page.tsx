import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { actionAttachHandoverScan } from "@/app/handover-actions";
import { PageHeader } from "@/components/ClaimTable";
import { HandoverStartForm } from "@/components/handover/HandoverStartForm";
import { ShotCamera } from "@/components/handover/ShotCamera";
import { ValidatedForm } from "@/components/ValidatedForm";
import { formatUkDateTime, londonDateTimeLocal, toLondonDateTimeLocal } from "@/lib/dates";
import { canDoFieldJob, isOfficeRole, roleLabel } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import {
  DAMAGE_SHOT,
  HANDOVER_EVENTS,
  listHireBookings,
  listVehicleHandovers,
  MAX_DAMAGE_PHOTOS,
  missingStandardShots,
  SCAN_SLOTS,
  shotsForSet,
  type HandoverPhoto,
  type HandoverScan,
} from "@/lib/db/handover";
import { getDayAssignment, handoverSuggestion, isHandoverAssignment, listAssignablePeople, listMyJobs } from "@/lib/db/jobs";
import { getClaim } from "@/lib/db/queries";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const scanAccept = "application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/csv,text/html,text/xml,application/json,.pdf,.txt,.csv,.xml,.html,.json,.log";

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

function guidedShots(claimId: string, handoverId: string, photos: HandoverPhoto[], shotSet: string) {
  const post = `/claims/${claimId}/handover/photo`;
  const damage = photos.filter((photo) => photo.slot === DAMAGE_SHOT);
  const required = shotsForSet(shotSet);
  const firstMissing = missingStandardShots(photos.map((photo) => photo.slot), shotSet)[0]?.slot;
  const savedWord = required.length === 7 ? "seven" : "five";
  return (
    <div className="space-y-4">
      {required.map((shot) => {
        const taken = latestShot(photos, shot.slot);
        return (
          <div key={shot.slot} id={`shot-${shot.slot}`} className="scroll-mt-4 rounded-md border border-line p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{shot.label}</p>
              <p className={taken ? "text-sm font-medium text-ok" : "text-sm text-slate"}>{taken ? "Taken" : "Not taken yet"}</p>
            </div>
            {taken ? (
              <a href={`/documents/${taken.documentId}`}>
                <img src={`/documents/${taken.documentId}/file`} alt={shot.label} className="h-24 w-32 rounded-md border border-line object-cover" />
              </a>
            ) : (
              <>
                {firstMissing === shot.slot ? <p className="mb-2 text-sm text-teal-dark">Take this photograph next.</p> : null}
                <ShotCamera action={post} claimId={claimId} handoverId={handoverId} slot={shot.slot} cameraLabel="Open camera" />
              </>
            )}
          </div>
        );
      })}
      <div id="shot-damage" className="scroll-mt-4 rounded-md border border-line p-3">
        <p className="text-sm font-medium">Damage photos</p>
        <p className="mt-1 text-sm text-slate">
          Optional. Close-ups of any damage. Up to {MAX_DAMAGE_PHOTOS}. {damage.length} of {MAX_DAMAGE_PHOTOS} saved.
        </p>
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
        {damage.length < MAX_DAMAGE_PHOTOS ? (
          <div className="mt-3">
            <ShotCamera action={post} claimId={claimId} handoverId={handoverId} slot={DAMAGE_SHOT} cameraLabel="Add another damage photo" />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate">Six damage photographs are saved.</p>
        )}
      </div>
      {firstMissing ? null : (
        <div id="shot-finish" className="scroll-mt-4 rounded-md border border-ok/40 bg-[#eef6ee] p-3">
          <p className="text-sm">The {savedWord} photographs are saved. Damage photographs are optional.</p>
          <form method="post" action={`/claims/${claimId}/handover/finish`} className="mt-3">
            <input type="hidden" name="claimId" value={claimId} />
            <input type="hidden" name="handoverId" value={handoverId} />
            <button className="min-h-11 w-full rounded-md bg-navy px-4 py-3 text-base font-semibold text-white sm:w-auto" type="submit">
              Finish handover
            </button>
          </form>
        </div>
      )}
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
  searchParams: Promise<{ error?: string; saved?: string; job?: string }>;
}) {
  const staffUser = await requireSignedIn();
  const office = isOfficeRole(staffUser.role);
  const { id } = await params;
  const { error, saved, job: jobId } = await searchParams;
  const claim = getClaim(id);
  if (!claim) notFound();
  const todayJobs = office
    ? []
    : listMyJobs(staffUser.id).filter((job) => job.claimId === id && isHandoverAssignment(job.jobKind));
  if (!office && todayJobs.length === 0) redirect("/jobs");
  const assignedEpisodes = office
    ? null
    : new Set(todayJobs.map((job) => job.hireEpisodeId).filter((episodeId): episodeId is string => Boolean(episodeId)));
  const requested = jobId ? getDayAssignment(jobId) : undefined;
  const focus = office
    ? requested && requested.claimId === id
      ? requested
      : undefined
    : todayJobs.find((job) => job.id === jobId) || todayJobs[0];
  const suggestion = focus ? handoverSuggestion(focus.jobKind) : null;
  const drivers = listAssignablePeople()
    .filter((person) => canDoFieldJob(person.role))
    .map((person) => ({ id: person.id, label: `${person.name} · ${roleLabel(person.role)}` }));
  const fromCompletedJob = Boolean(focus?.completed && focus.actualOccurredAt && focus.actualDriverId);
  const defaultDriverId = fromCompletedJob ? focus?.actualDriverId || "" : staffUser.role === "driver" ? staffUser.id : "";
  const defaultWhen = fromCompletedJob && focus?.actualOccurredAt
    ? toLondonDateTimeLocal(focus.actualOccurredAt)
    : staffUser.role === "driver"
      ? londonDateTimeLocal()
      : "";
  const bookings = listHireBookings(id).filter((booking) => !assignedEpisodes || assignedEpisodes.has(booking.id));
  const records = listVehicleHandovers(id).filter(
    (record) => !assignedEpisodes || !record.hireEpisodeId || assignedEpisodes.has(record.hireEpisodeId),
  );
  const fileRef = String(claim.claim.file_reference || "");
  const customerVehicle =
    [claim.claim.make, claim.claim.model, claim.claim.registration].filter(Boolean).join(" ") || "Not recorded on the file";
  const savedText =
    saved === "photo" ? "Photograph saved." : saved === "details" ? "Details saved. Take the photographs below." : saved ? "Handover saved." : "";

  return (
    <div className="max-w-4xl space-y-6">
      <script
        dangerouslySetInnerHTML={{
          __html: `(function () {
            if (window.__casHandoverPhoto) return;
            window.__casHandoverPhoto = true;
            document.addEventListener("change", function (event) {
              var input = event.target;
              if (!input || input.name !== "photo" || !input.form) return;
              var action = input.form.getAttribute("action") || "";
              if (action.indexOf("/handover/photo") === -1) return;
              var file = input.files && input.files[0];
              if (!file || file.size < 1) return;
              window.setTimeout(function () { input.form.submit(); }, 0);
            }, true);
          })();`,
        }}
      />
      <PageHeader
        title={`Handover — ${fileRef}`}
        subtitle="Condition of the hire car, or of the customer's own vehicle, when it is handed over or collected. A saved record is locked. To correct it, record a new handover and explain the correction in the note."
        actions={
          office ? (
            <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
              Back to file
            </Link>
          ) : null
        }
      />

      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {savedText ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">{savedText}</p> : null}

      <HandoverStartForm
        action={`/claims/${id}/handover/start`}
        claimId={id}
        office={office}
        customerVehicle={customerVehicle}
        occasions={HANDOVER_EVENTS.map((event) => ({ kind: event.kind, label: event.label, needsBooking: event.needsBooking }))}
        bookings={bookings.map((booking) => ({
          id: booking.id,
          label: [booking.make, booking.model, booking.registration].filter(Boolean).join(" ") || "Hire car",
        }))}
        initialVehicle={suggestion?.vehicle}
        initialEventKind={suggestion?.eventKind}
        drivers={drivers}
        defaultDriverId={defaultDriverId}
        defaultWhen={defaultWhen}
      />

      <section className="space-y-4">
        <h2 className="font-serif text-xl text-navy-deep">Saved handovers</h2>
        {records.length === 0 ? <p className="text-sm text-slate">None recorded on this file yet.</p> : null}
        {records.map((record) => (
          <article key={record.id} className="rounded-xl border border-line bg-card p-5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-serif text-lg text-navy-deep">{record.eventLabel}</h3>
                <p className="text-slate">{record.bookingLabel}</p>
                <p className="text-slate">
                  Driver {record.actualDriverName} · {formatUkDateTime(record.occurredAt)}
                </p>
                <p className="text-slate">
                  Entered by {record.recordedByName} · {formatUkDateTime(record.createdAt)}
                </p>
              </div>
              {record.finishedAt ? (
                <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-3 py-2">Handover finished.</p>
              ) : record.incomplete ? (
                <p className="rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2">
                  Incomplete — still needed: {missingStandardShots(record.photos.map((photo) => photo.slot), record.shotSet).map((shot) => shot.label).join(", ")}.
                </p>
              ) : (
                <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-3 py-2">
                  {shotsForSet(record.shotSet).length === 7 ? "Seven" : "Five"} standard photographs are on this record.
                </p>
              )}
            </div>
            <p className="mt-3">
              Mileage {record.mileage.toLocaleString("en-GB")} · Fuel {record.fuelLabel}
            </p>
            {record.conditionNote ? <p className="mt-2">{record.conditionNote}</p> : null}
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">Photographs</p>
              {guidedShots(id, record.id, record.photos, record.shotSet)}
              <p className="text-xs text-slate">Taking a photograph stores it at once. It does not change the mileage or fuel already saved.</p>
            </div>
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

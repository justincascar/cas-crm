import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { actionAddRepairEvidence } from "@/app/job-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { formatUkDateTime } from "@/lib/dates";
import { REPAIR_KINDS, assertCanUploadRepair, listRepairEvidence, repairVehicleLabel } from "@/lib/db/jobs";

const field = "mt-1 w-full max-w-full rounded-md border border-line bg-white px-3 py-3 text-base";
const photoAccept = "image/jpeg,image/png,image/webp,image/gif";
const fileAccept = "application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,.pdf,.txt,.csv,.jpg,.jpeg,.png";

export default async function RepairEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const staff = await requireSignedIn();
  const { id } = await params;
  const { error, saved } = await searchParams;
  try {
    assertCanUploadRepair(staff, id);
  } catch {
    redirect("/jobs");
  }
  const vehicle = repairVehicleLabel(id);
  if (!vehicle) notFound();
  const files = listRepairEvidence(id);
  const office = isOfficeRole(staff.role);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`Repair evidence — ${vehicle.fileReference}`}
        subtitle={vehicle.vehicleLabel}
        actions={
          office ? (
            <Link href={`/claims/${id}`} className="text-sm text-teal-dark underline">
              Back to file
            </Link>
          ) : (
            <Link href="/jobs" className="text-sm text-teal-dark underline">
              My jobs today
            </Link>
          )
        }
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">File saved.</p> : null}
      <ValidatedForm action={actionAddRepairEvidence} encType="multipart/form-data" className="space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="font-serif text-xl text-navy-deep">Add a file</h2>
        <input type="hidden" name="claimId" value={id} />
        <label className="block text-sm">
          What is this?
          <select name="kind" className={field} required defaultValue="progress_photo">
            {REPAIR_KINDS.map((kind) => (
              <option key={kind.kind} value={kind.kind}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Take a photograph
          <input name="camera" type="file" accept="image/*" capture="environment" className={field} />
        </label>
        <label className="block text-sm">
          Or choose a saved file
          <input name="file" type="file" accept={`${photoAccept},${fileAccept}`} className={field} />
        </label>
        <label className="block text-sm">
          Note
          <input name="note" className={field} />
        </label>
        <p className="text-sm text-slate">Photographs, a pre-scan or post-scan, or a geometry / wheel-alignment report. Use one of the file choices, not both.</p>
        <button className="min-h-11 w-full rounded-md bg-navy px-4 py-3 text-base text-white sm:w-auto" type="submit">
          Save file
        </button>
      </ValidatedForm>
      <section className="space-y-3">
        <h2 className="font-serif text-xl text-navy-deep">Saved files</h2>
        {files.length === 0 ? <p className="text-sm text-slate">None yet.</p> : null}
        {files.map((file) => (
          <article key={file.id} className="rounded-xl border border-line bg-card p-4 text-sm">
            <p className="font-medium">{file.kindLabel}</p>
            <p className="mt-1">
              <a className="text-teal-dark underline" href={`/documents/${file.documentId}`}>
                {file.filename}
              </a>
            </p>
            <p className="mt-1 text-slate">
              {formatUkDateTime(file.createdAt)} · {file.recordedByName}
            </p>
            {file.note ? <p className="mt-2">{file.note}</p> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

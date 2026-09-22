import Link from "next/link";
import { PageHeader } from "@/components/ClaimTable";
import { AssignJobForm } from "@/components/jobs/AssignJobForm";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { formatUkDate, formatUkDateTime, londonTodayIso } from "@/lib/dates";
import { listAssignableBookings, listAssignableClaims, listAssignablePeople, listMyJobs } from "@/lib/db/jobs";

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; finished?: string; review?: string; reviewEnd?: string }>;
}) {
  const staff = await requireSignedIn();
  const { error, saved, finished, review, reviewEnd } = await searchParams;
  const jobs = listMyJobs(staff.id);
  const office = isOfficeRole(staff.role);
  const people = office ? listAssignablePeople() : [];
  const bookings = office ? listAssignableBookings() : [];
  const claims = office ? listAssignableClaims() : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My jobs today"
        subtitle={`${formatUkDate(londonTodayIso())}. Only jobs assigned to you for this day are listed.${office ? " This is a shortcut. Your usual screens are unchanged." : ""}`}
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {finished ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Handover finished.</p> : null}
      {review ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">
          The recovery date already on the file is different from this job. It has not been changed. Open the file and choose which day storage should be charged from.
        </p>
      ) : null}
      {reviewEnd ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">
          The storage end date already on the file is different from this return. It has not been changed. Open the file and choose which day storage should stop.
        </p>
      ) : null}
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-6 text-base">Nothing assigned today.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-xl border border-line bg-card p-4">
              <p className="font-mono text-sm text-teal-dark">{job.fileReference}</p>
              <p className="mt-1 text-base">{job.vehicleLabel}</p>
              <p className="text-sm text-slate">
                {job.jobLabel} · {job.completed ? "Done" : "Not done"}
              </p>
              <p className="text-sm text-slate">Assigned for {formatUkDate(job.workDate)}.</p>
              {job.actualOccurredAt ? (
                <p className="text-sm text-slate">Happened {formatUkDateTime(job.actualOccurredAt)}.</p>
              ) : null}
              <Link href={job.href} className="mt-3 block min-h-11 rounded-md bg-navy px-3 py-2 text-center text-base font-semibold text-white">
                {job.jobKind === "repair" ? "Open repair" : "Open handover"}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {office ? (
        <AssignJobForm
          action="/jobs/assign"
          saved={saved === "1"}
          today={londonTodayIso()}
          people={people.map((person) => ({ id: String(person.id), name: String(person.name), role: String(person.role) }))}
          bookings={bookings.map((booking) => ({
            episode_id: String(booking.episode_id),
            file_reference: booking.file_reference ? String(booking.file_reference) : null,
            make: booking.make ? String(booking.make) : null,
            model: booking.model ? String(booking.model) : null,
            registration: booking.registration ? String(booking.registration) : null,
          }))}
          claims={claims.map((claim) => ({
            id: String(claim.id),
            file_reference: claim.file_reference ? String(claim.file_reference) : null,
            registration: claim.registration ? String(claim.registration) : null,
          }))}
        />
      ) : null}
    </div>
  );
}

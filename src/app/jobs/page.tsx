import Link from "next/link";
import { actionAssignDayJob } from "@/app/job-actions";
import { PageHeader } from "@/components/ClaimTable";
import { ValidatedForm } from "@/components/ValidatedForm";
import { isOfficeRole, roleLabel } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { formatUkDate } from "@/lib/dates";
import { londonTodayIso } from "@/lib/dates";
import { listAssignableBookings, listAssignableClaims, listAssignablePeople, listMyJobs } from "@/lib/db/jobs";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; finished?: string }>;
}) {
  const staff = await requireSignedIn();
  const { error, saved, finished } = await searchParams;
  const jobs = listMyJobs(staff.id);
  const office = isOfficeRole(staff.role);
  const people = office ? listAssignablePeople() : [];
  const bookings = office ? listAssignableBookings() : [];
  const claims = office ? listAssignableClaims() : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My jobs today"
        subtitle={`${formatUkDate(londonTodayIso())}. ${office ? "This is a shortcut. Your usual screens are unchanged." : "Only the jobs assigned to you today are listed."}`}
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {finished ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Handover finished.</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm">Job assigned.</p> : null}
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-6 text-base">Nothing assigned today.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-xl border border-line bg-card p-4">
              <p className="font-mono text-sm text-teal-dark">{job.fileReference}</p>
              <p className="mt-1 text-base">{job.vehicleLabel}</p>
              <p className="text-sm text-slate">{job.jobKind === "repair" ? "Repair evidence" : "Vehicle handover"}</p>
              <Link href={job.href} className="mt-3 block min-h-11 rounded-md bg-navy px-3 py-2 text-center text-base font-semibold text-white">
                {job.jobKind === "repair" ? "Open repair" : "Open handover"}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {office ? (
        <ValidatedForm action={actionAssignDayJob} className="space-y-3 rounded-xl border border-line bg-card p-5">
          <h2 className="font-serif text-xl text-navy-deep">Assign a job for today</h2>
          <p className="text-sm text-slate">The person sees it on My jobs today. A driver can only complete the handover. A mechanic can only add repair evidence.</p>
          <label className="block text-sm">
            Person
            <select name="assigneeId" className={field} required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {roleLabel(person.role)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Job
            <select name="jobKind" className={field} required defaultValue="handover">
              <option value="handover">Handover on a hire booking</option>
              <option value="repair">Repair evidence</option>
            </select>
          </label>
          <label className="block text-sm">
            Hire booking
            <select name="hireEpisodeId" className={field} defaultValue="">
              <option value="">Not a handover</option>
              {bookings.map((booking) => (
                <option key={booking.episode_id} value={booking.episode_id}>
                  {booking.file_reference} · {[booking.make, booking.model, booking.registration].filter(Boolean).join(" ") || "Hire vehicle"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            File for a repair
            <select name="claimId" className={field} defaultValue="">
              <option value="">Choose a file if this is a repair</option>
              {claims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.file_reference}
                  {claim.registration ? ` · ${claim.registration}` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate">For a handover, choose the hire booking. The file is taken from that booking. For a repair, choose the file and leave the booking as “Not a handover”.</p>
          <button className="min-h-11 w-full rounded-md bg-teal px-4 py-3 text-base font-semibold text-white sm:w-auto" type="submit">
            Assign for today
          </button>
        </ValidatedForm>
      ) : null}
    </div>
  );
}

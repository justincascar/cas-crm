import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ClaimTable";
import { canDoFieldJob, isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { formatUkDate, formatUkTime, londonTodayIso } from "@/lib/dates";
import { listAssignablePeople, listDriverJobs, type DriverJobRow } from "@/lib/db/jobs";

function statusWord(job: DriverJobRow): string {
  if (job.completed) return "Done";
  if (job.overdue) return "Overdue";
  if (!job.assigneeId) return "Not assigned";
  return "Not done";
}

export default async function DriverJobsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const staff = await requireSignedIn();
  if (!isOfficeRole(staff.role)) redirect("/jobs");
  const { error, saved } = await searchParams;
  const jobs = listDriverJobs();
  const drivers = listAssignablePeople()
    .filter((person) => canDoFieldJob(String(person.role)))
    .map((person) => ({ id: String(person.id), name: String(person.name) }));
  const days = [...new Set(jobs.filter((job) => !job.overdue).map((job) => job.workDate))];
  const groups = [
    ...(jobs.some((job) => job.overdue) ? [{ key: "overdue", title: "Overdue – not done from an earlier day", rows: jobs.filter((job) => job.overdue) }] : []),
    ...days.map((day) => ({ key: day, title: `${formatUkDate(day)}${day === londonTodayIso() ? " · today" : ""}`, rows: jobs.filter((job) => !job.overdue && job.workDate === day) })),
  ];
  const unassigned = jobs.filter((job) => !job.assigneeId && !job.completed).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver jobs"
        subtitle={`Deliveries, collections and handovers for every driver, today to a month ahead.${unassigned ? ` ${unassigned} not assigned yet.` : ""}`}
      />
      {error ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{error}</p> : null}
      {saved ? <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Saved.</p> : null}
      {jobs.length === 0 ? <p className="rounded-xl border border-line bg-card px-4 py-6 text-sm">No driver jobs in this period.</p> : null}
      {groups.map((group) => (
        <section key={group.key} className="space-y-2" data-driver-day={group.key}>
          <h2 className="font-serif text-xl text-navy-deep">{group.title}</h2>
          <ul className="space-y-2">
            {group.rows.map((job) => (
                <li
                  key={job.id}
                  data-driver-job={job.fileReference}
                  data-driver-assignee={job.assigneeId || "unassigned"}
                  className={`grid gap-2 rounded-xl border p-4 text-sm md:grid-cols-[6rem_1fr_14rem] ${
                    !job.assigneeId && !job.completed ? "border-warn bg-[#fff6e8]" : job.overdue ? "border-overdue/40 bg-[#f8ecec]" : "border-line bg-card"
                  }`}
                >
                  <p className="font-semibold tabular">
                    {group.key === "overdue" ? `${formatUkDate(job.workDate)} ` : ""}
                    {job.plannedAt ? formatUkTime(job.plannedAt) : "No time"}
                  </p>
                  <div className="min-w-0">
                    <p>
                      <Link href={`/claims/${job.claimId}/hire`} className="font-mono text-teal-dark underline">
                        {job.fileReference}
                      </Link>{" "}
                      · {job.jobLabel} · {job.vehicleLabel}
                    </p>
                    <p className="break-words text-slate">{job.place || "No address on the job"}</p>
                    <p className={job.overdue || !job.assigneeId ? "font-semibold" : "text-slate"}>
                      {job.assigneeName || "Driver not assigned"} · {statusWord(job)}
                    </p>
                  </div>
                  {job.completed ? null : (
                    <form method="post" action="/driver-jobs/assign" className="flex items-end gap-2">
                      <input type="hidden" name="jobId" value={job.id} />
                      <label className="min-w-0 flex-1 text-xs">
                        Driver
                        <select name="assigneeId" defaultValue={job.assigneeId || ""} className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2 text-sm">
                          <option value="">Unassigned</option>
                          {drivers.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="min-h-10 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
                        Save
                      </button>
                    </form>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { assignDayJob } from "@/lib/db/jobs";
import { browserOrigin } from "@/lib/http/browser-origin";

function jobsUrl(origin: string, error?: string) {
  const url = new URL("/jobs", origin);
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("saved", "1");
  return url;
}

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) {
    return NextResponse.redirect(jobsUrl(origin, "Only administrator or staff can assign a job."), 303);
  }
  try {
    const form = await request.formData();
    const assigned = assignDayJob({
      assigneeId: String(form.get("assigneeId") || ""),
      jobKind: String(form.get("jobKind") || ""),
      claimId: String(form.get("claimId") || ""),
      hireEpisodeId: String(form.get("hireEpisodeId") || ""),
      actorId: staff.id,
      workDate: String(form.get("workDate") || ""),
      completed: form.get("completed") === "1",
      actualDriverId: String(form.get("actualDriverId") || ""),
      actualOccurredAt: String(form.get("actualOccurredAt") || ""),
    });
    const url = jobsUrl(origin);
    if (assigned.storageDateReview) url.searchParams.set("review", "1");
    if (assigned.storageEndReview) url.searchParams.set("reviewEnd", "1");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The job could not be assigned.";
    return NextResponse.redirect(jobsUrl(origin, message), 303);
  }
}

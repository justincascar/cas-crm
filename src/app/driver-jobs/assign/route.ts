import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { reassignDayJob } from "@/lib/db/jobs";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const url = new URL("/driver-jobs", origin);
  try {
    const form = await request.formData();
    reassignDayJob({ jobId: String(form.get("jobId") || ""), assigneeId: String(form.get("assigneeId") || ""), actorId: staff.id });
    url.searchParams.set("saved", "1");
  } catch (error) {
    url.searchParams.set("error", error instanceof Error ? error.message : "The driver was not saved.");
  }
  return NextResponse.redirect(url, 303);
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { setRepairGapThresholdDays } from "@/lib/db/repair-progress";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL("/settings", origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  try {
    setRepairGapThresholdDays(String(form.get("repairProgressGapDays") || ""));
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The review prompt could not be saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "repair-gap");
  return NextResponse.redirect(back, 303);
}

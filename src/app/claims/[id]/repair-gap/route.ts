import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { explainRepairProgressGap } from "@/lib/db/repair-progress";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const backTo = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  try {
    explainRepairProgressGap({
      claimId: id,
      actorId: staff.id,
      role: staff.role,
      fromEventId: String(form.get("fromEventId") || ""),
      toEventId: String(form.get("toEventId") || ""),
      note: String(form.get("note") || ""),
    });
  } catch (error) {
    backTo.searchParams.set("stepError", error instanceof Error ? error.message : "The explanation could not be saved.");
    return NextResponse.redirect(backTo, 303);
  }
  backTo.searchParams.set("stepSaved", "gap");
  return NextResponse.redirect(backTo, 303);
}

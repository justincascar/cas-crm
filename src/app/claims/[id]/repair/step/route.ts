import { NextResponse } from "next/server";
import { isOfficeRole, pathAllowedForRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { recordRepairProgressStep, recordRepairStepCorrection } from "@/lib/db/repair-progress";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const fallback = `/claims/${id}/repair`;
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : fallback;
  const back = (error?: string) => {
    const url = new URL(safeReturn, origin);
    if (error) url.searchParams.set("stepError", error);
    else url.searchParams.set("stepSaved", "1");
    return NextResponse.redirect(url, 303);
  };
  if (!isOfficeRole(staff.role) && !pathAllowedForRole(staff.role, `/claims/${id}/repair/step`)) {
    return NextResponse.redirect(new URL("/jobs", origin), 303);
  }
  const intent = String(form.get("intent") || "step");
  const step = String(form.get("step") || "");
  try {
    if (intent === "correction") {
      recordRepairStepCorrection({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        step,
        occurredOn: String(form.get("occurredOn") || ""),
        reason: String(form.get("reason") || ""),
      });
    } else {
      recordRepairProgressStep({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        step,
        occurredOn: String(form.get("occurredOn") || ""),
        note: String(form.get("note") || ""),
        recipient: String(form.get("recipient") || ""),
        expectedOn: String(form.get("expectedOn") || ""),
      });
    }
  } catch (error) {
    return back(error instanceof Error ? error.message : "The step could not be saved.");
  }
  return back();
}

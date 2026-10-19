import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { recordRepairEstimateAgreed } from "@/lib/db/claim-step-record";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safe = returnTo.startsWith(`/claims/${id}`) && !returnTo.includes("..") ? returnTo.split("?")[0] : `/claims/${id}`;
  const back = (error?: string) => {
    const url = new URL(safe, origin);
    if (error) url.searchParams.set("stepError", error);
    else url.searchParams.set("stepSaved", "agreed");
    return NextResponse.redirect(url, 303);
  };
  try {
    const key = formSubmitKey(form);
    if (replaySubmit(key)) return back();
    recordRepairEstimateAgreed({
      claimId: id,
      actorId: staff.id,
      role: staff.role,
      occurredOn: String(form.get("occurredOn") || ""),
      note: String(form.get("note") || ""),
    });
    storeSubmit(key, { ok: true });
    return back();
  } catch (error) {
    return back(error instanceof Error ? error.message : "The agreement could not be saved.");
  }
}

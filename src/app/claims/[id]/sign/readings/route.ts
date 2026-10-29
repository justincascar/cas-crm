import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { saveBeforeSigningAndRefresh } from "@/lib/db/hire-out-readings";
import { browserOrigin } from "@/lib/http/browser-origin";

/** At the doorstep: mileage and fuel out first, then the client signs, then the handover is completed. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const back = new URL(`/claims/${id}/sign`, origin);
  const job = String(form.get("job") || "");
  if (job) back.searchParams.set("job", job);
  try {
    const key = formSubmitKey(form);
    if (!replaySubmit(key)) {
      saveBeforeSigningAndRefresh({
        claimId: id,
        actorId: staff.id,
        actorRole: staff.role,
        mileage: String(form.get("mileage") || ""),
        fuelLevel: String(form.get("fuelLevel") || ""),
      });
      storeSubmit(key, { ok: true });
    }
    back.searchParams.set("readings", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The readings were not saved.");
  }
  return NextResponse.redirect(back, 303);
}

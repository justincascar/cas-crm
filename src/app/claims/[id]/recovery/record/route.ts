import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { withImmediateTransaction } from "@/lib/db/record-version";
import { recordRecoveryDone } from "@/lib/db/record-recovery";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { FieldValidationError } from "@/lib/form-validation";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(`/claims/${id}/money/recovery`, origin);
  back.hash = "record";
  try {
    const form = await request.formData();
    const key = formSubmitKey(form);
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      recordRecoveryDone({ claimId: id, actorId: staff.id, form });
      storeSubmit(key, { ok: true });
    });
    back.searchParams.set("saved", "recovery");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The recovery was not recorded.");
    if (error instanceof FieldValidationError) back.searchParams.set("field", error.field);
  }
  return NextResponse.redirect(back, 303);
}

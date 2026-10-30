import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { recordStorageRecoveryOverride } from "@/lib/db/storage-recovery-signing";
import { headScreenPath } from "@/lib/domain/head-screen";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Justin's authorised override, with a written reason. The permission is checked again when it is recorded. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL(headScreenPath(id, "recovery"), origin);
  try {
    const form = await request.formData();
    recordStorageRecoveryOverride({ claimId: id, actorId: staff.id, reason: String(form.get("reason") || "") });
    back.searchParams.set("saved", "sr-override");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The override was not recorded.");
  }
  back.hash = "agreement";
  return NextResponse.redirect(back, 303);
}

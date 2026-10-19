import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { discardClaimDraft } from "@/lib/db/claim-drafts";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const draftId = String(form.get("draftId") || "");
  const back = new URL(draftId ? `/claims/new?draft=${draftId}` : "/claims/new", origin);
  try {
    discardClaimDraft({
      draftId,
      expectedVersion: String(form.get("draftVersion") || ""),
      confirm: form.get("confirmDiscard") === "yes",
      actorId: staff.id,
    });
  } catch (error) {
    const refused = clashRedirect(origin, `/claims/new?draft=${draftId}`, error);
    if (refused) return refused;
    back.searchParams.set("error", error instanceof Error ? error.message : "The draft could not be discarded.");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.redirect(new URL("/", origin), 303);
}

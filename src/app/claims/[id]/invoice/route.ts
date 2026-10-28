import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { produceDraftInvoice } from "@/lib/db/draft-invoice";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = new URL(`/claims/${id}/money`, origin);
  try {
    const key = formSubmitKey(form);
    const replayed = replaySubmit(key) as { documentId?: string } | null | undefined;
    if (replayed && typeof replayed === "object" && replayed.documentId) {
      return NextResponse.redirect(new URL(`/documents/${replayed.documentId}`, origin), 303);
    }
    const made = produceDraftInvoice({ claimId: id, head: String(form.get("head") || ""), actorId: staff.id });
    storeSubmit(key, { ok: true, documentId: made.documentId });
    return NextResponse.redirect(new URL(`/documents/${made.documentId}`, origin), 303);
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The draft invoice was not produced.");
    return NextResponse.redirect(back, 303);
  }
}

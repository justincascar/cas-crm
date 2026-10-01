import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { markDocumentChaseSent, prepareDocumentChaseEmail } from "@/lib/db/follow-up-chases";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}/documents`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}/documents`;
  const back = (message?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("error", message);
    else url.searchParams.set("saved", "chase");
    return NextResponse.redirect(url, 303);
  };
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "prepare") {
      prepareDocumentChaseEmail({ claimId: id, actorId: staff.id, kind: String(form.get("kind") || "") });
      return back();
    }
    if (intent === "mark_sent") {
      markDocumentChaseSent({
        claimId: id,
        kind: String(form.get("kind") || ""),
        correspondenceId: String(form.get("correspondenceId") || ""),
        actorId: staff.id,
      });
      return back();
    }
    throw new Error("That action is not available.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The chase could not be prepared.";
    const url = new URL(safeReturn, origin);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url, 303);
  }
}

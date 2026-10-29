import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { approveLegalDocument, markLegalDocumentSent } from "@/lib/db/legal-approval";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Justin approves a legal letter, then it can be marked as sent. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs?notice=office", origin), 303);
  const form = await request.formData();
  const back = new URL(`/documents/${id}`, origin);
  try {
    const key = formSubmitKey(form);
    if (!replaySubmit(key)) {
      const intent = String(form.get("intent") || "");
      if (intent === "approve") approveLegalDocument({ documentId: id, actorId: staff.id });
      else if (intent === "sent") markLegalDocumentSent({ documentId: id, actorId: staff.id });
      else throw new Error("Choose approve or mark as sent.");
      storeSubmit(key, { ok: true });
    }
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That was not saved.");
  }
  return NextResponse.redirect(back, 303);
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { approveDocument, withdrawDocumentApproval } from "@/lib/db/document-approvals";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R64: Justin approves (or withdraws) a draft document's wording, with the solicitor's check where it needs one. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL("/settings", origin);
  back.hash = "draft-documents";
  const form = await request.formData();
  try {
    const intent = String(form.get("intent") || "");
    const templateKey = String(form.get("templateKey") || "");
    if (intent === "approve") {
      approveDocument({ templateKey, actorId: staff.id, solicitorCheckedOn: String(form.get("solicitorCheckedOn") || "") });
    } else if (intent === "withdraw") {
      withdrawDocumentApproval({ templateKey, actorId: staff.id });
    } else {
      throw new Error("Nothing was changed.");
    }
    back.searchParams.set("saved", "draft-documents");
  } catch (error) {
    back.searchParams.set("draftError", error instanceof Error ? error.message : "That could not be saved.");
  }
  return NextResponse.redirect(back, 303);
}

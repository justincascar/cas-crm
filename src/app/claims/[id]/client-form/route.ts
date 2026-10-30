import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { applyClientProposals, decideClientUpload, revokeClientLink, sendClientLink } from "@/lib/db/client-form";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Staff side of the client form: send the link, switch it off, apply ticked answers, accept or reject uploads. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(`/claims/${id}/documents`, origin);
  back.hash = "client-form";
  try {
    const form = await request.formData();
    const intent = String(form.get("intent") || "");
    if (intent === "send_link") {
      const sent = await sendClientLink({ claimId: id, actorId: staff.id, to: String(form.get("to") || ""), origin });
      back.searchParams.set("clientForm", sent.simulated ? "link-simulated" : "link-sent");
    } else if (intent === "revoke") {
      revokeClientLink({ claimId: id, actorId: staff.id, linkId: String(form.get("linkId") || "") });
      back.searchParams.set("clientForm", "link-off");
    } else if (intent === "apply") {
      applyClientProposals({ claimId: id, actorId: staff.id, linkId: String(form.get("linkId") || ""), fields: form.getAll("field").map(String) });
      back.searchParams.set("clientForm", "applied");
    } else if (intent === "accept" || intent === "reject") {
      decideClientUpload({
        claimId: id,
        actorId: staff.id,
        actorRole: staff.role,
        uploadId: String(form.get("uploadId") || ""),
        accept: intent === "accept",
        documentType: String(form.get("documentType") || ""),
      });
      back.searchParams.set("clientForm", intent === "accept" ? "upload-added" : "upload-rejected");
    } else {
      throw new Error("Nothing was changed.");
    }
  } catch (error) {
    back.searchParams.set("clientFormError", error instanceof Error ? error.message : "Nothing was changed.");
  }
  return NextResponse.redirect(back, 303);
}

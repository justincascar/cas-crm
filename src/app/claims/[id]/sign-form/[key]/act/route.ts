import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import {
  isSignableDraft,
  readValuationAnswer,
  sendClientDocumentLink,
  signClientDocumentOnScreen,
  storeSignedClientDocumentPaper,
} from "@/lib/db/client-document-signing";
import { browserOrigin } from "@/lib/http/browser-origin";
import { requestDevice } from "@/lib/http/request-device";

/** R64: the client signs Draft 1 or 2 on screen, a signing link is sent, or the signed paper copy is filed. */
export async function POST(request: Request, context: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL(`/claims/${id}/sign-form/${key}`, origin);
  const form = await request.formData();
  try {
    if (!isSignableDraft(key)) throw new Error("That document is not signed by the client.");
    const intent = String(form.get("intent") || "");
    // R66 Draft 8a: the client's answer (A, B or C) and the finance question.
    const answer =
      key === "draft_tl_client" && (intent === "screen" || intent === "paper")
        ? readValuationAnswer({ choice: String(form.get("choice") || ""), reason: String(form.get("reason") || ""), finance: String(form.get("finance") || ""), lender: String(form.get("lender") || "") })
        : undefined;
    if (intent === "screen") {
      const { device, ip } = requestDevice(request);
      await signClientDocumentOnScreen({
        claimId: id,
        key,
        actorId: staff.id,
        name: String(form.get("signerName") || ""),
        signaturePng: String(form.get("signaturePng") || ""),
        agreed: form.get("agreed") === "yes",
        startNow: form.get("startNow") === "yes",
        device,
        ip,
        answer,
      });
      back.searchParams.set("done", "Signed. The signed copy is filed on the claim.");
    } else if (intent === "link" && isOfficeRole(staff.role)) {
      const sent = await sendClientDocumentLink({ claimId: id, key, actorId: staff.id, to: String(form.get("to") || ""), origin });
      back.searchParams.set("done", `Signing link sent${sent.simulated ? " (simulated: the mailbox is not connected)" : ""}. It works once and expires after seven days.`);
    } else if (intent === "paper" && isOfficeRole(staff.role)) {
      const file = form.get("signedCopy");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose the signed copy to upload.");
      storeSignedClientDocumentPaper({
        claimId: id,
        key,
        actorId: staff.id,
        signerName: String(form.get("signerName") || ""),
        startNowTicked: form.get("startNowTicked") === "yes",
        answer,
        file: { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type },
      });
      back.searchParams.set("done", "Signed paper copy filed. The date recorded is today.");
    } else {
      throw new Error("Nothing was changed.");
    }
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "It was not signed.");
  }
  return NextResponse.redirect(back, 303);
}

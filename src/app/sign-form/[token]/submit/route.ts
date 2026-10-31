import { NextResponse } from "next/server";
import { openClientDocumentLink, readValuationAnswer, signClientDocumentWithLink } from "@/lib/db/client-document-signing";
import { browserOrigin } from "@/lib/http/browser-origin";
import { requestDevice } from "@/lib/http/request-device";

/** R64: the client signs Draft 1 or Draft 2 from the emailed link. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = browserOrigin(request);
  const back = new URL(`/sign-form/${token}`, origin);
  try {
    const form = await request.formData();
    const { device, ip } = requestDevice(request);
    const valuation = openClientDocumentLink(token).valuation;
    await signClientDocumentWithLink({
      answer: valuation
        ? readValuationAnswer({ choice: String(form.get("choice") || ""), reason: String(form.get("reason") || ""), finance: String(form.get("finance") || ""), lender: String(form.get("lender") || "") })
        : undefined,
      token,
      name: String(form.get("signerName") || ""),
      signaturePng: String(form.get("signaturePng") || ""),
      agreed: form.get("agreed") === "yes",
      startNow: form.get("startNow") === "yes",
      device,
      ip,
    });
    back.searchParams.set("signed", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "It was not signed.");
  }
  return NextResponse.redirect(back, 303);
}

import { NextResponse } from "next/server";
import { signWithLink } from "@/lib/db/esign";
import { browserOrigin } from "@/lib/http/browser-origin";
import { requestDevice } from "@/lib/http/request-device";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = browserOrigin(request);
  const back = new URL(`/sign/${token}`, origin);
  try {
    const form = await request.formData();
    const { device, ip } = requestDevice(request);
    await signWithLink({
      token,
      name: String(form.get("signerName") || ""),
      signaturePng: String(form.get("signaturePng") || ""),
      agreed: form.get("agreed") === "yes",
      device,
      ip,
    });
    back.searchParams.set("signed", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The agreement was not signed.");
  }
  return NextResponse.redirect(back, 303);
}

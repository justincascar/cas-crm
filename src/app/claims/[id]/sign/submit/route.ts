import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { signAtDoorstep } from "@/lib/db/esign";
import { browserOrigin } from "@/lib/http/browser-origin";
import { requestDevice } from "@/lib/http/request-device";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const job = String(form.get("job") || "");
  try {
    const { device, ip } = requestDevice(request);
    await signAtDoorstep({
      claimId: id,
      actorId: staff.id,
      name: String(form.get("signerName") || ""),
      signaturePng: String(form.get("signaturePng") || ""),
      agreed: form.get("agreed") === "yes",
      device,
      ip,
    });
  } catch (error) {
    const back = new URL(`/claims/${id}/sign`, origin);
    if (job) back.searchParams.set("job", job);
    back.searchParams.set("error", error instanceof Error ? error.message : "The agreement was not signed.");
    return NextResponse.redirect(back, 303);
  }
  const office = isOfficeRole(staff.role);
  const done = new URL(office ? `/claims/${id}/hire` : `/claims/${id}/handover`, origin);
  if (office) {
    done.searchParams.set("saved", "1");
    done.hash = "handover";
  } else if (job) {
    done.searchParams.set("job", job);
  }
  return NextResponse.redirect(done, 303);
}

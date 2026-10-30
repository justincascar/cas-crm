import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { signStorageRecoveryOnScreen } from "@/lib/db/storage-recovery-signing";
import { headScreenPath } from "@/lib/domain/head-screen";
import { browserOrigin } from "@/lib/http/browser-origin";
import { requestDevice } from "@/lib/http/request-device";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  try {
    const { device, ip } = requestDevice(request);
    await signStorageRecoveryOnScreen({
      claimId: id,
      actorId: staff.id,
      name: String(form.get("signerName") || ""),
      signaturePng: String(form.get("signaturePng") || ""),
      agreed: form.get("agreed") === "yes",
      device,
      ip,
    });
  } catch (error) {
    const back = new URL(`/claims/${id}/storage-recovery/sign`, origin);
    back.searchParams.set("error", error instanceof Error ? error.message : "The agreement was not signed.");
    return NextResponse.redirect(back, 303);
  }
  const done = new URL(isOfficeRole(staff.role) ? headScreenPath(id, "recovery") : `/claims/${id}/storage-recovery/sign`, origin);
  done.searchParams.set("saved", "sr-signed");
  if (isOfficeRole(staff.role)) done.hash = "agreement";
  return NextResponse.redirect(done, 303);
}

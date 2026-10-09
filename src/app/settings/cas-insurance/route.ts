import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeCasInsuranceCertificate } from "@/lib/db/company-insurance";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  try {
    const form = await request.formData();
    const uploaded = form.get("document");
    if (!(uploaded instanceof File)) throw new Error("Choose a file to store.");
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    storeCasInsuranceCertificate({
      actorId: staff.id,
      actorRole: staff.role,
      file: { buffer, filename: uploaded.name, mimeType: uploaded.type },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The certificate could not be stored.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, origin), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=insurance", origin), 303);
}

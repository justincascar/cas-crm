import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeCasInsuranceCertificate } from "@/lib/db/company-insurance";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

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
    withSectionSave({
      scope: "settings-insurance",
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted: { document: uploaded.name },
      labels: { document: "Certificate file" },
      fields: { document: uploaded.name },
      write: () =>
        storeCasInsuranceCertificate({
          actorId: staff.id,
          actorRole: staff.role,
          file: { buffer, filename: uploaded.name, mimeType: uploaded.type },
        }),
    });
  } catch (error) {
    const refused = clashRedirect(origin, "/settings", error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message : "The certificate could not be stored.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, origin), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=insurance", origin), 303);
}

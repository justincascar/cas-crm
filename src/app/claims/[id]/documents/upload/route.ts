import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeClaimDocument } from "@/lib/db/claim-documents";
import { browserOrigin } from "@/lib/http/browser-origin";

function back(origin: string, claimId: string, error?: string) {
  const url = new URL(`/claims/${claimId}/documents`, origin);
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("saved", "1");
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);

  try {
    const form = await request.formData();
    const uploaded = form.get("document");
    if (!(uploaded instanceof File)) throw new Error("Choose a file to store.");
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    storeClaimDocument({
      claimId: id,
      actorId: staff.id,
      actorRole: staff.role,
      documentType: String(form.get("documentType") || ""),
      vehicleChoice: String(form.get("vehicleChoice") || ""),
      replacesDocumentId: String(form.get("replacesDocumentId") || "") || undefined,
      file: { buffer, filename: uploaded.name, mimeType: uploaded.type },
    });
    return back(origin, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The document could not be stored.";
    return back(origin, id, message);
  }
}

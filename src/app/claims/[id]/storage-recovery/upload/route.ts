import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeSignedStorageRecoveryPaper } from "@/lib/db/storage-recovery-signing";
import { headScreenPath } from "@/lib/domain/head-screen";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Files the signed paper copy of the Storage & Recovery Agreement. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(headScreenPath(id, "recovery"), origin);
  try {
    const form = await request.formData();
    const uploaded = form.get("signedCopy");
    if (!(uploaded instanceof File) || uploaded.size === 0) throw new Error("Choose the signed Storage & Recovery Agreement to upload.");
    storeSignedStorageRecoveryPaper({
      claimId: id,
      actorId: staff.id,
      signerName: String(form.get("signerName") || ""),
      file: { buffer: Buffer.from(await uploaded.arrayBuffer()), filename: uploaded.name, mimeType: uploaded.type },
    });
    back.searchParams.set("saved", "sr-signed");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The signed copy was not stored.");
  }
  back.hash = "agreement";
  return NextResponse.redirect(back, 303);
}

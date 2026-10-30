import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { clientUploadFile } from "@/lib/db/client-form";
import { readStoredFile } from "@/lib/storage/files";

/** Staff open a client upload before deciding on it. It came from outside CAS, so it is downloaded, never shown in the page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; uploadId: string }> }) {
  const staff = await requireSignedIn();
  if (!isOfficeRole(staff.role)) return new NextResponse("You cannot open that file.", { status: 403 });
  const { id, uploadId } = await params;
  const upload = clientUploadFile(id, uploadId);
  if (!upload) return new NextResponse("That upload is not on this claim.", { status: 404 });
  try {
    const { buffer } = readStoredFile(upload.storedRelpath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": upload.mimeType,
        "Content-Disposition": `attachment; filename="${upload.filename.replace(/["\r\n]/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "sandbox; frame-ancestors 'none'",
      },
    });
  } catch {
    return new NextResponse("Stored file is missing.", { status: 404 });
  }
}

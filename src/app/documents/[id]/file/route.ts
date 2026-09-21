import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { getDocument } from "@/lib/db/chronology";
import { readStoredFile } from "@/lib/storage/files";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc?.stored_relpath) {
    return new NextResponse("No stored file on this document.", { status: 404 });
  }
  try {
    const { buffer } = readStoredFile(String(doc.stored_relpath));
    const filename = String(doc.original_filename || "document.pdf").replace(/"/g, "");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": String(doc.mime_type || "application/pdf"),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
      },
    });
  } catch {
    return new NextResponse("Stored file is missing.", { status: 404 });
  }
}

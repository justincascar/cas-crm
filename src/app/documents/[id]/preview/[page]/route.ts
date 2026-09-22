import { NextResponse } from "next/server";
import { requireSignedIn } from "@/lib/auth/session";
import { canReadDocument } from "@/lib/db/jobs";
import { PdfPreviewError, PdfPreviewRangeError, renderPdfPage } from "@/lib/documents/pdf-preview";
import { readStoredPdfBytes } from "@/lib/documents/stored-preview";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  const staff = await requireSignedIn();
  const { id, page } = await params;
  if (!canReadDocument(staff, id)) {
    return new NextResponse("You cannot open that file.", { status: 403 });
  }
  const pageNumber = Number(page);
  try {
    const { mimeType, bytes } = await renderPdfPage(readStoredPdfBytes(id), pageNumber);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PdfPreviewRangeError) {
      return new NextResponse("That page is not in this PDF.", { status: 404 });
    }
    const message = error instanceof PdfPreviewError || error instanceof Error ? error.message : "This PDF page could not be drawn.";
    const status = /no stored file/i.test(message) ? 404 : 422;
    return new NextResponse(message, { status });
  }
}

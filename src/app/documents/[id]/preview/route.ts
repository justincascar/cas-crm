import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/session";
import { countPdfPages, PdfPreviewError } from "@/lib/documents/pdf-preview";
import { readStoredPdfBytes } from "@/lib/documents/stored-preview";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  try {
    const pages = await countPdfPages(readStoredPdfBytes(id));
    return NextResponse.json({ pages });
  } catch (error) {
    const message = error instanceof PdfPreviewError || error instanceof Error ? error.message : "This PDF could not be read.";
    const status = /no stored file/i.test(message) ? 404 : 422;
    return NextResponse.json({ pages: 0, error: message }, { status });
  }
}

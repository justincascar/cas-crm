import { getDocument } from "@/lib/db/chronology";
import { readStoredFile } from "@/lib/storage/files";

export function readStoredPdfBytes(documentId: string): Uint8Array {
  const doc = getDocument(documentId);
  if (!doc?.stored_relpath) {
    throw new Error("No stored file on this document.");
  }
  const { buffer } = readStoredFile(String(doc.stored_relpath));
  return new Uint8Array(buffer);
}

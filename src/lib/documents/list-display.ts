/** How a documents-list row should be shown. Empty bodies are placeholders, not stored originals. */
export function documentHasGeneratedBody(bodyHtml: string | number | null | undefined): boolean {
  return Boolean(String(bodyHtml || "").trim());
}

export function documentIsStoredFile(doc: { stored_relpath?: string | number | null }): boolean {
  return Boolean(String(doc.stored_relpath || "").trim());
}

export function documentListSignedLabel(doc: {
  body_html?: string | number | null;
  signed?: string | number | null;
  stored_relpath?: string | number | null;
}): string {
  if (documentIsStoredFile(doc)) return "Stored file";
  if (documentHasGeneratedBody(doc.body_html)) {
    return Number(doc.signed) ? "Signed copy on file" : "Unsigned";
  }
  if (Number(doc.signed)) return "Simulated signed copy — no file attached";
  return "Simulated placeholder — no document on file";
}

export const DOCUMENT_PLACEHOLDER_NOTE = "Simulated placeholder — no document on file";

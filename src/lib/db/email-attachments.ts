import { ATTACHMENT_TOO_LARGE_MESSAGE, attachmentsExceedSimpleSend } from "../email/attachments";
import { claimDocumentTypeLabel } from "../domain/claim-documents";
import { formatUkDate } from "../dates";
import { readStoredFile, safeFilename } from "../storage/files";
import { all } from "./connection";

export type EmailFileAttachment = {
  documentId: string;
  label: string;
  name: string;
  contentType: string;
  content: Buffer;
};

type StoredRow = {
  id: string;
  claim_id: string | null;
  title: string | null;
  document_type: string | null;
  template_key: string | null;
  version: number | null;
  created_at: string | null;
  original_filename: string | null;
  stored_relpath: string | null;
  mime_type: string | null;
  byte_size: number | null;
  body_html: string | null;
};

export function loadClaimEmailAttachments(
  claimId: string,
  documentIds: string[],
): { ok: true; attachments: EmailFileAttachment[] } | { ok: false; error: string } {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: true, attachments: [] };
  const marks = ids.map(() => "?").join(", ");
  const rows = all<StoredRow>(
    `SELECT id, claim_id, title, document_type, template_key, version, created_at, original_filename, stored_relpath, mime_type, byte_size, body_html
     FROM documents WHERE claim_id = ? AND id IN (${marks})`,
    [claimId, ...ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const attachments: EmailFileAttachment[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.claim_id !== claimId) {
      return { ok: false, error: "That document is not stored on this claim. Nothing was sent." };
    }
    const loaded = readOne(row);
    if (!loaded.ok) return loaded;
    attachments.push(loaded.attachment);
  }
  const total = attachments.reduce((sum, item) => sum + item.content.length, 0);
  if (attachmentsExceedSimpleSend(total)) return { ok: false, error: ATTACHMENT_TOO_LARGE_MESSAGE };
  return { ok: true, attachments };
}

function readOne(row: StoredRow): { ok: true; attachment: EmailFileAttachment } | { ok: false; error: string } {
  const label = labelFor(row);
  const relpath = String(row.stored_relpath || "").trim();
  if (relpath) {
    try {
      const { buffer } = readStoredFile(relpath);
      const name = safeFilename(String(row.original_filename || "").trim() || `${row.title || "document"}.bin`);
      return {
        ok: true,
        attachment: {
          documentId: row.id,
          label,
          name,
          contentType: String(row.mime_type || "").trim() || "application/octet-stream",
          content: buffer,
        },
      };
    } catch {
      return { ok: false, error: `${label} is recorded on this claim, but the file itself is missing. Nothing was sent.` };
    }
  }
  const html = String(row.body_html || "").trim();
  if (!html) return { ok: false, error: `${label} has no file to attach. Nothing was sent.` };
  const name = safeFilename(`${String(row.title || "document").trim() || "document"}.html`);
  return {
    ok: true,
    attachment: {
      documentId: row.id,
      label,
      name,
      contentType: "text/html",
      content: Buffer.from(html, "utf8"),
    },
  };
}

function labelFor(row: StoredRow): string {
  const title = String(row.title || "").trim() || "Document";
  const date = formatUkDate(row.created_at);
  const version = Number(row.version) || 1;
  const versionText = version > 1 ? ` v${version}` : "";
  const generated = Boolean(String(row.template_key || "").trim()) || !String(row.stored_relpath || "").trim();
  if (generated) return `${title}${versionText} — generated ${date}`;
  return `${claimDocumentTypeLabel(row.document_type) || title}${versionText} — ${date}`;
}

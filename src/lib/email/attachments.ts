import { claimDocumentTypeLabel } from "../domain/claim-documents";
import { formatUkDate } from "../dates";

/**
 * A file under this size is added to a draft in one call.
 * At this size or above, Graph requires an upload session and refuses the one-call attachment.
 */
export const GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

/** One file in an upload session. Graph's own ceiling, separate from the mailbox limit below. */
export const GRAPH_UPLOAD_SESSION_LIMIT_BYTES = 150 * 1024 * 1024;

/**
 * Exchange Online's published default for a whole message, including its attachments.
 * This app cannot read the mailbox's own MaxSendSize. An administrator can raise that
 * setting, up to the 150 MB service maximum. The screen uses this published default.
 */
export const MAILBOX_ATTACHMENT_LIMIT_BYTES = 35 * 1024 * 1024;

export const ATTACHMENT_TOO_LARGE_MESSAGE = `These documents are too large for this send (over ${MAILBOX_ATTACHMENT_LIMIT_BYTES / (1024 * 1024)} MB altogether). Nothing was sent. Untick a document and try again.`;

export const NO_STORED_DOCUMENTS_MESSAGE = "No documents stored on this claim yet.";

export type AttachmentSource = {
  id?: string | null;
  title?: string | null;
  document_type?: string | null;
  kind?: string | null;
  template_key?: string | null;
  version?: string | number | null;
  created_at?: string | null;
  stored_relpath?: string | null;
  body_html?: string | null;
  byte_size?: string | number | null;
};

export type AttachmentChoice = {
  id: string;
  label: string;
  byteSize: number;
};

export function attachmentChoices(rows: AttachmentSource[]): AttachmentChoice[] {
  return rows
    .filter((row) => String(row.id || "").trim() && hasStoredContent(row))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((row) => ({
      id: String(row.id),
      label: attachmentLabel(row),
      byteSize: attachmentByteSize(row),
    }));
}

export function selectedAttachmentBytes(choices: AttachmentChoice[], ids: string[]): number {
  const chosen = new Set(ids);
  return choices.filter((choice) => chosen.has(choice.id)).reduce((total, choice) => total + choice.byteSize, 0);
}

export function attachmentsExceedMailboxLimit(totalBytes: number): boolean {
  return totalBytes > MAILBOX_ATTACHMENT_LIMIT_BYTES;
}

function hasStoredContent(row: AttachmentSource): boolean {
  if (String(row.stored_relpath || "").trim()) return true;
  return String(row.body_html || "").trim() !== "";
}

function attachmentByteSize(row: AttachmentSource): number {
  if (String(row.stored_relpath || "").trim()) return Math.max(0, Number(row.byte_size) || 0);
  return new TextEncoder().encode(String(row.body_html || "")).length;
}

function attachmentLabel(row: AttachmentSource): string {
  const title = String(row.title || "").trim() || "Document";
  const date = formatUkDate(String(row.created_at || ""));
  const version = Number(row.version) || 1;
  const versionText = version > 1 ? ` v${version}` : "";
  const generated = Boolean(String(row.template_key || "").trim()) || (!String(row.stored_relpath || "").trim() && String(row.body_html || "").trim() !== "");
  if (generated) return `${title}${versionText} — generated ${date}`;
  const typeLabel = claimDocumentTypeLabel(String(row.document_type || "")) || title;
  return `${typeLabel}${versionText} — ${date}`;
}

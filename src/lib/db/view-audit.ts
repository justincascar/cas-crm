import { nowUtcIso } from "../dates";
import { claimDocumentTypeLabel } from "../domain/claim-documents";
import { get, newId, run } from "./connection";

/**
 * Audit of viewing (J15). Who opened or downloaded the most sensitive records: bank statements, licence checks and
 * signed agreements, the full export and the person's-data screen. Written to the audit log as "view", shown and
 * filtered in the audit view. Nothing from the record itself is copied into the log.
 */

export const VIEW_LOGGED_DOCUMENT_TYPES = new Set(["bank_statements", "licence_check", "signed_hire_agreement", "signed_storage_recovery_agreement"]);

export function recordView(input: { actorId: string; what: string; claimId?: string | null; entity: string }) {
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'view', ?, ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    input.entity,
    input.claimId || null,
    input.what,
  ]);
}

/** Records the opening of a stored document when it is one of the sensitive kinds. */
export function recordDocumentView(input: { actorId: string; documentId: string; how: "opened" | "downloaded" }) {
  const doc = get<{ claim_id: string | null; document_type: string | null; title: string | null }>(
    `SELECT claim_id, document_type, title FROM documents WHERE id = ?`,
    [input.documentId],
  );
  const type = String(doc?.document_type || "");
  if (!doc || !VIEW_LOGGED_DOCUMENT_TYPES.has(type)) return;
  const label = claimDocumentTypeLabel(type) || (type === "signed_storage_recovery_agreement" ? "Signed Storage & Recovery Agreement" : "Document");
  recordView({ actorId: input.actorId, entity: `document:${type}`, claimId: doc.claim_id, what: `${input.how === "downloaded" ? "Downloaded" : "Opened"} ${label} (${input.documentId})` });
}

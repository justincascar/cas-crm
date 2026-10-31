import { get } from "./connection";
import { SIGNED_HIRE_AGREEMENT_TYPE } from "./hire-readiness";

export type AgreementDocumentState = "signed" | "replaced" | null;

/**
 * R43: a produced hire agreement is never signed itself; its signature is a separate signed copy (signed on screen,
 * by link, or printed, signed and uploaded). This says whether a produced agreement was signed, or was replaced by
 * a later agreement before it was, so lists do not call a signed agreement "Unsigned".
 */
export function agreementDocumentState(doc: { id: string; claim_id: string; template_key?: string | null; created_at: string }): AgreementDocumentState {
  if (String(doc.template_key || "") !== "hire_agreement") return null;
  const esigned = get<{ n: number }>(`SELECT COUNT(*) AS n FROM esign_requests WHERE document_id = ? AND status = 'signed'`, [doc.id]);
  if (Number(esigned?.n || 0) > 0) return "signed";
  const swap = get<{ signed_document_id: string | null }>(`SELECT signed_document_id FROM hire_swaps WHERE agreement_document_id = ?`, [doc.id]);
  if (swap?.signed_document_id) return "signed";
  const later = get<{ id: string }>(
    `SELECT id FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement' AND id <> ? AND created_at > ? ORDER BY created_at LIMIT 1`,
    [doc.claim_id, doc.id, doc.created_at],
  );
  // An uploaded signed copy belongs to the original agreement produced before it, when no later agreement was produced in between.
  if (!swap) {
    const upload = get<{ created_at: string }>(
      `SELECT created_at FROM documents WHERE claim_id = ? AND document_type = ? AND created_at >= ? ORDER BY created_at LIMIT 1`,
      [doc.claim_id, SIGNED_HIRE_AGREEMENT_TYPE, doc.created_at],
    );
    const laterOriginal = get<{ created_at: string }>(
      `SELECT created_at FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement' AND id <> ? AND created_at > ?
         AND id NOT IN (SELECT agreement_document_id FROM hire_swaps WHERE agreement_document_id IS NOT NULL)
       ORDER BY created_at LIMIT 1`,
      [doc.claim_id, doc.id, doc.created_at],
    );
    if (upload && (!laterOriginal || upload.created_at < laterOriginal.created_at)) return "signed";
  }
  return later ? "replaced" : null;
}

export function agreementStateLabel(state: AgreementDocumentState): string | null {
  if (state === "signed") return "Signed – see signed copy";
  if (state === "replaced") return "Replaced";
  return null;
}

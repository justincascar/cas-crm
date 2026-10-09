import { isOfficeRole } from "../auth/roles";
import { MAX_CLAIM_DOCUMENT_BYTES, claimDocumentMime } from "../domain/claim-documents";
import { CAS_INSURANCE_DOCUMENT_TYPE, currentStoredDocument, type PackDocument } from "../email/payment-request-pack";
import { storeFileCopy } from "../storage/files";
import { all, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";

export type CasInsuranceRow = PackDocument & {
  id: string;
  title: string;
  document_type: string;
  version: number;
  signed: number;
  created_at: string;
  original_filename: string;
  stored_relpath: string;
  mime_type: string;
  byte_size: number;
  replaces_document_id: string | null;
  template_key: null;
  body_html: null;
};

const TITLE = "CAS's own insurance certificate";

export function listCasInsuranceDocuments(): CasInsuranceRow[] {
  return all<CasInsuranceRow>(
    `SELECT id, title, document_type, version, signed, created_at, original_filename, stored_relpath, mime_type, byte_size,
            replaces_document_id, template_key, body_html
     FROM documents
     WHERE claim_id IS NULL AND document_type = ?
     ORDER BY created_at DESC`,
    [CAS_INSURANCE_DOCUMENT_TYPE],
  );
}

export function currentCasInsuranceDocument(): CasInsuranceRow | null {
  const current = currentStoredDocument(listCasInsuranceDocuments());
  if (!current?.id) return null;
  return listCasInsuranceDocuments().find((row) => row.id === String(current.id)) ?? null;
}

export function storeCasInsuranceCertificate(input: {
  actorId: string;
  actorRole: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}): { id: string; version: number } {
  if (!isOfficeRole(input.actorRole)) throw new Error("You cannot store the company insurance certificate.");
  const filename = (input.file.filename || "").trim() || "document";
  if (!input.file.buffer || input.file.buffer.length < 1) throw new Error("Choose a file to store.");
  if (input.file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  const mimeType = claimDocumentMime(filename, input.file.mimeType);
  const previous = currentCasInsuranceDocument();
  const version = previous ? (Number(previous.version) || 1) + 1 : 1;
  const stored = storeFileCopy({
    relDir: "company/cas-insurance",
    originalFilename: `${newId("file")}-${filename}`,
    buffer: input.file.buffer,
  });
  const db = getDb();
  db.exec("BEGIN");
  try {
    const id = insertStoredDocument({
      title: TITLE,
      documentType: CAS_INSURANCE_DOCUMENT_TYPE,
      kind: "company_file",
      claimId: null,
      originalFilename: filename,
      storedRelpath: stored.storedRelpath,
      mimeType,
      byteSize: stored.byteSize,
      createdBy: input.actorId,
      simulated: 0,
    });
    run(`UPDATE documents SET version = ?, replaces_document_id = ? WHERE id = ?`, [
      version,
      previous?.id ?? null,
      id,
    ]);
    db.exec("COMMIT");
    return { id, version };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, formatUkDateTime, nowUtcIso } from "../dates";
import { claimDocumentMime, MAX_CLAIM_DOCUMENT_BYTES } from "../domain/claim-documents";
import { renderSignedAgreementPdf } from "../documents/signed-pdf";
import { storeFileCopy } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { get, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";
import { clientAgreementHtml } from "./esign";
import { signedHireAgreementOnFile } from "./hire-readiness";
import { OVERRIDE_UNSIGNED_STORAGE_RECOVERY } from "../auth/roles";
import { listStaffPermissions } from "./permissions";

/**
 * Signing the standalone Storage & Recovery Agreement (review note R17). The same two routes as the hire agreement:
 *  - screen: the client signs on CAS's screen (the driver's phone at the recovery, or the office), witnessed by the
 *    signed-in member of staff;
 *  - paper: the signed paper copy is photographed or scanned and uploaded. The signed date is the upload, never earlier.
 * A signature is never added on anyone's behalf. Recovery and storage are not claimed until it is signed, unless the
 * client's signed hire agreement already included the Storage & Recovery page.
 */

export const STORAGE_RECOVERY_TEMPLATE_KEY = "storage_recovery";
export const SIGNED_STORAGE_RECOVERY_TYPE = "signed_storage_recovery_agreement";
const MAX_SIGNATURE_CHARS = 400_000;

export function ensureStorageRecoverySignatureTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_recovery_signatures (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      document_version INTEGER NOT NULL,
      document_sha256 TEXT,
      route TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signature_png TEXT,
      device TEXT,
      ip TEXT,
      recorded_by TEXT,
      signed_document_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sr_signatures_claim ON storage_recovery_signatures(claim_id, signed_at);
  `);
}

function ready() {
  ensureStorageRecoverySignatureTable(getDb());
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export type StorageRecoveryDoc = { id: string; title: string; version: number; bodyHtml: string; missing: string[]; number: string; createdAt: string };

/** The version that would be signed now: the latest produced. */
export function latestStorageRecoveryDocument(claimId: string): StorageRecoveryDoc | null {
  const row = get<{ id: string; title: string | null; version: number; body_html: string | null; missing_json: string | null; created_at: string }>(
    `SELECT id, title, version, body_html, missing_json, created_at FROM documents
     WHERE claim_id = ? AND template_key = ? ORDER BY version DESC, created_at DESC LIMIT 1`,
    [claimId, STORAGE_RECOVERY_TEMPLATE_KEY],
  );
  if (!row?.body_html) return null;
  let missing: string[] = [];
  try {
    missing = row.missing_json ? (JSON.parse(String(row.missing_json)) as string[]) : [];
  } catch {
    missing = ["details not readable"];
  }
  const html = String(row.body_html);
  return {
    id: String(row.id),
    title: String(row.title || "Storage & Recovery Agreement"),
    version: Number(row.version) || 1,
    bodyHtml: clientAgreementHtml(html),
    missing,
    number: html.match(/Agreement number: <strong>([^<]+)<\/strong>/)?.[1] || "",
    createdAt: String(row.created_at),
  };
}

export type StorageRecoveryState =
  | { status: "signed"; signedAt: string; signerName: string; route: "screen" | "paper"; documentId: string; number: string; version: number }
  | { status: "covered_by_hire"; documentId: string; signedAt: string }
  | { status: "override"; reason: string; recordedAt: string; recordedByName: string | null; produced: StorageRecoveryDoc | null }
  | { status: "not_signed"; produced: StorageRecoveryDoc | null };

/** Whether the client has signed the Storage & Recovery terms, and how. */
export function storageRecoveryState(claimId: string): StorageRecoveryState {
  ready();
  const row = get<{ signed_at: string; signer_name: string; route: string; signed_document_id: string; document_id: string; document_version: number }>(
    `SELECT signed_at, signer_name, route, signed_document_id, document_id, document_version FROM storage_recovery_signatures
     WHERE claim_id = ? ORDER BY signed_at DESC, rowid DESC LIMIT 1`,
    [claimId],
  );
  if (row) {
    const doc = get<{ body_html: string | null }>(`SELECT body_html FROM documents WHERE id = ?`, [row.document_id]);
    return {
      status: "signed",
      signedAt: String(row.signed_at),
      signerName: String(row.signer_name),
      route: row.route === "paper" ? "paper" : "screen",
      documentId: String(row.signed_document_id),
      number: String(doc?.body_html || "").match(/Agreement number: <strong>([^<]+)<\/strong>/)?.[1] || "",
      version: Number(row.document_version) || 1,
    };
  }
  const hireSigned = signedHireAgreementOnFile(claimId);
  if (hireSigned) {
    const agreement = get<{ body_html: string | null }>(
      `SELECT body_html FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement' ORDER BY version DESC, created_at DESC LIMIT 1`,
      [claimId],
    );
    if (String(agreement?.body_html || "").includes("<h2>Storage &amp; Recovery Agreement</h2>")) {
      return { status: "covered_by_hire", documentId: hireSigned.id, signedAt: hireSigned.createdAt };
    }
  }
  const override = storageRecoveryOverride(claimId);
  if (override) return { status: "override", ...override, produced: latestStorageRecoveryDocument(claimId) };
  return { status: "not_signed", produced: latestStorageRecoveryDocument(claimId) };
}

export const STORAGE_RECOVERY_OVERRIDE_EVENT = "storage_recovery_agreement_override";

function storageRecoveryOverride(claimId: string): { reason: string; recordedAt: string; recordedByName: string | null } | null {
  const row = get<{ details: string | null; occurred_at: string; name: string | null }>(
    `SELECT e.details, e.occurred_at, s.name FROM claim_events e LEFT JOIN staff s ON s.id = e.actor_id
     WHERE e.claim_id = ? AND e.event_type = ? ORDER BY e.occurred_at DESC, e.recorded_at DESC LIMIT 1`,
    [claimId, STORAGE_RECOVERY_OVERRIDE_EVENT],
  );
  if (!row) return null;
  const reason = String(row.details || "").match(/Reason: ([\s\S]*)$/)?.[1]?.trim() || "";
  return { reason, recordedAt: String(row.occurred_at), recordedByName: row.name ? String(row.name) : null };
}

/** Justin only (review note R21). */
export function canOverrideUnsignedStorageRecovery(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(OVERRIDE_UNSIGNED_STORAGE_RECOVERY);
}

/**
 * Justin's authorised override: recovery or storage may be claimed without a signed Storage & Recovery Agreement.
 * The written reason is kept on the file and shown in the history and the chronology. Nothing is signed by it.
 */
export function recordStorageRecoveryOverride(input: { claimId: string; actorId: string; reason: string }) {
  if (!canOverrideUnsignedStorageRecovery(input.actorId)) {
    throw new Error("Only Justin can authorise claiming recovery or storage without a signed Storage & Recovery Agreement.");
  }
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 5) throw new Error("Write the reason for the override.");
  if (storageRecoveryState(input.claimId).status !== "not_signed") throw new Error("No override is needed on this file.");
  const actor = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [input.actorId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: STORAGE_RECOVERY_OVERRIDE_EVENT,
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Recovery and storage may be claimed without a signed Storage & Recovery Agreement. Authorised override by ${actor?.name || "Justin"}. The client has not signed it. Reason: ${reason}`,
    source: "staff",
  });
}

/** One line for invoices and screens. */
export function storageRecoverySignedLine(state: StorageRecoveryState): string {
  if (state.status === "signed") {
    return `Storage & Recovery Agreement ${state.number || ""} signed by ${state.signerName} on ${formatUkDate(state.signedAt)}${
      state.route === "paper" ? " (signed paper copy on the file)" : " (signed on screen)"
    }.`.replace("Agreement  signed", "Agreement signed");
  }
  if (state.status === "override") {
    return `Not signed. Recovery and storage may be claimed under an authorised override by ${state.recordedByName || "Justin"} on ${formatUkDate(state.recordedAt)}. Reason: ${state.reason}`;
  }
  if (state.status === "covered_by_hire") {
    return `The Storage & Recovery terms are in the client's signed hire agreement (on the file from ${formatUkDate(state.signedAt)}).`;
  }
  return "No signed Storage & Recovery Agreement is on the file yet.";
}

const CLAIM_EVENTS = new Set(["recovery_payment_request_sent", "storage_payment_request_sent"]);

/** Recovery and storage are not claimed until the client has signed the Storage & Recovery terms. */
export function guardStorageRecoveryClaim(claimId: string, eventType: string) {
  if (!CLAIM_EVENTS.has(eventType)) return;
  if (storageRecoveryState(claimId).status === "not_signed") {
    throw new Error(
      "The client has not signed the Storage & Recovery Agreement. Get it signed on screen or upload the signed paper copy on the Recovery page before claiming recovery or storage. Only Justin can authorise an override, with a reason.",
    );
  }
}

function requireDocument(claimId: string): StorageRecoveryDoc {
  const doc = latestStorageRecoveryDocument(claimId);
  if (!doc) throw new Error("Produce the Storage & Recovery Agreement for signature first. That is the version the client signs.");
  if (doc.missing.length > 0) {
    throw new Error("This agreement was produced with details missing. Add them and produce a new version for signature first.");
  }
  return doc;
}

function signatureBuffer(png: string): Buffer {
  const text = png.trim();
  if (!text.startsWith("data:image/png;base64,")) throw new Error("Please draw the signature in the box.");
  if (text.length > MAX_SIGNATURE_CHARS) throw new Error("The signature is too large. Clear it and sign again.");
  const buffer = Buffer.from(text.slice("data:image/png;base64,".length), "base64");
  if (buffer.length < 100) throw new Error("Please draw the signature in the box.");
  return buffer;
}

function signerName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Type the client's full name.");
  if (name.length > 120) throw new Error("Keep the name to the full name only.");
  return name;
}

function recordSignature(input: {
  claimId: string;
  doc: StorageRecoveryDoc;
  route: "screen" | "paper";
  signedAt: string;
  name: string;
  signaturePng: string | null;
  device: string;
  ip: string;
  actorId: string;
  signedDocumentId: string;
}) {
  run(
    `INSERT INTO storage_recovery_signatures(id, claim_id, document_id, document_version, document_sha256, route, signed_at, signer_name,
       signature_png, device, ip, recorded_by, signed_document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("srsign"),
      input.claimId,
      input.doc.id,
      input.doc.version,
      sha256(input.doc.bodyHtml),
      input.route,
      input.signedAt,
      input.name,
      input.signaturePng,
      input.device.slice(0, 300),
      input.ip.slice(0, 100),
      input.actorId,
      input.signedDocumentId,
    ],
  );
}

/** The client signs on CAS's screen. The member of staff holding the device is recorded as the witness. */
export async function signStorageRecoveryOnScreen(input: {
  claimId: string;
  actorId: string;
  name: string;
  signaturePng: string;
  agreed: boolean;
  device: string;
  ip: string;
}) {
  ready();
  const actor = get<{ id: string; name: string }>(`SELECT id, name FROM staff WHERE id = ? AND active = 1`, [input.actorId]);
  if (!actor) throw new Error("Sign in again.");
  const doc = requireDocument(input.claimId);
  if (!input.agreed) throw new Error("The client must tick the box to say they have read and agree to the agreement.");
  const name = signerName(input.name);
  const signature = signatureBuffer(input.signaturePng);
  const signedAt = nowUtcIso();
  const pdf = await renderSignedAgreementPdf({
    title: `${doc.title} – signed`,
    agreementHtml: doc.bodyHtml,
    signaturePng: signature,
    audit: [
      ["Signed by", name],
      ["Signed at", `${formatUkDateTime(signedAt)} (UK time)`],
      ["Document", `${doc.title}, version ${doc.version}`],
      ["Document fingerprint (SHA-256)", sha256(doc.bodyHtml)],
      ["How", "Signed on CAS's device"],
      ["Witnessed by", String(actor.name)],
      ["Device", input.device || "not given"],
      ["Network address", input.ip || "not given"],
    ],
  });
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/documents`,
    originalFilename: `${newId("file")}-signed-storage-recovery-agreement.pdf`,
    buffer: pdf,
  });
  const documentId = insertStoredDocument({
    title: "Signed Storage & Recovery Agreement",
    documentType: SIGNED_STORAGE_RECOVERY_TYPE,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: null,
    originalFilename: "signed-storage-recovery-agreement.pdf",
    storedRelpath: stored.storedRelpath,
    mimeType: "application/pdf",
    byteSize: stored.byteSize,
    createdBy: actor.id,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1, version = ? WHERE id = ?`, [doc.version, documentId]);
  recordSignature({
    claimId: input.claimId,
    doc,
    route: "screen",
    signedAt,
    name,
    signaturePng: input.signaturePng,
    device: input.device,
    ip: input.ip,
    actorId: actor.id,
    signedDocumentId: documentId,
  });
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: signedAt,
    actorId: actor.id,
    documentId,
    details: `${doc.title} (version ${doc.version}) signed on screen by ${name}, witnessed by ${actor.name}. The signed PDF is filed as Signed Storage & Recovery Agreement.`,
    source: "staff",
  });
  return { documentId };
}

/** Files the signed paper copy. The signed date recorded is the upload, never earlier. */
export function storeSignedStorageRecoveryPaper(input: {
  claimId: string;
  actorId: string;
  signerName: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
}) {
  ready();
  const doc = requireDocument(input.claimId);
  const name = signerName(input.signerName);
  const filename = (input.file.filename || "").trim() || "signed-storage-recovery-agreement.pdf";
  if (!input.file.buffer || input.file.buffer.length < 1) throw new Error("Choose the signed Storage & Recovery Agreement to upload.");
  if (input.file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/documents`,
    originalFilename: `${newId("file")}-${filename}`,
    buffer: input.file.buffer,
  });
  const documentId = insertStoredDocument({
    title: "Signed Storage & Recovery Agreement",
    documentType: SIGNED_STORAGE_RECOVERY_TYPE,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: null,
    originalFilename: filename,
    storedRelpath: stored.storedRelpath,
    mimeType: claimDocumentMime(filename, input.file.mimeType),
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1, version = ? WHERE id = ?`, [doc.version, documentId]);
  const signedAt = nowUtcIso();
  recordSignature({
    claimId: input.claimId,
    doc,
    route: "paper",
    signedAt,
    name,
    signaturePng: null,
    device: "",
    ip: "",
    actorId: input.actorId,
    signedDocumentId: documentId,
  });
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: signedAt,
    actorId: input.actorId,
    documentId,
    details: `Signed paper copy of ${doc.title} (version ${doc.version}), signed by ${name}, uploaded and filed. Nothing was attached to an email.`,
    source: "staff",
  });
  return { documentId };
}

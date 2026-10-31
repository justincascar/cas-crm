import { createHash, randomBytes } from "node:crypto";
import { formatUkDateTime, nowUtcIso } from "../dates";
import { MAX_CLAIM_DOCUMENT_BYTES, claimDocumentMime } from "../domain/claim-documents";
import { clientDraftInfo } from "../documents/client-drafts";
import { renderSignedAgreementPdf } from "../documents/signed-pdf";
import { DRAFT_WORDING_NOT_APPROVED } from "../documents/template-approval";
import { storeFileCopy } from "../storage/files";
import { recordClaimEvent, sendClaimEmail } from "./chronology";
import { get, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";
import { isDocumentApproved } from "./document-approvals";

/**
 * R64: the client signs Draft 1 (instruction and authority) or Draft 2 (repair authority) like the hire agreement: on
 * CAS's screen, by a link, or on paper. Only once Justin has approved the wording, only the version produced after that
 * approval, and only with the "starting straight away" tick (clause 10 or clause 9) ticked. Nothing is backdated.
 */
export const SIGNABLE_DRAFTS = ["draft_client_authority", "draft_repair_authority"] as const;
export type SignableDraft = (typeof SIGNABLE_DRAFTS)[number];
const LINK_DAYS = 7;
const MAX_SIGNATURE_CHARS = 400_000;

export function isSignableDraft(key: string): key is SignableDraft {
  return (SIGNABLE_DRAFTS as readonly string[]).includes(key);
}

function ready() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS client_document_signatures (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      document_id TEXT NOT NULL,
      route TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      start_now_ticked INTEGER NOT NULL,
      signed_document_id TEXT NOT NULL,
      actor_id TEXT,
      device TEXT,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS client_document_links (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      document_id TEXT NOT NULL,
      token_sha256 TEXT NOT NULL,
      sent_to TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function tickClause(key: SignableDraft): string {
  return clientDraftInfo(key)?.tickClause || "10";
}

export type SignableDocument = { id: string; title: string; bodyHtml: string; version: number; missing: string[] };

function latestProduced(claimId: string, key: SignableDraft): SignableDocument | null {
  const row = get<{ id: string; title: string; body_html: string | null; version: number; missing_json: string | null }>(
    `SELECT id, title, body_html, version, missing_json FROM documents WHERE claim_id = ? AND template_key = ? ORDER BY version DESC, created_at DESC LIMIT 1`,
    [claimId, key],
  );
  if (!row) return null;
  let missing: string[] = [];
  try {
    missing = row.missing_json ? (JSON.parse(row.missing_json) as string[]) : [];
  } catch {
    missing = [];
  }
  return { id: String(row.id), title: String(row.title), bodyHtml: String(row.body_html || ""), version: Number(row.version) || 1, missing };
}

export type ClientDocumentSignature = { signedAt: string; signerName: string; route: string; signedDocumentId: string };

export function clientDocumentSignature(claimId: string, key: SignableDraft): ClientDocumentSignature | null {
  ready();
  const row = get<{ signed_at: string; signer_name: string; route: string; signed_document_id: string }>(
    `SELECT signed_at, signer_name, route, signed_document_id FROM client_document_signatures WHERE claim_id = ? AND template_key = ? ORDER BY signed_at DESC LIMIT 1`,
    [claimId, key],
  );
  return row ? { signedAt: String(row.signed_at), signerName: String(row.signer_name), route: String(row.route), signedDocumentId: String(row.signed_document_id) } : null;
}

/** Why it cannot be signed yet, or null when the produced version can be signed. */
export function signingRefusal(claimId: string, key: SignableDraft): string | null {
  const title = clientDraftInfo(key)?.title || "This document";
  if (!isDocumentApproved(key)) return `${title} is waiting for Justin's approval of the wording. It cannot be signed yet.`;
  const doc = latestProduced(claimId, key);
  if (!doc) return `Produce ${title} first (First letters). That is the version the client signs.`;
  if (doc.bodyHtml.includes(DRAFT_WORDING_NOT_APPROVED)) return `This version was produced before Justin approved the wording. Produce it again, then it can be signed.`;
  if (doc.missing.length) return `This version was produced with details missing (${doc.missing.join(", ")}). Add them and produce it again.`;
  return null;
}

export function signableDocument(claimId: string, key: SignableDraft): SignableDocument | null {
  return latestProduced(claimId, key);
}

function requireSignable(claimId: string, key: SignableDraft): SignableDocument {
  const refusal = signingRefusal(claimId, key);
  if (refusal) throw new Error(refusal);
  return latestProduced(claimId, key)!;
}

function signerName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Type the client's full name.");
  if (name.length > 120) throw new Error("Keep the name to the full name only.");
  return name;
}

function signatureBuffer(png: string): Buffer {
  const text = png.trim();
  if (!text.startsWith("data:image/png;base64,")) throw new Error("Please draw the signature in the box.");
  if (text.length > MAX_SIGNATURE_CHARS) throw new Error("The signature is too large. Clear it and sign again.");
  const buffer = Buffer.from(text.slice("data:image/png;base64,".length), "base64");
  if (buffer.length < 100) throw new Error("Please draw the signature in the box.");
  return buffer;
}

function requireTicks(key: SignableDraft, agreed: boolean, startNow: boolean) {
  if (!startNow) throw new Error(`The client must tick clause ${tickClause(key)} (starting straight away) to sign.`);
  if (!agreed) throw new Error("The client must tick the box to say they have read and agree to the document.");
}

async function fileSignedPdf(input: {
  claimId: string;
  key: SignableDraft;
  doc: SignableDocument;
  name: string;
  signature: Buffer;
  how: string;
  witness: string | null;
  device: string;
  ip: string;
  actorId: string | null;
  route: "screen" | "link";
}) {
  const signedAt = nowUtcIso();
  const title = clientDraftInfo(input.key)?.title || input.doc.title;
  const pdf = await renderSignedAgreementPdf({
    title: `${title} – signed`,
    agreementHtml: input.doc.bodyHtml,
    signaturePng: input.signature,
    audit: [
      ["Signed by", input.name],
      ["Signed at", `${formatUkDateTime(signedAt)} (UK time)`],
      ["Document", `${input.doc.title}, version ${input.doc.version}`],
      ["Document fingerprint (SHA-256)", sha256(input.doc.bodyHtml)],
      [`Clause ${tickClause(input.key)} (starting straight away)`, "Ticked by the client"],
      ["How", input.how],
      ...(input.witness ? ([["Witnessed by", input.witness]] as Array<[string, string]>) : []),
      ["Device", input.device || "not given"],
      ["Network address", input.ip || "not given"],
    ],
  });
  const stored = storeFileCopy({ relDir: `claims/${input.claimId}/documents`, originalFilename: `${newId("file")}-signed-${input.key}.pdf`, buffer: pdf });
  const documentId = insertStoredDocument({
    title: `Signed ${title}`,
    documentType: `signed_${input.key}`,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: null,
    originalFilename: `signed-${input.key}.pdf`,
    storedRelpath: stored.storedRelpath,
    mimeType: "application/pdf",
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1 WHERE id = ?`, [documentId]);
  run(
    `INSERT INTO client_document_signatures(id, claim_id, template_key, document_id, route, signer_name, signed_at, start_now_ticked, signed_document_id, actor_id, device, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [newId("cds"), input.claimId, input.key, input.doc.id, input.route, input.name, signedAt, documentId, input.actorId, input.device || null, input.ip || null],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: signedAt,
    actorId: input.actorId ?? undefined,
    documentId,
    details: `${input.doc.title} (version ${input.doc.version}) signed by ${input.name} (${input.how}${input.witness ? `, witnessed by ${input.witness}` : ""}). Clause ${tickClause(input.key)} ticked. Filed as Signed ${title}.`,
    source: input.route === "link" ? "client" : "staff",
  });
  return { documentId };
}

/** Signed on CAS's screen (office or the driver's phone), witnessed by the signed-in member of staff. */
export async function signClientDocumentOnScreen(input: {
  claimId: string;
  key: SignableDraft;
  actorId: string;
  name: string;
  signaturePng: string;
  agreed: boolean;
  startNow: boolean;
  device: string;
  ip: string;
}) {
  ready();
  const actor = get<{ id: string; name: string }>(`SELECT id, name FROM staff WHERE id = ? AND active = 1`, [input.actorId]);
  if (!actor) throw new Error("Sign in again.");
  if (clientDocumentSignature(input.claimId, input.key)) throw new Error("This is already signed.");
  const doc = requireSignable(input.claimId, input.key);
  requireTicks(input.key, input.agreed, input.startNow);
  return fileSignedPdf({
    claimId: input.claimId,
    key: input.key,
    doc,
    name: signerName(input.name),
    signature: signatureBuffer(input.signaturePng),
    how: "Signed on CAS's device",
    witness: String(actor.name),
    device: input.device,
    ip: input.ip,
    actorId: actor.id,
    route: "screen",
  });
}

/** The signed paper copy. The signed date recorded is the upload, never earlier. */
export function storeSignedClientDocumentPaper(input: {
  claimId: string;
  key: SignableDraft;
  actorId: string;
  signerName: string;
  startNowTicked: boolean;
  file: { buffer: Buffer; filename: string; mimeType: string };
}) {
  ready();
  if (clientDocumentSignature(input.claimId, input.key)) throw new Error("This is already signed.");
  const doc = requireSignable(input.claimId, input.key);
  if (!input.startNowTicked) throw new Error(`Confirm the client ticked clause ${tickClause(input.key)} (starting straight away) on the paper copy. It cannot be filed as signed without it.`);
  const name = signerName(input.signerName);
  if (!input.file.buffer || input.file.buffer.length < 1) throw new Error("Choose the signed copy to upload.");
  if (input.file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  const mime = claimDocumentMime(input.file.filename, input.file.mimeType);
  if (!mime) throw new Error("Upload a PDF or a photo (JPEG or PNG) of the signed copy.");
  const title = clientDraftInfo(input.key)?.title || doc.title;
  const stored = storeFileCopy({ relDir: `claims/${input.claimId}/documents`, originalFilename: `${newId("file")}-${input.file.filename || "signed.pdf"}`, buffer: input.file.buffer });
  const signedAt = nowUtcIso();
  const documentId = insertStoredDocument({
    title: `Signed ${title}`,
    documentType: `signed_${input.key}`,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: null,
    originalFilename: input.file.filename || "signed.pdf",
    storedRelpath: stored.storedRelpath,
    mimeType: mime,
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1 WHERE id = ?`, [documentId]);
  run(
    `INSERT INTO client_document_signatures(id, claim_id, template_key, document_id, route, signer_name, signed_at, start_now_ticked, signed_document_id, actor_id)
     VALUES (?, ?, ?, ?, 'paper', ?, ?, 1, ?, ?)`,
    [newId("cds"), input.claimId, input.key, doc.id, name, signedAt, documentId, input.actorId],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: signedAt,
    actorId: input.actorId,
    documentId,
    details: `Signed paper copy of ${doc.title} (version ${doc.version}) uploaded, signed by ${name}. Clause ${tickClause(input.key)} ticked on the paper copy. The date recorded is the upload.`,
    source: "staff",
  });
  return { documentId };
}

/** A signing link by email (simulated until the mailbox is live). It works once and expires after seven days. */
export async function sendClientDocumentLink(input: { claimId: string; key: SignableDraft; actorId: string; to: string; origin: string }) {
  ready();
  if (clientDocumentSignature(input.claimId, input.key)) throw new Error("This is already signed.");
  const doc = requireSignable(input.claimId, input.key);
  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter the client's email address.");
  const claim = get<{ file_reference: string; client_name: string | null }>(
    `SELECT c.file_reference, p.full_name AS client_name FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [input.claimId],
  );
  const token = randomBytes(24).toString("base64url");
  const url = `${input.origin.replace(/\/$/, "")}/sign-form/${token}`;
  const title = clientDraftInfo(input.key)?.title || doc.title;
  const sent = await sendClaimEmail({
    claimId: input.claimId,
    actorId: input.actorId,
    to,
    subject: `${title} to sign – ${claim?.file_reference || ""}`,
    body: [`Dear ${claim?.client_name || "client"},`, "", `Please read and sign your ${title.toLowerCase()} using this link:`, url, "", `The link works once and stops working after ${LINK_DAYS} days.`, "", "Complete Accident Solutions Ltd"].join("\n"),
  });
  if (!sent.ok) throw new Error(sent.error || "The signing link was not sent.");
  const now = nowUtcIso();
  run(`UPDATE client_document_links SET status = 'replaced' WHERE claim_id = ? AND template_key = ? AND status = 'sent'`, [input.claimId, input.key]);
  run(
    `INSERT INTO client_document_links(id, claim_id, template_key, document_id, token_sha256, sent_to, requested_by, requested_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
    [newId("cdl"), input.claimId, input.key, doc.id, sha256(token), to, input.actorId, now, new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()],
  );
  return { url, simulated: sent.status === "simulated_sent" };
}

export type ClientDocumentLinkView = { fileReference: string; clientName: string; title: string; key: SignableDraft; bodyHtml: string; tickClause: string };

function linkRow(token: string) {
  ready();
  return get<{ id: string; claim_id: string; template_key: string; document_id: string; status: string; expires_at: string }>(
    `SELECT id, claim_id, template_key, document_id, status, expires_at FROM client_document_links WHERE token_sha256 = ?`,
    [sha256(token)],
  );
}

/** What the client sees behind the link. A used, replaced, expired or out-of-date link is refused in plain words. */
export function openClientDocumentLink(token: string): ClientDocumentLinkView {
  const row = linkRow(token);
  if (!row || !isSignableDraft(row.template_key)) throw new Error("This signing link is not recognised. Please contact Complete Accident Solutions.");
  if (row.status === "signed") throw new Error("This document has already been signed. Thank you.");
  if (row.status !== "sent") throw new Error("This signing link has been replaced by a newer one. Please use the latest email from Complete Accident Solutions.");
  if (row.expires_at < nowUtcIso()) throw new Error("This signing link has expired. Please contact Complete Accident Solutions for a new one.");
  const doc = latestProduced(row.claim_id, row.template_key);
  if (!doc || doc.id !== row.document_id) throw new Error("The document has changed since this link was sent. Please contact Complete Accident Solutions for a new link.");
  const claim = get<{ file_reference: string; client_name: string | null }>(
    `SELECT c.file_reference, p.full_name AS client_name FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [row.claim_id],
  );
  return { fileReference: String(claim?.file_reference || ""), clientName: String(claim?.client_name || ""), title: clientDraftInfo(row.template_key)?.title || doc.title, key: row.template_key, bodyHtml: doc.bodyHtml, tickClause: tickClause(row.template_key) };
}

export async function signClientDocumentWithLink(input: { token: string; name: string; signaturePng: string; agreed: boolean; startNow: boolean; device: string; ip: string }) {
  const view = openClientDocumentLink(input.token);
  const row = linkRow(input.token)!;
  const key = row.template_key as SignableDraft;
  const doc = requireSignable(row.claim_id, key);
  requireTicks(key, input.agreed, input.startNow);
  const result = await fileSignedPdf({
    claimId: row.claim_id,
    key,
    doc,
    name: signerName(input.name),
    signature: signatureBuffer(input.signaturePng),
    how: "Signed by the client through the emailed link",
    witness: null,
    device: input.device,
    ip: input.ip,
    actorId: null,
    route: "link",
  });
  run(`UPDATE client_document_links SET status = 'signed' WHERE id = ?`, [row.id]);
  return { ...result, title: view.title };
}

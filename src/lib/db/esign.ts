import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { formatUkDateTime, nowUtcIso } from "../dates";
import { renderSignedAgreementPdf } from "../documents/signed-pdf";
import { sendOutboundEmail } from "../email/gateway";
import { emailSendMode } from "../email/send-mode";
import { CAS_CLAIMS_MAILBOX } from "../constants";
import { storeFileCopy } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";
import { currentHireEpisode, recordSignedAgreementOnHire, SIGNED_HIRE_AGREEMENT_TYPE } from "./hire-readiness";
import { assertCanRecordHandover } from "./jobs";
import { completeSwapAfterSigning } from "./vehicle-swap";

/**
 * Electronic signing of the credit-hire agreement. Two routes, both satisfying the handover rule:
 *  - link: a one-time link sent to the client by email (simulated until CAS's mailbox is live)
 *  - doorstep: the client signs on the driver's or the office's screen
 * Each request records the agreement version and a fingerprint of its text, who signed, when, and the device.
 * The signed PDF is filed as "Signed hire agreement". A signature is never added on anyone's behalf.
 */

export const LINK_DAYS = 7;
const MAX_SIGNATURE_CHARS = 400_000;

export function ensureEsignTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS esign_requests (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      document_title TEXT NOT NULL,
      document_version INTEGER NOT NULL,
      document_sha256 TEXT NOT NULL,
      route TEXT NOT NULL,
      token_sha256 TEXT,
      sent_to TEXT,
      correspondence_id TEXT,
      requested_by TEXT,
      requested_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL,
      signed_at TEXT,
      signer_name TEXT,
      signature_png TEXT,
      device TEXT,
      ip TEXT,
      witness_staff_id TEXT,
      signed_document_id TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_esign_claim ON esign_requests(claim_id, requested_at);
    CREATE INDEX IF NOT EXISTS idx_esign_token ON esign_requests(token_sha256);
  `);
}

function ready() {
  ensureEsignTable(getDb());
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

type AgreementDoc = { id: string; title: string; version: number; body_html: string; claim_id: string; missing: string[] };

/** The agreement as the client reads and signs it: the CRM's own note about which pages are included is left out. */
export function clientAgreementHtml(html: string): string {
  return html.replace(/<p class="internal-note">[\s\S]*?<\/p>/g, "");
}

/** The agreement version that would be signed now: the latest produced. */
export function latestAgreementDocument(claimId: string): AgreementDoc | null {
  const row = get<{ id: string; title: string | null; version: number; body_html: string | null; claim_id: string; missing_json: string | null }>(
    `SELECT id, title, version, body_html, claim_id, missing_json FROM documents
     WHERE claim_id = ? AND template_key = 'hire_agreement' ORDER BY version DESC, created_at DESC LIMIT 1`,
    [claimId],
  );
  if (!row?.body_html) return null;
  let missing: string[] = [];
  try {
    missing = row.missing_json ? (JSON.parse(String(row.missing_json)) as string[]) : [];
  } catch {
    missing = ["details not readable"];
  }
  return {
    id: String(row.id),
    title: String(row.title || "Hire agreement"),
    version: Number(row.version) || 1,
    body_html: clientAgreementHtml(String(row.body_html)),
    claim_id: String(row.claim_id),
    missing,
  };
}

function claimFacts(claimId: string) {
  return get<{ claim_type: string; file_reference: string; client_name: string | null; email: string | null }>(
    `SELECT c.claim_type, c.file_reference, p.full_name AS client_name, p.email
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
}

function requireAgreement(claimId: string): AgreementDoc {
  const claim = claimFacts(claimId);
  if (!claim) throw new Error("File not found.");
  if (claim.claim_type === "fault") throw new Error("A courtesy car has no agreement to sign yet.");
  if (!currentHireEpisode(claimId)?.fleet_vehicle_id) throw new Error("Choose a car first.");
  const doc = latestAgreementDocument(claimId);
  if (!doc) throw new Error("Produce the agreement for signature first. That is the version the client signs.");
  if (doc.missing.length > 0) throw new Error("This agreement was produced with details missing. Produce a new version for signature first.");
  return doc;
}

export type EsignView = {
  id: string;
  route: "link" | "doorstep";
  status: string;
  documentTitle: string;
  documentVersion: number;
  sentTo: string | null;
  requestedAt: string;
  expiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signedDocumentId: string | null;
  witnessName: string | null;
};

export function latestEsign(claimId: string): EsignView | null {
  ready();
  const row = get<{
    id: string;
    route: string;
    status: string;
    document_title: string;
    document_version: number;
    sent_to: string | null;
    requested_at: string;
    expires_at: string | null;
    signed_at: string | null;
    signer_name: string | null;
    signed_document_id: string | null;
    witness_name: string | null;
  }>(
    `SELECT e.id, e.route, e.status, e.document_title, e.document_version, e.sent_to, e.requested_at, e.expires_at,
            e.signed_at, e.signer_name, e.signed_document_id, s.name AS witness_name
     FROM esign_requests e LEFT JOIN staff s ON s.id = e.witness_staff_id
     WHERE e.claim_id = ? ORDER BY e.requested_at DESC, e.rowid DESC LIMIT 1`,
    [claimId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    route: row.route === "doorstep" ? "doorstep" : "link",
    status: String(row.status),
    documentTitle: String(row.document_title),
    documentVersion: Number(row.document_version),
    sentTo: row.sent_to ? String(row.sent_to) : null,
    requestedAt: String(row.requested_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    signedAt: row.signed_at ? String(row.signed_at) : null,
    signerName: row.signer_name ? String(row.signer_name) : null,
    signedDocumentId: row.signed_document_id ? String(row.signed_document_id) : null,
    witnessName: row.witness_name ? String(row.witness_name) : null,
  };
}

function cleanEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the client's email address.");
  return email;
}

/** Sends a one-time signing link. Any earlier unsigned link on this file stops working. */
export async function sendSigningLink(input: { claimId: string; actorId: string; to: string; origin: string }) {
  ready();
  const doc = requireAgreement(input.claimId);
  const claim = claimFacts(input.claimId)!;
  const to = cleanEmail(input.to);
  const token = randomBytes(24).toString("base64url");
  const url = `${input.origin.replace(/\/$/, "")}/sign/${token}`;
  const subject = `Your hire agreement to sign – ${claim.file_reference}`;
  const body = [
    `Dear ${claim.client_name || "client"},`,
    "",
    `Please read and sign your hire agreement (${doc.title}) using this link:`,
    url,
    "",
    `The link works once and stops working after ${LINK_DAYS} days.`,
    "",
    "Complete Accident Solutions Ltd",
  ].join("\n");
  const sent = await sendOutboundEmail({ to, subject, body });
  const now = nowUtcIso();
  if (!sent.ok) throw new Error(`The signing link was not sent. ${sent.error}`);
  const simulated = sent.status === "simulated_sent";
  run(`UPDATE esign_requests SET status = 'replaced', closed_at = ? WHERE claim_id = ? AND status = 'sent'`, [now, input.claimId]);
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, 'hire_agreement_signing_link', ?)`,
    [correspondenceId, input.claimId, subject, body.slice(0, 180), body, to, CAS_CLAIMS_MAILBOX, sent.status, now],
  );
  const id = newId("esign");
  run(
    `INSERT INTO esign_requests(id, claim_id, document_id, document_title, document_version, document_sha256, route, token_sha256,
       sent_to, correspondence_id, requested_by, requested_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'link', ?, ?, ?, ?, ?, ?, 'sent')`,
    [
      id,
      input.claimId,
      doc.id,
      doc.title,
      doc.version,
      sha256(doc.body_html),
      sha256(token),
      to,
      correspondenceId,
      input.actorId,
      now,
      new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString(),
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: now,
    actorId: input.actorId,
    channel: "email",
    correspondenceId,
    details: `Signing link for ${doc.title} (version ${doc.version}) sent to ${to}${simulated ? " (simulated, not sent to a real mailbox)" : ""}. It works once and expires after ${LINK_DAYS} days.`,
    source: "staff",
  });
  return { id, url, simulated };
}

export type LinkSigningView = {
  claimId: string;
  fileReference: string;
  clientName: string;
  documentTitle: string;
  documentVersion: number;
  agreementHtml: string;
};

function linkRow(token: string) {
  ready();
  return get<{ id: string; claim_id: string; document_id: string; document_version: number; status: string; expires_at: string | null }>(
    `SELECT id, claim_id, document_id, document_version, status, expires_at FROM esign_requests WHERE token_sha256 = ? AND route = 'link'`,
    [sha256(token)],
  );
}

/** What the client sees behind the link. Refuses a used, replaced, expired or out-of-date link in plain words. */
export function openSigningLink(token: string): LinkSigningView {
  const row = linkRow(token);
  if (!row) throw new Error("This signing link is not recognised. Please contact Complete Accident Solutions.");
  if (row.status === "signed") throw new Error("This agreement has already been signed. Thank you.");
  if (row.status !== "sent") throw new Error("This signing link has been replaced. Please use the newest link from Complete Accident Solutions.");
  if (row.expires_at && row.expires_at < nowUtcIso()) throw new Error("This signing link has expired. Please contact Complete Accident Solutions for a new one.");
  const latest = latestAgreementDocument(row.claim_id);
  if (!latest || latest.id !== row.document_id) {
    throw new Error("The agreement has changed since this link was sent. Please contact Complete Accident Solutions for a new link.");
  }
  const claim = claimFacts(row.claim_id)!;
  return {
    claimId: row.claim_id,
    fileReference: String(claim.file_reference),
    clientName: String(claim.client_name || ""),
    documentTitle: latest.title,
    documentVersion: latest.version,
    agreementHtml: latest.body_html,
  };
}

function signatureBuffer(png: string): Buffer {
  const text = png.trim();
  if (!text.startsWith("data:image/png;base64,")) throw new Error("Please draw your signature in the box.");
  if (text.length > MAX_SIGNATURE_CHARS) throw new Error("The signature is too large. Clear it and sign again.");
  const buffer = Buffer.from(text.slice("data:image/png;base64,".length), "base64");
  if (buffer.length < 100) throw new Error("Please draw your signature in the box.");
  return buffer;
}

function signerName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Type your full name.");
  if (name.length > 120) throw new Error("Keep the name to the full name only.");
  return name;
}

async function fileSignedPdf(input: {
  requestId: string;
  claimId: string;
  doc: AgreementDoc;
  name: string;
  signature: Buffer;
  signedAt: string;
  route: "link" | "doorstep";
  device: string;
  ip: string;
  witness: string | null;
  actorId: string | null;
}): Promise<string> {
  const routeWords = input.route === "link" ? "Signing link sent by email, signed on the client's own device" : "Signed at the handover on CAS's device";
  const pdf = await renderSignedAgreementPdf({
    title: `${input.doc.title} – signed`,
    agreementHtml: input.doc.body_html,
    signaturePng: input.signature,
    audit: [
      ["Signed by", input.name],
      ["Signed at", `${formatUkDateTime(input.signedAt)} (UK time)`],
      ["Document", `${input.doc.title}, version ${input.doc.version}`],
      ["Document fingerprint (SHA-256)", sha256(input.doc.body_html)],
      ["How", routeWords],
      ...(input.witness ? ([["Witnessed by", input.witness]] as Array<[string, string]>) : []),
      ["Device", input.device || "not given"],
      ["Network address", input.ip || "not given"],
      ["Signing record", input.requestId],
    ],
  });
  const episode = currentHireEpisode(input.claimId);
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/documents`,
    originalFilename: `${newId("file")}-signed-hire-agreement.pdf`,
    buffer: pdf,
  });
  const documentId = insertStoredDocument({
    title: "Signed hire agreement",
    documentType: SIGNED_HIRE_AGREEMENT_TYPE,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: episode?.fleet_vehicle_id || null,
    originalFilename: "signed-hire-agreement.pdf",
    storedRelpath: stored.storedRelpath,
    mimeType: "application/pdf",
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1, version = ? WHERE id = ?`, [input.doc.version, documentId]);
  return documentId;
}

function afterSigning(input: {
  claimId: string;
  requestId: string;
  documentId: string;
  doc: AgreementDoc;
  name: string;
  route: "link" | "doorstep";
  witness: string | null;
  actorId: string | null;
  signedAt: string;
}) {
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: input.signedAt,
    actorId: input.actorId || undefined,
    documentId: input.documentId,
    details: `${input.doc.title} (version ${input.doc.version}) signed electronically by ${input.name}${
      input.route === "link" ? " using the signing link" : ` at the handover${input.witness ? `, witnessed by ${input.witness}` : ""}`
    }. The signed PDF is filed as Signed hire agreement.`,
    source: input.route === "link" ? "client" : "staff",
  });
  // R26: signing the agreement for a replacement car completes the swap.
  if (completeSwapAfterSigning({ claimId: input.claimId, agreementDocumentId: input.doc.id, signedDocumentId: input.documentId, actorId: input.actorId })) return;
  const episode = currentHireEpisode(input.claimId);
  if (episode?.started_at) recordSignedAgreementOnHire(input.claimId, new Date(episode.started_at).toISOString().slice(0, 10));
}

/** The client signs through the link. No CAS login is involved. */
export async function signWithLink(input: { token: string; name: string; signaturePng: string; agreed: boolean; device: string; ip: string }) {
  const view = openSigningLink(input.token);
  if (!input.agreed) throw new Error("Tick the box to say you have read and agree to the agreement.");
  const name = signerName(input.name);
  const signature = signatureBuffer(input.signaturePng);
  const row = linkRow(input.token)!;
  const doc = latestAgreementDocument(view.claimId)!;
  const signedAt = nowUtcIso();
  const documentId = await fileSignedPdf({
    requestId: row.id,
    claimId: view.claimId,
    doc,
    name,
    signature,
    signedAt,
    route: "link",
    device: input.device.slice(0, 300),
    ip: input.ip.slice(0, 100),
    witness: null,
    actorId: null,
  });
  run(
    `UPDATE esign_requests SET status = 'signed', signed_at = ?, signer_name = ?, signature_png = ?, device = ?, ip = ?, signed_document_id = ?, closed_at = ?
     WHERE id = ? AND status = 'sent'`,
    [signedAt, name, input.signaturePng, input.device.slice(0, 300), input.ip.slice(0, 100), documentId, signedAt, row.id],
  );
  afterSigning({ claimId: view.claimId, requestId: row.id, documentId, doc, name, route: "link", witness: null, actorId: null, signedAt });
  return { documentId };
}

/** The client signs on the driver's phone at the doorstep, or on an office screen. The person holding the device is recorded. */
export async function signAtDoorstep(input: {
  claimId: string;
  actorId: string;
  name: string;
  signaturePng: string;
  agreed: boolean;
  device: string;
  ip: string;
}) {
  ready();
  const actor = get<{ id: string; role: string; name: string }>(`SELECT id, role, name FROM staff WHERE id = ? AND active = 1`, [input.actorId]);
  if (!actor) throw new Error("Sign in again.");
  assertCanRecordHandover({ id: actor.id, role: actor.role }, input.claimId, currentHireEpisode(input.claimId)?.id || null);
  const doc = requireAgreement(input.claimId);
  if (!input.agreed) throw new Error("The client must tick the box to say they have read and agree to the agreement.");
  const name = signerName(input.name);
  const signature = signatureBuffer(input.signaturePng);
  const id = newId("esign");
  const signedAt = nowUtcIso();
  const documentId = await fileSignedPdf({
    requestId: id,
    claimId: input.claimId,
    doc,
    name,
    signature,
    signedAt,
    route: "doorstep",
    device: input.device.slice(0, 300),
    ip: input.ip.slice(0, 100),
    witness: String(actor.name),
    actorId: actor.id,
  });
  run(`UPDATE esign_requests SET status = 'replaced', closed_at = ? WHERE claim_id = ? AND status = 'sent'`, [signedAt, input.claimId]);
  run(
    `INSERT INTO esign_requests(id, claim_id, document_id, document_title, document_version, document_sha256, route, requested_by, requested_at,
       status, signed_at, signer_name, signature_png, device, ip, witness_staff_id, signed_document_id, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'doorstep', ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      doc.id,
      doc.title,
      doc.version,
      sha256(doc.body_html),
      actor.id,
      signedAt,
      signedAt,
      name,
      input.signaturePng,
      input.device.slice(0, 300),
      input.ip.slice(0, 100),
      actor.id,
      documentId,
      signedAt,
    ],
  );
  afterSigning({ claimId: input.claimId, requestId: id, documentId, doc, name, route: "doorstep", witness: String(actor.name), actorId: actor.id, signedAt });
  return { documentId };
}

export function esignHistory(claimId: string) {
  ready();
  return all<{ id: string; route: string; status: string; requested_at: string; signed_at: string | null; signer_name: string | null }>(
    `SELECT id, route, status, requested_at, signed_at, signer_name FROM esign_requests WHERE claim_id = ? ORDER BY requested_at`,
    [claimId],
  );
}

export function emailIsSimulated(): boolean {
  return emailSendMode() !== "live";
}

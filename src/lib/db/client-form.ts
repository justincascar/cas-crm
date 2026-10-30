import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, nowUtcIso } from "../dates";
import { claimDocumentMime } from "../domain/claim-documents";
import { CAS_CLAIMS_MAILBOX } from "../constants";
import { sendOutboundEmail } from "../email/gateway";
import { liveEmailSending } from "../email/send-mode";
import { PRIVACY_NOTICE_APPROVED, privacyNoticeLine } from "../documents/privacy-notice";
import { readStoredFile, storeFileCopy } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { storeClaimDocument } from "./claim-documents";
import { readScreenRow, writeScreenIfCurrent } from "./record-version";

/**
 * The client's secure form (J14). Staff make a link for one claim; the client opens it on a phone with no CAS login,
 * types their details, uploads photos and documents, saves and comes back, and sends it. The link shows only what that
 * client entered, never the claim itself. Nothing the client types or uploads touches the claim until a member of staff
 * reviews it: each proposed change is applied only when ticked, and each upload is added to the claim only when
 * accepted. Uploads are held apart from the claim's documents until then.
 */

export const CLIENT_LINK_DAYS = 30;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_UPLOADS = 20;

/** The fields the client can fill in. Those with "applies" can be copied onto the claim by staff. */
export const CLIENT_FORM_FIELDS = [
  { name: "mobile", label: "Mobile number", section: "Your details", applies: "people.mobile_tel", screen: "client.telMobile" },
  { name: "email", label: "Email address", section: "Your details", applies: "people.email", screen: "client.email" },
  { name: "address", label: "Address", section: "Your details", applies: "people.address_line1", screen: "client.address", long: true },
  { name: "postcode", label: "Postcode", section: "Your details", applies: "people.postcode", screen: "client.postcode" },
  { name: "accidentWhere", label: "Where did the accident happen?", need: "Where the accident happened", section: "The accident", applies: "claims.accident_location", screen: "accident.location" },
  { name: "accidentWhat", label: "What happened?", need: "What happened", section: "The accident", applies: "claims.circumstances", screen: "accident.details", long: true },
  { name: "otherDriver", label: "The other driver's name", section: "The other vehicle", applies: null, screen: null },
  { name: "otherRegistration", label: "The other vehicle's registration", section: "The other vehicle", applies: null, screen: null },
  { name: "otherInsurer", label: "The other driver's insurer, if you know it", section: "The other vehicle", applies: null, screen: null },
] as const;

export const CLIENT_UPLOAD_KINDS = [
  { value: "photo", label: "Photo of the damage" },
  { value: "driving_licence", label: "Driving licence" },
  { value: "insurance_certificate", label: "Insurance certificate" },
  { value: "v5c_client", label: "V5C (logbook)" },
  { value: "other", label: "Something else" },
] as const;

export function ensureClientFormTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_form_links (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      token_sha256 TEXT NOT NULL UNIQUE,
      created_by TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'not_started',
      saved_at TEXT,
      submitted_at TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS client_form_uploads (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES client_form_links(id) ON DELETE CASCADE,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_relpath TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL,
      decision TEXT,
      decided_by TEXT,
      decided_at TEXT,
      document_id TEXT
    );
  `);
}

function ready() {
  ensureClientFormTables(getDb());
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Makes a new link for the claim. Only its fingerprint is stored, so the link itself is seen only in the email that
 * carries it. One link works at a time: an earlier link is switched off, and what the client had entered and uploaded
 * on it moves to the new one, so nothing they did is lost.
 */
export function createClientLink(input: { claimId: string; actorId: string; details?: string; token?: string }): { token: string; expiresAt: string } {
  ready();
  const token = input.token || randomBytes(24).toString("base64url");
  const now = nowUtcIso();
  const expiresAt = new Date(Date.now() + CLIENT_LINK_DAYS * 86_400_000).toISOString();
  const earlier = get<{ id: string; data_json: string; status: string; saved_at: string | null; submitted_at: string | null }>(
    `SELECT id, data_json, status, saved_at, submitted_at FROM client_form_links WHERE claim_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [input.claimId],
  );
  const id = newId("clientlink");
  run(
    `INSERT INTO client_form_links(id, claim_id, token_sha256, created_by, created_at, expires_at, data_json, status, saved_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, sha256(token), input.actorId, now, expiresAt, earlier?.data_json || "{}", earlier?.status || "not_started", earlier?.saved_at ?? null, earlier?.submitted_at ?? null],
  );
  if (earlier) {
    run(`UPDATE client_form_links SET revoked_at = ? WHERE claim_id = ? AND id != ? AND revoked_at IS NULL`, [now, input.claimId, id]);
    run(`UPDATE client_form_uploads SET link_id = ? WHERE claim_id = ?`, [id, input.claimId]);
  }
  run(`UPDATE claims SET client_form_status = COALESCE(NULLIF(?, 'not_started'), 'link_made') WHERE id = ?`, [earlier?.status || "not_started", input.claimId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "client_form_link_made",
    occurredAt: now,
    actorId: input.actorId,
    details:
      input.details ||
      `Client form link made. It works for ${CLIENT_LINK_DAYS} days and shows the client only what they enter. Nothing they send changes the claim until staff review it.${earlier ? " The earlier link no longer works; what the client had entered is kept." : ""}`,
    source: "staff",
  });
  return { token, expiresAt };
}

/** Emails the client a new link and files the email on the claim. In the prototype the email is simulated. */
export async function sendClientLink(input: { claimId: string; actorId: string; to: string; origin: string }) {
  ready();
  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter the client's email address.");
  // J15: the client form cannot go to a real client while the privacy notice is a placeholder.
  if (liveEmailSending() && !PRIVACY_NOTICE_APPROVED) throw new Error("The client form cannot be sent to a real client until the privacy notice wording is approved (J9a).");
  const claim = get<{ file_reference: string; full_name: string | null }>(
    `SELECT c.file_reference, p.full_name FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [input.claimId],
  );
  if (!claim) throw new Error("File not found.");
  // The token is made first so the email can carry it; if the email fails the new link is switched off again.
  const before = get<{ id: string }>(`SELECT id FROM client_form_links WHERE claim_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, [input.claimId]);
  const token = randomBytes(24).toString("base64url");
  const url = `${input.origin.replace(/\/$/, "")}/c/${token}`;
  const subject = `Your claim details – ${claim.file_reference}`;
  const body = [
    `Dear ${claim.full_name || "client"},`,
    "",
    "Please use this secure link to give us your details and add photos of the damage and your papers:",
    url,
    "",
    `You can save and come back to it. The link works for ${CLIENT_LINK_DAYS} days and only shows what you enter.`,
    "",
    "Complete Accident Solutions Ltd",
    "",
    privacyNoticeLine(input.origin),
  ].join("\n");
  const sent = await sendOutboundEmail({ to, subject, body });
  if (!sent.ok) throw new Error(`The client form link was not sent. ${sent.error}`);
  const simulated = sent.status === "simulated_sent";
  const now = nowUtcIso();
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, 'client_form_link', ?)`,
    [correspondenceId, input.claimId, subject, body.slice(0, 180), body, to, CAS_CLAIMS_MAILBOX, sent.status, now],
  );
  createClientLink({
    claimId: input.claimId,
    actorId: input.actorId,
    token,
    details: `Client form link sent to ${to}${simulated ? " (simulated, not sent to a real mailbox)" : ""}. It works for ${CLIENT_LINK_DAYS} days and shows the client only what they enter. Nothing they send changes the claim until staff review it.${before ? " The earlier link no longer works; what the client had entered is kept." : ""}`,
  });
  return { simulated, correspondenceId };
}

export function revokeClientLink(input: { claimId: string; actorId: string; linkId: string }) {
  ready();
  run(`UPDATE client_form_links SET revoked_at = ? WHERE id = ? AND claim_id = ? AND revoked_at IS NULL`, [nowUtcIso(), input.linkId, input.claimId]);
  recordClaimEvent({ claimId: input.claimId, eventType: "client_form_link_off", occurredAt: nowUtcIso(), actorId: input.actorId, details: "Client form link switched off.", source: "staff" });
}

type LinkRow = {
  id: string;
  claim_id: string;
  expires_at: string;
  revoked_at: string | null;
  data_json: string;
  status: string;
  saved_at: string | null;
  submitted_at: string | null;
};

/** The link behind a token, or a plain refusal. */
function openLink(token: string): LinkRow {
  ready();
  const row = get<LinkRow>(
    `SELECT id, claim_id, expires_at, revoked_at, data_json, status, saved_at, submitted_at FROM client_form_links WHERE token_sha256 = ?`,
    [sha256(String(token || ""))],
  );
  if (!row) throw new Error("This link is not recognised. Please contact Complete Accident Solutions for a new one.");
  if (row.revoked_at) throw new Error("This link has been switched off. Please contact Complete Accident Solutions for a new one.");
  if (row.expires_at < nowUtcIso()) throw new Error("This link has expired. Please contact Complete Accident Solutions for a new one.");
  return row;
}

function parse(json: string): Record<string, string> {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    return {};
  }
}

export type ClientFormView = {
  firstName: string;
  fileReference: string;
  values: Record<string, string>;
  status: string;
  savedAt: string | null;
  submittedAt: string | null;
  uploads: Array<{ id: string; kind: string; filename: string; uploadedAt: string }>;
  /** What the client has not given yet, worked out only from their own answers and uploads. */
  stillNeeded: string[];
};

/**
 * What the client sees: their own answers and the names of their own uploads, plus their first name and file
 * reference so they know it is theirs. Nothing else from the claim.
 */
export function clientFormView(token: string): ClientFormView {
  return withStillNeeded(clientFormViewRaw(token));
}

function clientFormViewRaw(token: string): ClientFormView {
  const link = openLink(token);
  const claim = get<{ file_reference: string; full_name: string | null }>(
    `SELECT c.file_reference, p.full_name FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [link.claim_id],
  );
  return {
    firstName: String(claim?.full_name || "").trim().split(/\s+/)[0] || "",
    fileReference: String(claim?.file_reference || ""),
    values: parse(link.data_json),
    status: link.status,
    savedAt: link.saved_at,
    submittedAt: link.submitted_at,
    uploads: all<{ id: string; kind: string; original_filename: string; uploaded_at: string }>(
      `SELECT id, kind, original_filename, uploaded_at FROM client_form_uploads WHERE link_id = ? ORDER BY uploaded_at`,
      [link.id],
    ).map((row) => ({ id: String(row.id), kind: String(row.kind), filename: String(row.original_filename), uploadedAt: String(row.uploaded_at) })),
    stillNeeded: [],
  };
}

function withStillNeeded(view: ClientFormView): ClientFormView {
  const answers = CLIENT_FORM_FIELDS.filter((field) => field.applies && !String(view.values[field.name] || "").trim()).map((field) => ("need" in field ? field.need : field.label));
  const papers = CLIENT_UPLOAD_KINDS.filter((kind) => kind.value !== "other" && !view.uploads.some((upload) => upload.kind === kind.value)).map((kind) => kind.label);
  return { ...view, stillNeeded: [...answers, ...papers] };
}

/** The client saves (and comes back later), or sends it for review. Only the listed fields are kept. */
export function saveClientForm(input: { token: string; values: Record<string, string>; send: boolean }) {
  const link = openLink(input.token);
  const kept: Record<string, string> = {};
  for (const field of CLIENT_FORM_FIELDS) kept[field.name] = String(input.values[field.name] ?? "").trim().slice(0, field.name === "accidentWhat" || field.name === "address" ? 2000 : 200);
  const now = nowUtcIso();
  // Once sent, a later save keeps it with staff; the review shows the latest answers.
  const status = input.send || link.status === "submitted" ? "submitted" : "draft";
  run(`UPDATE client_form_links SET data_json = ?, status = ?, saved_at = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END WHERE id = ?`, [
    JSON.stringify(kept),
    status,
    now,
    status,
    now,
    link.id,
  ]);
  run(`UPDATE claims SET client_form_status = ? WHERE id = ?`, [status, link.claim_id]);
  if (input.send) {
    recordClaimEvent({
      claimId: link.claim_id,
      eventType: "client_form_sent",
      occurredAt: now,
      details: link.status === "submitted" ? "The client sent changes to their form. Staff review them before anything changes on the claim." : "The client sent their form. Staff review it before anything changes on the claim.",
      source: "client",
    });
    if (!get(`SELECT id FROM tasks WHERE claim_id = ? AND title = ? AND status = 'open'`, [link.claim_id, REVIEW_TASK])) {
      const handler = get<{ handler_id: string | null }>(`SELECT handler_id FROM claims WHERE id = ?`, [link.claim_id]);
      run(
        `INSERT INTO tasks(id, claim_id, handler_id, title, details, type, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'other', ?, 'open', ?)`,
        [newId("task"), link.claim_id, handler?.handler_id || null, REVIEW_TASK, "The client sent their form. Check their answers and uploads on the Documents tab before anything changes on the claim.", now, now],
      );
    }
  }
}

/** A question label as a plain name for the history: "What happened?" becomes "What happened". */
function plainLabel(field: ClientField): string {
  return "need" in field ? field.need : field.label;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

const REVIEW_TASK = "Review the client's form";

/** A photo or document from the client. Held apart from the claim's documents until staff accept it. */
export function uploadClientFile(input: { token: string; kind: string; file: { buffer: Buffer; filename: string; mimeType: string } }) {
  const link = openLink(input.token);
  if (!CLIENT_UPLOAD_KINDS.some((item) => item.value === input.kind)) throw new Error("Choose what the file is.");
  if (!input.file.buffer?.length) throw new Error("Choose a photo or document to add.");
  if (input.file.buffer.length > MAX_UPLOAD_BYTES) throw new Error("Each file must be 12 MB or smaller.");
  let mime = "";
  try {
    mime = claimDocumentMime(input.file.filename || "file", input.file.mimeType);
  } catch {
    throw new Error("Please add a photo (JPEG, PNG, WebP or GIF) or a PDF. On an iPhone, choose the photo from your library and it is sent as a JPEG.");
  }
  const count = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM client_form_uploads WHERE link_id = ?`, [link.id])?.n || 0);
  if (count >= MAX_UPLOADS) throw new Error(`You can add up to ${MAX_UPLOADS} files. Please contact us if you need to send more.`);
  const filename = (input.file.filename || "").trim() || "upload";
  const stored = storeFileCopy({ relDir: `claims/${link.claim_id}/client-uploads`, originalFilename: `${newId("file")}-${filename}`, buffer: input.file.buffer });
  run(
    `INSERT INTO client_form_uploads(id, link_id, claim_id, kind, original_filename, stored_relpath, mime_type, byte_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("clientupload"), link.id, link.claim_id, input.kind, filename.slice(0, 200), stored.storedRelpath, mime, stored.byteSize, nowUtcIso()],
  );
  run(`UPDATE client_form_links SET saved_at = ?, status = CASE WHEN status = 'not_started' THEN 'draft' ELSE status END WHERE id = ?`, [nowUtcIso(), link.id]);
}

export type ClientReview = {
  links: Array<{ id: string; createdAt: string; expiresAt: string; revoked: boolean; status: string; savedAt: string | null; submittedAt: string | null }>;
  latest: { linkId: string; status: string; submittedAt: string | null } | null;
  proposals: Array<{ name: string; label: string; current: string; proposed: string; applies: boolean; same: boolean }>;
  uploads: Array<{ id: string; kind: string; kindValue: string; filename: string; uploadedAt: string; decision: string | null; documentId: string | null }>;
};

type ClientField = (typeof CLIENT_FORM_FIELDS)[number];

/** What the claim holds now: the saved screen if staff have saved it, otherwise the claim record. */
function currentValue(claimId: string, field: ClientField): string {
  const { applies, screen } = field;
  if (!applies || !screen) return "";
  const [screenKey, key] = screen.split(".");
  const saved = readScreenRow(claimId, screenKey);
  if (saved) {
    const value = String((JSON.parse(saved.data_json) as Record<string, unknown>)[key] ?? "").trim();
    if (value) return value;
  }
  const [table, column] = applies.split(".");
  if (table === "people") {
    return String(get<Record<string, string | null>>(`SELECT p.${column} AS v FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`, [claimId])?.v || "");
  }
  return String(get<Record<string, string | null>>(`SELECT ${column} AS v FROM claims WHERE id = ?`, [claimId])?.v || "");
}

/** For staff: the client's latest answers beside what is on the claim, and the uploads waiting for a decision. */
export function clientReview(claimId: string): ClientReview {
  ready();
  const links = all<{ id: string; created_at: string; expires_at: string; revoked_at: string | null; status: string; saved_at: string | null; submitted_at: string | null; data_json: string }>(
    `SELECT id, created_at, expires_at, revoked_at, status, saved_at, submitted_at, data_json FROM client_form_links WHERE claim_id = ? ORDER BY created_at DESC`,
    [claimId],
  );
  const latest = links.find((link) => link.status === "submitted" || link.status === "draft") || null;
  const values = latest ? parse(latest.data_json) : {};
  return {
    links: links.map((link) => ({
      id: String(link.id),
      createdAt: String(link.created_at),
      expiresAt: String(link.expires_at),
      revoked: Boolean(link.revoked_at),
      status: String(link.status),
      savedAt: link.saved_at,
      submittedAt: link.submitted_at,
    })),
    latest: latest ? { linkId: String(latest.id), status: String(latest.status), submittedAt: latest.submitted_at } : null,
    proposals: CLIENT_FORM_FIELDS.filter((field) => String(values[field.name] || "").trim()).map((field) => {
      const current = currentValue(claimId, field);
      const proposed = String(values[field.name]).trim();
      return { name: field.name, label: field.label, current, proposed, applies: Boolean(field.applies), same: current.trim().toLowerCase() === proposed.toLowerCase() };
    }),
    uploads: all<{ id: string; kind: string; original_filename: string; uploaded_at: string; decision: string | null; document_id: string | null }>(
      `SELECT id, kind, original_filename, uploaded_at, decision, document_id FROM client_form_uploads WHERE claim_id = ? ORDER BY uploaded_at`,
      [claimId],
    ).map((row) => ({
      id: String(row.id),
      kind: CLIENT_UPLOAD_KINDS.find((item) => item.value === row.kind)?.label || String(row.kind),
      kindValue: String(row.kind),
      filename: String(row.original_filename),
      uploadedAt: String(row.uploaded_at),
      decision: row.decision ? String(row.decision) : null,
      documentId: row.document_id ? String(row.document_id) : null,
    })),
  };
}

/**
 * Staff apply only the ticked proposals. Each change is written to the history with its old and new value. Fields
 * without a place on the claim (the other vehicle) are put on the history as a note for staff to enter.
 */
export function applyClientProposals(input: { claimId: string; actorId: string; linkId: string; fields: string[] }) {
  ready();
  const link = get<{ id: string; data_json: string }>(`SELECT id, data_json FROM client_form_links WHERE id = ? AND claim_id = ?`, [input.linkId, input.claimId]);
  if (!link) throw new Error("That client form is not on this claim.");
  const values = parse(link.data_json);
  const changes: string[] = [];
  const notes: string[] = [];
  const screens: Record<string, { stored: Record<string, string>; labels: Record<string, string> }> = {};
  for (const field of CLIENT_FORM_FIELDS) {
    if (!input.fields.includes(field.name)) continue;
    const proposed = String(values[field.name] || "").trim();
    if (!proposed) continue;
    if (!field.applies) {
      notes.push(`${plainLabel(field)}: ${proposed}`);
      continue;
    }
    const before = currentValue(input.claimId, field);
    if (before === proposed) continue;
    const [table, column] = field.applies.split(".");
    if (table === "people") {
      run(`UPDATE people SET ${column} = ? WHERE id = (SELECT client_person_id FROM claims WHERE id = ?)`, [proposed, input.claimId]);
    } else {
      run(`UPDATE claims SET ${column} = ? WHERE id = ?`, [proposed, input.claimId]);
    }
    // The saved screen is updated too, through the same versioned save staff use, so the screen shows the new value,
    // the change is in the audit log, and anyone with that screen open is told it changed rather than overwriting it.
    const [screenKey, key] = field.screen.split(".");
    (screens[screenKey] ||= { stored: {}, labels: {} }).stored[key] = proposed;
    screens[screenKey].labels[key] = field.label;
    changes.push(`${plainLabel(field)}: ${before || "blank"} → ${proposed}`);
  }
  if (!changes.length && !notes.length) throw new Error("Tick at least one of the client's answers that differs from the claim.");
  for (const [screenKey, screen] of Object.entries(screens)) {
    writeScreenIfCurrent({
      claimId: input.claimId,
      screenKey,
      expected: readScreenRow(input.claimId, screenKey)?.updated_at || "",
      actorId: input.actorId,
      stored: screen.stored,
      labels: screen.labels,
    });
  }
  const now = nowUtcIso();
  run(`UPDATE client_form_links SET reviewed_at = ?, reviewed_by = ? WHERE id = ?`, [now, input.actorId, link.id]);
  run(`UPDATE claims SET client_form_status = 'reviewed' WHERE id = ?`, [input.claimId]);
  run(`UPDATE tasks SET status = 'done' WHERE claim_id = ? AND title = ? AND status = 'open'`, [input.claimId, REVIEW_TASK]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "client_form_reviewed",
    occurredAt: now,
    actorId: input.actorId,
    details: [
      changes.length ? sentence(`Client form reviewed. Applied to the claim: ${changes.join("; ")}`) : "Client form reviewed.",
      notes.length ? sentence(`Noted from the client, for staff to enter where it belongs: ${notes.join("; ")}`) : "",
    ]
      .filter(Boolean)
      .join(" "),
    source: "staff",
  });
}

/** Staff accept an upload onto the claim as a document of the chosen type, or reject it. */
export function decideClientUpload(input: { claimId: string; actorId: string; actorRole: string; uploadId: string; accept: boolean; documentType: string }) {
  ready();
  const upload = get<{ id: string; kind: string; original_filename: string; stored_relpath: string; mime_type: string; decision: string | null }>(
    `SELECT id, kind, original_filename, stored_relpath, mime_type, decision FROM client_form_uploads WHERE id = ? AND claim_id = ?`,
    [input.uploadId, input.claimId],
  );
  if (!upload) throw new Error("That upload is not on this claim.");
  if (upload.decision) return;
  const now = nowUtcIso();
  if (!input.accept) {
    run(`UPDATE client_form_uploads SET decision = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?`, [input.actorId, now, upload.id]);
    recordClaimEvent({ claimId: input.claimId, eventType: "client_upload_rejected", occurredAt: now, actorId: input.actorId, details: `Client upload not added to the claim: ${upload.original_filename}.`, source: "staff" });
    return;
  }
  // Filed the same way as a staff upload, so the paper chase for that document clears in the usual way.
  const { id: documentId } = storeClaimDocument({
    claimId: input.claimId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    documentType: input.documentType || defaultDocumentType(upload.kind),
    title: `From the client: ${upload.original_filename}`,
    file: { buffer: readStoredFile(upload.stored_relpath).buffer, filename: upload.original_filename, mimeType: upload.mime_type },
  });
  run(`UPDATE client_form_uploads SET decision = 'accepted', decided_by = ?, decided_at = ?, document_id = ? WHERE id = ?`, [input.actorId, now, documentId, upload.id]);
}

export function clientUploadFile(claimId: string, uploadId: string): { storedRelpath: string; mimeType: string; filename: string } | null {
  ready();
  const row = get<{ stored_relpath: string; mime_type: string; original_filename: string }>(
    `SELECT stored_relpath, mime_type, original_filename FROM client_form_uploads WHERE id = ? AND claim_id = ?`,
    [uploadId, claimId],
  );
  return row ? { storedRelpath: String(row.stored_relpath), mimeType: String(row.mime_type), filename: String(row.original_filename) } : null;
}

/** The document type staff are offered first for each kind of client upload. */
export function defaultDocumentType(kind: string): string {
  return kind === "photo" || kind === "other" ? "other" : kind;
}

export function clientLinkExpiryWords(expiresAt: string): string {
  return formatUkDate(expiresAt);
}

import type { DatabaseSync } from "node:sqlite";
import { APPROVE_LEGAL_CORRESPONDENCE } from "../auth/roles";
import { formatUkDate, nowUtcIso } from "../dates";
import { claimDocumentMime, MAX_CLAIM_DOCUMENT_BYTES } from "../domain/claim-documents";
import { printChronology, type PrintChronologyLine } from "../domain/print-chronology";
import { formatGbp } from "../money";
import { storeFileCopy } from "../storage/files";
import { listClaimEvents, recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";
import { listStaffPermissions } from "./permissions";
import { storageRecoveryState } from "./storage-recovery-signing";

/**
 * Litigation and disputes, the basics (J13). The CRM records what people tell it and builds working papers from the
 * file. It never decides who is claimant or defendant, never calculates a court deadline on its own authority, and
 * never sends or files a legal document: a court date stays "needs verification" until a person confirms it, and a
 * letter before action, claim form or court document cannot be marked sent or filed until Justin has approved it.
 * Everything here is marked as needing qualified legal review.
 */

export const LEGAL_REVIEW_NOTE = "Working paper built from the file. It needs qualified legal review before it is relied on, sent or filed.";

export const PARTY_CAPACITIES = [
  { value: "claimant", label: "Claimant" },
  { value: "defendant", label: "Defendant" },
  { value: "additional_defendant", label: "Second or later defendant" },
  { value: "part_20", label: "Part 20 (additional) party" },
  { value: "insurer_not_party", label: "Insurer (not a party)" },
  { value: "witness", label: "Witness" },
  { value: "other", label: "Other" },
] as const;

export const COURT_DATE_KINDS = [
  { value: "deadline", label: "Deadline" },
  { value: "hearing", label: "Hearing" },
  { value: "order", label: "Order" },
] as const;

export const LEGAL_DOCUMENT_KINDS = [
  { value: "letter_before_action", label: "Letter before action" },
  { value: "claim_form", label: "Claim form" },
  { value: "court_document", label: "Court document" },
  { value: "other_legal", label: "Other legal document" },
] as const;

export function ensureLitigationTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS litigation_parties (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      capacity TEXT NOT NULL,
      representative_name TEXT,
      representative_firm TEXT,
      representative_ref TEXT,
      contact TEXT,
      added_by TEXT,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS litigation_dates (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      due_on TEXT NOT NULL,
      source TEXT NOT NULL,
      calculation TEXT,
      added_by TEXT,
      added_at TEXT NOT NULL,
      verified_by TEXT,
      verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS litigation_documents (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      document_id TEXT NOT NULL,
      added_by TEXT,
      added_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      sent_or_filed_at TEXT,
      sent_or_filed_by TEXT,
      sent_or_filed_how TEXT
    );
  `);
  const columns = new Set((db.prepare(`PRAGMA table_info(litigation)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("court_name")) db.exec(`ALTER TABLE litigation ADD COLUMN court_name TEXT`);
  if (!columns.has("court_reference")) db.exec(`ALTER TABLE litigation ADD COLUMN court_reference TEXT`);
}

function ready() {
  ensureLitigationTables(getDb());
}

function required(value: string, what: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new Error(`Enter ${what}.`);
  return text;
}

function day(value: string, what: string): string {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Enter ${what} as a date.`);
  return text;
}

export function canApproveLegal(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(APPROVE_LEGAL_CORRESPONDENCE);
}

/** Opens a litigation file on a claim. Nothing about the parties or the court is assumed. */
export function startLitigation(input: { claimId: string; actorId: string }) {
  ready();
  const existing = get<{ id: string }>(`SELECT id FROM litigation WHERE claim_id = ? LIMIT 1`, [input.claimId]);
  if (existing) return String(existing.id);
  const id = newId("lit");
  run(
    `INSERT INTO litigation(id, claim_id, stage, deadline_on, deadline_source, deadline_trigger, reviewer, approved_to_issue)
     VALUES (?, ?, 'opened', NULL, 'No deadline recorded yet.', NULL, NULL, 0)`,
    [id, input.claimId],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: "Litigation file opened. No party, court or deadline is assumed; each is recorded by a person.",
    source: "staff",
  });
  return id;
}

export function saveCourtDetails(input: { claimId: string; actorId: string; courtName: string; courtReference: string }) {
  ready();
  startLitigation(input);
  run(`UPDATE litigation SET court_name = ?, court_reference = ? WHERE claim_id = ?`, [
    input.courtName.trim() || null,
    input.courtReference.trim() || null,
    input.claimId,
  ]);
}

export function addLitigationParty(input: {
  claimId: string;
  actorId: string;
  name: string;
  capacity: string;
  representativeName: string;
  representativeFirm: string;
  representativeRef: string;
  contact: string;
}) {
  ready();
  startLitigation(input);
  const name = required(input.name, "the party's name");
  if (!PARTY_CAPACITIES.some((item) => item.value === input.capacity)) {
    throw new Error("Choose the party's capacity. The CRM does not assume who is claimant or defendant.");
  }
  run(
    `INSERT INTO litigation_parties(id, claim_id, name, capacity, representative_name, representative_firm, representative_ref, contact, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("party"),
      input.claimId,
      name,
      input.capacity,
      input.representativeName.trim() || null,
      input.representativeFirm.trim() || null,
      input.representativeRef.trim() || null,
      input.contact.trim() || null,
      input.actorId,
      nowUtcIso(),
    ],
  );
}

/**
 * A hearing, order or deadline typed in by a person, with where it comes from. A deadline also records how it was
 * worked out. The CRM does not calculate it. It stays "needs verification" until a person confirms it.
 */
export function addCourtDate(input: { claimId: string; actorId: string; kind: string; title: string; dueOn: string; source: string; calculation: string }) {
  ready();
  startLitigation(input);
  if (!COURT_DATE_KINDS.some((item) => item.value === input.kind)) throw new Error("Choose a deadline, hearing or order.");
  const title = required(input.title, "what the date is for");
  const dueOn = day(input.dueOn, "the date");
  const source = required(input.source, "where the date comes from (for example the order and paragraph)");
  const calculation = input.calculation.trim();
  if (input.kind === "deadline" && !calculation) throw new Error("Say how the deadline was worked out. The CRM does not calculate court deadlines.");
  run(
    `INSERT INTO litigation_dates(id, claim_id, kind, title, due_on, source, calculation, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("courtdate"), input.claimId, input.kind, title, dueOn, source, calculation || null, input.actorId, nowUtcIso()],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Court ${input.kind} recorded: ${title}, ${formatUkDate(dueOn)}. Source: ${source}.${calculation ? ` How worked out: ${calculation}.` : ""} Needs verification.`,
    source: "staff",
  });
}

/** A person confirms a court date against its source. The person who typed it in cannot confirm it. */
export function verifyCourtDate(input: { claimId: string; actorId: string; dateId: string }) {
  ready();
  const row = get<{ id: string; added_by: string | null; verified_at: string | null; title: string; due_on: string }>(
    `SELECT id, added_by, verified_at, title, due_on FROM litigation_dates WHERE id = ? AND claim_id = ?`,
    [input.dateId, input.claimId],
  );
  if (!row) throw new Error("That court date is not on this file.");
  if (row.verified_at) return;
  if (row.added_by === input.actorId) throw new Error("Someone other than the person who entered it must check it against its source.");
  run(`UPDATE litigation_dates SET verified_by = ?, verified_at = ? WHERE id = ?`, [input.actorId, nowUtcIso(), row.id]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Court date checked against its source and confirmed: ${row.title}, ${formatUkDate(row.due_on)}.`,
    source: "staff",
  });
}

/** Files a legal document prepared outside the CRM (a letter before action, claim form or court document). */
export function addLegalDocument(input: { claimId: string; actorId: string; kind: string; title: string; file: { buffer: Buffer; filename: string; mimeType: string } }) {
  ready();
  startLitigation(input);
  if (!LEGAL_DOCUMENT_KINDS.some((item) => item.value === input.kind)) throw new Error("Choose what kind of legal document this is.");
  const title = required(input.title, "the document's title");
  if (!input.file.buffer?.length) throw new Error("Choose the document to upload.");
  if (input.file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  const filename = (input.file.filename || "").trim() || "legal-document.pdf";
  const stored = storeFileCopy({ relDir: `claims/${input.claimId}/documents`, originalFilename: `${newId("file")}-${filename}`, buffer: input.file.buffer });
  const documentId = insertStoredDocument({
    title,
    documentType: "correspondence",
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
  run(
    `INSERT INTO litigation_documents(id, claim_id, kind, title, document_id, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("legaldoc"), input.claimId, input.kind, title, documentId, input.actorId, nowUtcIso()],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    documentId,
    details: `${title} filed on the litigation file. It needs qualified legal review and Justin's approval before it is sent or filed.`,
    source: "staff",
  });
}

export function approveLegalDocument(input: { claimId: string; actorId: string; legalDocumentId: string }) {
  ready();
  if (!canApproveLegal(input.actorId)) throw new Error("Only Justin can approve a legal document.");
  const row = get<{ title: string; approved_at: string | null }>(`SELECT title, approved_at FROM litigation_documents WHERE id = ? AND claim_id = ?`, [
    input.legalDocumentId,
    input.claimId,
  ]);
  if (!row) throw new Error("That document is not on this litigation file.");
  if (row.approved_at) return;
  run(`UPDATE litigation_documents SET approved_by = ?, approved_at = ? WHERE id = ?`, [input.actorId, nowUtcIso(), input.legalDocumentId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "legal_letter_approved",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `${row.title} approved by Justin.`,
    source: "staff",
  });
}

/** Records that an approved legal document was sent or filed outside the CRM. The CRM itself sends nothing. */
export function markLegalDocumentSentOrFiled(input: { claimId: string; actorId: string; legalDocumentId: string; how: string }) {
  ready();
  const row = get<{ title: string; approved_at: string | null; sent_or_filed_at: string | null }>(
    `SELECT title, approved_at, sent_or_filed_at FROM litigation_documents WHERE id = ? AND claim_id = ?`,
    [input.legalDocumentId, input.claimId],
  );
  if (!row) throw new Error("That document is not on this litigation file.");
  if (!row.approved_at) throw new Error("This document needs Justin's approval before it is sent or filed. Nothing was recorded.");
  if (row.sent_or_filed_at) return;
  const how = required(input.how, "how and where it was sent or filed");
  run(`UPDATE litigation_documents SET sent_or_filed_at = ?, sent_or_filed_by = ?, sent_or_filed_how = ? WHERE id = ?`, [
    nowUtcIso(),
    input.actorId,
    how,
    input.legalDocumentId,
  ]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `${row.title} recorded as sent or filed: ${how}. Sent or filed outside the CRM.`,
    source: "staff",
  });
}

export type ScheduleRow = { head: string; claimedPence: number; offeredPence: number; agreedPence: number; paidPence: number };

const HEAD_WORDS: Record<string, string> = {
  hire: "Hire",
  credit_hire: "Credit hire",
  storage: "Storage",
  recovery: "Recovery",
  repairs: "Repairs",
  vehicle_damage: "Vehicle damage (total loss)",
};

/** Claimed, offered, agreed and paid by head, each in its own column. They are never added together. */
export function scheduleOfLoss(claimId: string): ScheduleRow[] {
  return all<{ head: string; claimed: number; offered: number; agreed: number; received: number }>(
    `SELECT head_of_loss AS head, SUM(claimed_pence) AS claimed, SUM(offered_pence) AS offered, SUM(agreed_pence) AS agreed, SUM(received_pence) AS received
     FROM financial_lines WHERE claim_id = ? GROUP BY head_of_loss ORDER BY head_of_loss`,
    [claimId],
  ).map((row) => ({
    head: HEAD_WORDS[row.head] || row.head.replaceAll("_", " "),
    claimedPence: Number(row.claimed) || 0,
    offeredPence: Number(row.offered) || 0,
    agreedPence: Number(row.agreed) || 0,
    paidPence: Number(row.received) || 0,
  }));
}

export type EvidenceItem = { label: string; held: boolean; detail: string; when?: string };

function documentOfType(claimId: string, types: string[]) {
  const marks = types.map(() => "?").join(", ");
  return get<{ id: string; title: string | null; created_at: string }>(
    `SELECT id, title, created_at FROM documents WHERE claim_id = ? AND document_type IN (${marks}) ORDER BY created_at DESC LIMIT 1`,
    [claimId, ...types],
  );
}

/** What evidence is on the file and what is missing. "Held" means a copy is stored on the file. */
export function evidenceChecklist(claimId: string): EvidenceItem[] {
  const claim = get<{ needs_replacement: number; needs_recovery: number; claim_type: string }>(
    `SELECT needs_replacement, needs_recovery, claim_type FROM claims WHERE id = ?`,
    [claimId],
  );
  const hired = Boolean(get(`SELECT id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL LIMIT 1`, [claimId]));
  const items: EvidenceItem[] = [];
  const doc = (label: string, types: string[], why?: string) => {
    const found = documentOfType(claimId, types);
    items.push(found ? { label, held: true, detail: String(found.title || label), when: String(found.created_at) } : { label, held: false, detail: why || "No copy stored on the file." });
  };
  if (hired || Number(claim?.needs_replacement) === 1) doc("Signed hire agreement", ["signed_hire_agreement"]);
  if (Number(claim?.needs_recovery) === 1) {
    const state = storageRecoveryState(claimId);
    items.push({
      label: "Signed Storage & Recovery Agreement",
      held: state.status === "signed" || state.status === "covered_by_hire",
      detail:
        state.status === "signed"
          ? "Signed."
          : state.status === "covered_by_hire"
            ? "In the signed hire agreement."
            : state.status === "override"
              ? "Not signed: claimed under Justin's override."
              : "Not signed.",
    });
  }
  const report = documentOfType(claimId, ["engineer_report"]);
  const reportEvent = get<{ occurred_at: string }>(`SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = 'engineer_report_received' ORDER BY occurred_at DESC LIMIT 1`, [claimId]);
  items.push(
    report
      ? { label: "Engineer's report", held: true, detail: String(report.title || "Engineer's report"), when: String(report.created_at) }
      : { label: "Engineer's report", held: false, detail: reportEvent ? `Received on ${formatUkDate(reportEvent.occurred_at)}, but no copy is stored.` : "No copy stored on the file." },
  );
  doc("Client's driving licence or licence check", ["driving_licence", "licence_check"]);
  doc("Client's insurance certificate", ["insurance_certificate"]);
  doc("V5C for the client's vehicle", ["v5c_client"]);
  doc("Bank statements or impecuniosity evidence", ["bank_statements", "impecuniosity_evidence"], "Only needed if impecuniosity is relied on. No copy stored.");
  const letters = get<{ n: number }>(`SELECT COUNT(*) AS n FROM correspondence WHERE claim_id = ?`, [claimId]);
  items.push({
    label: "Correspondence with the insurer and others",
    held: Number(letters?.n) > 0,
    detail: Number(letters?.n) > 0 ? `${letters?.n} emails, letters and messages on the file.` : "None on the file.",
  });
  items.push({ label: "Basic hire rate evidence", held: false, detail: "The CRM does not hold rate evidence yet. Add it to the bundle by hand." });
  return items;
}

export type BundleEntry = { tab: number; section: string; title: string; date: string; documentId: string };

const BUNDLE_SECTIONS: Array<{ name: string; types: string[] }> = [
  { name: "A. Agreements", types: ["signed_hire_agreement", "signed_storage_recovery_agreement", "hire_agreement"] },
  { name: "B. Vehicle and engineering", types: ["engineer_report", "v5c_client", "satisfaction_note"] },
  { name: "C. Client documents", types: ["driving_licence", "licence_check", "insurance_certificate", "bank_statements", "impecuniosity_evidence"] },
  { name: "D. Correspondence", types: ["correspondence"] },
];

/** A draft bundle index of every document stored on the file, grouped and numbered. Not paginated. */
export function bundleIndex(claimId: string): BundleEntry[] {
  const docs = all<{ id: string; title: string | null; document_type: string | null; kind: string | null; created_at: string }>(
    `SELECT id, title, document_type, kind, created_at FROM documents WHERE claim_id = ? ORDER BY created_at ASC, rowid ASC`,
    [claimId],
  );
  const entries: BundleEntry[] = [];
  let tab = 0;
  const placed = new Set<string>();
  for (const section of BUNDLE_SECTIONS) {
    for (const doc of docs.filter((item) => section.types.includes(String(item.document_type || "")) || (section.name.startsWith("D.") && (item.kind === "letter" || item.kind === "email")))) {
      if (placed.has(doc.id)) continue;
      placed.add(doc.id);
      tab += 1;
      entries.push({ tab, section: section.name, title: String(doc.title || "Document"), date: formatUkDate(doc.created_at), documentId: String(doc.id) });
    }
  }
  for (const doc of docs) {
    if (placed.has(doc.id)) continue;
    tab += 1;
    entries.push({ tab, section: "E. Other", title: String(doc.title || "Document"), date: formatUkDate(doc.created_at), documentId: String(doc.id) });
  }
  return entries;
}

export function litigationChronology(claimId: string): PrintChronologyLine[] {
  return printChronology(listClaimEvents(claimId));
}

export type LitigationView = {
  open: boolean;
  courtName: string;
  courtReference: string;
  parties: Array<{ id: string; name: string; capacity: string; representative: string; contact: string }>;
  dates: Array<{ id: string; kind: string; title: string; dueOn: string; source: string; calculation: string; addedBy: string; verifiedBy: string | null; verifiedAt: string | null }>;
  documents: Array<{ id: string; kind: string; title: string; documentId: string; approvedBy: string | null; approvedAt: string | null; sentOrFiledAt: string | null; sentOrFiledHow: string | null }>;
};

export function litigationView(claimId: string): LitigationView {
  ready();
  const lit = get<{ court_name: string | null; court_reference: string | null }>(`SELECT court_name, court_reference FROM litigation WHERE claim_id = ? LIMIT 1`, [claimId]);
  const capacity = (value: string) => PARTY_CAPACITIES.find((item) => item.value === value)?.label || value;
  const kind = (value: string) => COURT_DATE_KINDS.find((item) => item.value === value)?.label || LEGAL_DOCUMENT_KINDS.find((item) => item.value === value)?.label || value;
  return {
    open: Boolean(lit),
    courtName: String(lit?.court_name || ""),
    courtReference: String(lit?.court_reference || ""),
    parties: all<{ id: string; name: string; capacity: string; representative_name: string | null; representative_firm: string | null; representative_ref: string | null; contact: string | null }>(
      `SELECT id, name, capacity, representative_name, representative_firm, representative_ref, contact FROM litigation_parties WHERE claim_id = ? ORDER BY added_at`,
      [claimId],
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      capacity: capacity(String(row.capacity)),
      representative: [row.representative_name, row.representative_firm, row.representative_ref ? `ref ${row.representative_ref}` : null].filter(Boolean).join(", "),
      contact: String(row.contact || ""),
    })),
    dates: all<{ id: string; kind: string; title: string; due_on: string; source: string; calculation: string | null; added: string | null; verifier: string | null; verified_at: string | null }>(
      `SELECT d.id, d.kind, d.title, d.due_on, d.source, d.calculation, a.name AS added, v.name AS verifier, d.verified_at
       FROM litigation_dates d LEFT JOIN staff a ON a.id = d.added_by LEFT JOIN staff v ON v.id = d.verified_by
       WHERE d.claim_id = ? ORDER BY d.due_on`,
      [claimId],
    ).map((row) => ({
      id: String(row.id),
      kind: kind(String(row.kind)),
      title: String(row.title),
      dueOn: String(row.due_on),
      source: String(row.source),
      calculation: String(row.calculation || ""),
      addedBy: String(row.added || ""),
      verifiedBy: row.verifier ? String(row.verifier) : null,
      verifiedAt: row.verified_at ? String(row.verified_at) : null,
    })),
    documents: all<{ id: string; kind: string; title: string; document_id: string; approver: string | null; approved_at: string | null; sent_or_filed_at: string | null; sent_or_filed_how: string | null }>(
      `SELECT d.id, d.kind, d.title, d.document_id, s.name AS approver, d.approved_at, d.sent_or_filed_at, d.sent_or_filed_how
       FROM litigation_documents d LEFT JOIN staff s ON s.id = d.approved_by WHERE d.claim_id = ? ORDER BY d.added_at`,
      [claimId],
    ).map((row) => ({
      id: String(row.id),
      kind: kind(String(row.kind)),
      title: String(row.title),
      documentId: String(row.document_id),
      approvedBy: row.approver ? String(row.approver) : null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      sentOrFiledAt: row.sent_or_filed_at ? String(row.sent_or_filed_at) : null,
      sentOrFiledHow: row.sent_or_filed_how ? String(row.sent_or_filed_how) : null,
    })),
  };
}

export function formatScheduleTotal(rows: ScheduleRow[], key: keyof Omit<ScheduleRow, "head">): string {
  return formatGbp(rows.reduce((total, row) => total + row[key], 0));
}

/** The next court date on a file, for the Litigation list, and whether it has been checked against its source. */
export function nextCourtDate(claimId: string): { dueOn: string; title: string; verified: boolean } | null {
  ready();
  const row = get<{ due_on: string; title: string; verified_at: string | null }>(
    `SELECT due_on, title, verified_at FROM litigation_dates WHERE claim_id = ? AND due_on >= ? ORDER BY due_on LIMIT 1`,
    [claimId, new Date().toISOString().slice(0, 10)],
  );
  return row ? { dueOn: String(row.due_on), title: String(row.title), verified: Boolean(row.verified_at) } : null;
}

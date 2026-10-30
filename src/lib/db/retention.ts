import type { DatabaseSync } from "node:sqlite";
import { APPROVE_LEGAL_CORRESPONDENCE } from "../auth/roles";
import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { listStaffPermissions } from "./permissions";
import { deleteStoredFile } from "../storage/files";

function deleteStoredFileQuietly(relpath: string) {
  try {
    deleteStoredFile(relpath);
  } catch {
    /* A path outside the files folder is never touched. */
  }
}

/**
 * Retention (J15). A schedule in Settings with default periods marked "awaiting adviser" until Justin confirms them.
 * A daily pass builds a "Due for deletion" list; nothing is deleted automatically. Justin approves each batch. A legal
 * hold on a claim blocks deletion. A claim file is anonymised (people's details, free text and stored files removed;
 * the money lines kept for the accounts); a bank statement or an old audit entry is removed. Each deletion is logged
 * with what kind of thing was removed, when and by whom, never the deleted data itself.
 */

export type RetentionKey = "enquiry" | "claim" | "financial" | "bank" | "licence" | "audit";

export const RETENTION_RULES: Array<{ key: RetentionKey; label: string; months: number | null; from: string }> = [
  { key: "enquiry", label: "Enquiries that never became a claim", months: 12, from: "from when the enquiry was opened" },
  { key: "claim", label: "Claim file", months: 72, from: "after the claim closes" },
  { key: "financial", label: "Invoices and financial records", months: 72, from: "after the end of the financial year the claim closed in" },
  { key: "bank", label: "Bank statements", months: 0, from: "at claim close, unless used in a dispute or litigation (then they follow the claim file)" },
  { key: "licence", label: "Licence check", months: null, from: "follows the claim file" },
  { key: "audit", label: "Audit log", months: 72, from: "from when the entry was written" },
];

export function ensureRetentionTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retention_due (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      claim_id TEXT,
      target_id TEXT,
      label TEXT NOT NULL,
      due_since TEXT NOT NULL,
      action TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deletion_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor_id TEXT,
      kind TEXT NOT NULL,
      file_reference TEXT,
      what TEXT NOT NULL,
      reason TEXT NOT NULL
    );
  `);
  const claims = new Set((db.prepare(`PRAGMA table_info(claims)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!claims.has("legal_hold_reason")) db.exec(`ALTER TABLE claims ADD COLUMN legal_hold_reason TEXT`);
  if (!claims.has("legal_hold_at")) db.exec(`ALTER TABLE claims ADD COLUMN legal_hold_at TEXT`);
  if (!claims.has("legal_hold_by")) db.exec(`ALTER TABLE claims ADD COLUMN legal_hold_by TEXT`);
  if (!claims.has("anonymised_at")) db.exec(`ALTER TABLE claims ADD COLUMN anonymised_at TEXT`);
}

function ready() {
  ensureRetentionTables(getDb());
}

function canDecide(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(APPROVE_LEGAL_CORRESPONDENCE);
}

export function retentionMonths(key: RetentionKey): number | null {
  const rule = RETENTION_RULES.find((item) => item.key === key)!;
  const stored = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`retention_${key}_months`])?.value;
  return stored != null && stored !== "" && Number.isFinite(Number(stored)) ? Number(stored) : rule.months;
}

export function retentionConfirmed(key: RetentionKey): boolean {
  return get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [`retention_${key}_confirmed`])?.value === "yes";
}

/** The month the financial year ends (1–12). Default March, awaiting adviser. */
export function financialYearEndMonth(): number {
  const value = Number(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'financial_year_end_month'`)?.value || 3);
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : 3;
}

function setSetting(key: string, value: string) {
  run(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

/** Justin changes a period. Saving it marks it confirmed (no longer "awaiting adviser"). */
export function saveRetentionRule(input: { actorId: string; key: RetentionKey; months: string; confirmed: boolean }) {
  if (!canDecide(input.actorId)) throw new Error("Only Justin can change the retention schedule.");
  const rule = RETENTION_RULES.find((item) => item.key === input.key);
  if (!rule || rule.months === null) throw new Error("That period follows the claim file and is not set on its own.");
  const months = Number(String(input.months).trim());
  if (!Number.isInteger(months) || months < 0 || months > 240) throw new Error("Enter a whole number of months between 0 and 240.");
  setSetting(`retention_${input.key}_months`, String(months));
  setSetting(`retention_${input.key}_confirmed`, input.confirmed ? "yes" : "no");
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'save', 'retention', ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    input.key,
    `${rule.label}: ${months} months${input.confirmed ? ", confirmed" : ", awaiting adviser"}`,
  ]);
}

export function saveFinancialYearEnd(input: { actorId: string; month: string }) {
  if (!canDecide(input.actorId)) throw new Error("Only Justin can change the retention schedule.");
  const month = Number(input.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Choose the month the financial year ends.");
  setSetting("financial_year_end_month", String(month));
}

function addMonths(isoDay: string, months: number): string {
  const [year, month, day] = isoDay.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

function financialYearEnd(isoDay: string): string {
  const endMonth = financialYearEndMonth();
  const [year, month] = isoDay.slice(0, 10).split("-").map(Number);
  const endYear = month > endMonth ? year + 1 : year;
  return new Date(Date.UTC(endYear, endMonth, 0)).toISOString().slice(0, 10);
}

// ---- Legal hold ----

export function setLegalHold(input: { claimId: string; actorId: string; reason: string }) {
  ready();
  if (!canDecide(input.actorId)) throw new Error("Only Justin can put a claim on legal hold.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter the reason for the legal hold.");
  run(`UPDATE claims SET legal_hold_reason = ?, legal_hold_at = ?, legal_hold_by = ? WHERE id = ?`, [reason.slice(0, 500), nowUtcIso(), input.actorId, input.claimId]);
  recordClaimEvent({ claimId: input.claimId, eventType: "other", occurredAt: nowUtcIso(), actorId: input.actorId, details: `Legal hold placed: nothing on this claim can be deleted. Reason: ${reason}`, source: "staff" });
}

export function liftLegalHold(input: { claimId: string; actorId: string }) {
  ready();
  if (!canDecide(input.actorId)) throw new Error("Only Justin can lift a legal hold.");
  run(`UPDATE claims SET legal_hold_reason = NULL, legal_hold_at = NULL, legal_hold_by = NULL WHERE id = ?`, [input.claimId]);
  recordClaimEvent({ claimId: input.claimId, eventType: "other", occurredAt: nowUtcIso(), actorId: input.actorId, details: "Legal hold lifted. The retention schedule applies again.", source: "staff" });
}

export function legalHold(claimId: string): { reason: string; at: string } | null {
  ready();
  const row = get<{ legal_hold_reason: string | null; legal_hold_at: string | null }>(`SELECT legal_hold_reason, legal_hold_at FROM claims WHERE id = ?`, [claimId]);
  return row?.legal_hold_at ? { reason: String(row.legal_hold_reason || ""), at: String(row.legal_hold_at) } : null;
}

// ---- The due list ----

type ClaimFacts = { id: string; file_reference: string; created_at: string; is_new_enquiry: number; legal_hold_at: string | null; anonymised_at: string | null; closed_on: string | null; litigation: number };

function claimFacts(): ClaimFacts[] {
  return all<ClaimFacts>(
    `SELECT c.id, c.file_reference, c.created_at, c.is_new_enquiry, c.legal_hold_at, c.anonymised_at,
            (SELECT MAX(substr(e.occurred_at, 1, 10)) FROM claim_events e WHERE e.claim_id = c.id AND e.event_type = 'case_closed') AS closed_on,
            (SELECT COUNT(*) FROM litigation l WHERE l.claim_id = c.id) AS litigation
     FROM claims c`,
  );
}

export type DueItem = { id: string; kind: string; claimId: string | null; targetId: string | null; label: string; dueSince: string; action: "anonymise" | "delete" };

/** Works out what is past its retention period today. Claims on legal hold are left out. */
export function computeDueList(asAtYmd = londonTodayIso()): DueItem[] {
  ready();
  const items: DueItem[] = [];
  const push = (item: Omit<DueItem, "id">) => items.push({ ...item, id: `${item.kind}:${item.targetId || item.claimId}` });
  for (const claim of claimFacts()) {
    if (claim.legal_hold_at || claim.anonymised_at) continue;
    if (claim.is_new_enquiry && !claim.closed_on) {
      const due = addMonths(claim.created_at, retentionMonths("enquiry") ?? 12);
      if (due <= asAtYmd) push({ kind: "enquiry", claimId: claim.id, targetId: claim.id, label: `${claim.file_reference}: enquiry that never became a claim`, dueSince: due, action: "anonymise" });
      continue;
    }
    if (!claim.closed_on) continue;
    const claimDue = addMonths(claim.closed_on, retentionMonths("claim") ?? 72);
    if (claimDue <= asAtYmd) {
      push({ kind: "claim", claimId: claim.id, targetId: claim.id, label: `${claim.file_reference}: claim file closed ${formatUkDate(claim.closed_on)} (licence checks go with it)`, dueSince: claimDue, action: "anonymise" });
    }
    const moneyDue = addMonths(financialYearEnd(claim.closed_on), retentionMonths("financial") ?? 72);
    const hasMoney = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = ?`, [claim.id])?.n || 0) > 0;
    if (moneyDue <= asAtYmd && claimDue <= asAtYmd && hasMoney) {
      push({ kind: "financial", claimId: claim.id, targetId: `money-${claim.id}`, label: `${claim.file_reference}: financial records (totals kept in the deletion log)`, dueSince: moneyDue, action: "delete" });
    }
    // Bank statements go at claim close, unless the claim is in litigation, when they follow the claim file.
    const bankDue = claim.litigation ? claimDue : addMonths(claim.closed_on, retentionMonths("bank") ?? 0);
    if (bankDue <= asAtYmd) {
      for (const doc of all<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND document_type = 'bank_statements' AND stored_relpath IS NOT NULL`, [claim.id])) {
        push({ kind: "bank", claimId: claim.id, targetId: String(doc.id), label: `${claim.file_reference}: bank statement`, dueSince: bankDue, action: "delete" });
      }
    }
  }
  const auditCutoff = addMonths(asAtYmd, -(retentionMonths("audit") ?? 72));
  const oldAudit = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE substr(at, 1, 10) < ?`, [auditCutoff])?.n || 0);
  if (oldAudit > 0) push({ kind: "audit", claimId: null, targetId: `audit-before-${auditCutoff}`, label: `${oldAudit} audit log entries written before ${formatUkDate(auditCutoff)}`, dueSince: auditCutoff, action: "delete" });
  return items;
}

/** The daily pass: rebuilds the stored list. Nothing is deleted. */
export function rebuildDueList(asAtYmd = londonTodayIso()) {
  ready();
  const items = computeDueList(asAtYmd);
  const builtAt = nowUtcIso();
  run(`DELETE FROM retention_due`);
  for (const item of items) {
    run(`INSERT INTO retention_due(id, kind, claim_id, target_id, label, due_since, action, built_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      item.id,
      item.kind,
      item.claimId,
      item.targetId,
      item.label,
      item.dueSince,
      item.action,
      builtAt,
    ]);
  }
  setSetting("retention_due_built_at", builtAt);
  return items;
}

export function storedDueList(): { builtAt: string | null; items: DueItem[] } {
  ready();
  return {
    builtAt: get<{ value: string }>(`SELECT value FROM settings WHERE key = 'retention_due_built_at'`)?.value || null,
    items: all<{ id: string; kind: string; claim_id: string | null; target_id: string | null; label: string; due_since: string; action: string }>(
      `SELECT id, kind, claim_id, target_id, label, due_since, action FROM retention_due ORDER BY due_since, label`,
    ).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      claimId: row.claim_id,
      targetId: row.target_id,
      label: String(row.label),
      dueSince: String(row.due_since),
      action: row.action === "anonymise" ? "anonymise" : "delete",
    })),
  };
}

// ---- Approved deletion ----

function logDeletion(input: { actorId: string; kind: string; fileReference: string | null; what: string; reason: string }) {
  run(`INSERT INTO deletion_log(id, at, actor_id, kind, file_reference, what, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    newId("del"),
    nowUtcIso(),
    input.actorId,
    input.kind,
    input.fileReference,
    input.what,
    input.reason,
  ]);
}

/**
 * Removes a person's details everywhere they are held, keeping the person row so claims and money still add up.
 * Returns how many records were changed. Used by the retention batch and by an erasure.
 */
export function anonymisePerson(personId: string): number {
  return Number(
    getDb()
      .prepare(
        `UPDATE people SET full_name = 'Removed', title = NULL, forename = NULL, surname = NULL, date_of_birth = NULL, address_line1 = NULL,
           address_line2 = NULL, town = NULL, postcode = NULL, telephone = NULL, email = NULL, licence_number = NULL, home_tel = NULL,
           work_tel = NULL, mobile_tel = NULL, licence_issued_on = NULL, licence_expires_on = NULL WHERE id = ?`,
      )
      .run(personId).changes,
  );
}

/** A claim file anonymised: people, free text, screens, messages and stored files removed; money lines kept. */
function anonymiseClaim(claimId: string): string {
  const people = all<{ person_id: string }>(
    `SELECT client_person_id AS person_id FROM claims WHERE id = ? AND client_person_id IS NOT NULL
     UNION SELECT person_id FROM claim_parties WHERE claim_id = ?
     UNION SELECT person_id FROM claim_third_parties WHERE claim_id = ?`,
    [claimId, claimId, claimId],
  );
  for (const person of people) anonymisePerson(String(person.person_id));
  const files = all<{ stored_relpath: string | null }>(`SELECT stored_relpath FROM documents WHERE claim_id = ? AND stored_relpath IS NOT NULL`, [claimId]);
  for (const file of files) deleteStoredFileQuietly(String(file.stored_relpath));
  const docs = getDb()
    .prepare(`UPDATE documents SET title = 'Removed under retention', body_html = NULL, stored_relpath = NULL, original_filename = NULL, missing_json = NULL WHERE claim_id = ?`)
    .run(claimId).changes;
  const messages = getDb().prepare(`UPDATE correspondence SET subject = 'Removed', preview = NULL, body = NULL, to_address = NULL, from_address = NULL WHERE claim_id = ?`).run(claimId).changes;
  getDb().prepare(`UPDATE claim_events SET details = NULL WHERE claim_id = ?`).run(claimId);
  getDb().prepare(`DELETE FROM claim_screen_data WHERE claim_id = ?`).run(claimId);
  getDb().prepare(`UPDATE claims SET circumstances = NULL, accident_location = NULL, next_action = NULL, anonymised_at = ? WHERE id = ?`).run(nowUtcIso(), claimId);
  try {
    getDb().prepare(`DELETE FROM licence_checks WHERE claim_id = ?`).run(claimId);
  } catch {
    /* No licence checks table on an older database. */
  }
  return `${people.length} people's details, ${docs} documents (${files.length} stored files), ${messages} messages, the screens and free text removed; money lines kept`;
}

/** Justin approves a batch from the due list. Each item is checked again before it is removed. */
export function approveDeletionBatch(input: { actorId: string; itemIds: string[]; reason: string }) {
  ready();
  if (!canDecide(input.actorId)) throw new Error("Only Justin can approve deletions.");
  const reason = input.reason.trim() || "Past its retention period";
  const current = new Map(computeDueList().map((item) => [item.id, item]));
  let done = 0;
  for (const id of input.itemIds) {
    const item = current.get(id);
    if (!item) continue; // no longer due, or a legal hold was placed since the list was built
    const reference = item.claimId ? String(get<{ file_reference: string }>(`SELECT file_reference FROM claims WHERE id = ?`, [item.claimId])?.file_reference || "") : null;
    if (item.claimId && legalHold(item.claimId)) continue;
    if (item.kind === "claim" || item.kind === "enquiry") {
      logDeletion({ actorId: input.actorId, kind: item.kind, fileReference: reference, what: anonymiseClaim(item.claimId!), reason });
    } else if (item.kind === "bank") {
      const doc = get<{ stored_relpath: string | null }>(`SELECT stored_relpath FROM documents WHERE id = ?`, [item.targetId]);
      if (doc?.stored_relpath) deleteStoredFileQuietly(String(doc.stored_relpath));
      run(`UPDATE documents SET title = 'Bank statement removed under retention', stored_relpath = NULL, original_filename = NULL, body_html = NULL WHERE id = ?`, [item.targetId]);
      logDeletion({ actorId: input.actorId, kind: "bank", fileReference: reference, what: "One bank statement removed", reason });
    } else if (item.kind === "financial") {
      const totals = get<{ claimed: number | null; received: number | null; n: number }>(
        `SELECT SUM(claimed_pence) AS claimed, SUM(received_pence) AS received, COUNT(*) AS n FROM financial_lines WHERE claim_id = ?`,
        [item.claimId],
      );
      run(`DELETE FROM financial_lines WHERE claim_id = ?`, [item.claimId]);
      logDeletion({
        actorId: input.actorId,
        kind: "financial",
        fileReference: reference,
        what: `${totals?.n || 0} money lines removed. Totals kept for the accounts: claimed ${formatGbp(Number(totals?.claimed || 0))}, received ${formatGbp(Number(totals?.received || 0))}`,
        reason,
      });
    } else if (item.kind === "audit") {
      const cutoff = String(item.targetId).replace("audit-before-", "");
      const removed = getDb().prepare(`DELETE FROM audit_log WHERE substr(at, 1, 10) < ?`).run(cutoff).changes;
      logDeletion({ actorId: input.actorId, kind: "audit", fileReference: null, what: `${removed} audit log entries written before ${formatUkDate(cutoff)} removed`, reason });
    }
    run(`DELETE FROM retention_due WHERE id = ?`, [id]);
    done += 1;
  }
  return { done };
}

export function listDeletionLog(limit = 200) {
  ready();
  return all<{ at: string; who: string | null; kind: string; file_reference: string | null; what: string; reason: string }>(
    `SELECT d.at, s.name AS who, d.kind, d.file_reference, d.what, d.reason FROM deletion_log d LEFT JOIN staff s ON s.id = d.actor_id ORDER BY d.at DESC LIMIT ?`,
    [limit],
  );
}

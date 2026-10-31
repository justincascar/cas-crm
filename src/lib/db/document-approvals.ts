import { APPROVE_CHASER_TEMPLATES } from "../auth/roles";
import { nowUtcIso } from "../dates";
import { clientDraftInfo, isClientDraftKey, MID_BLOCK_KEY, type ClientDraftExtras } from "../documents/client-drafts";
import { all, get, getDb, newId, run } from "./connection";
import { listStaffPermissions } from "./permissions";

function recordAudit(input: { actorId: string; action: string; entity: string; entityId: string; details: string }) {
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    input.action,
    input.entity,
    input.entityId,
    input.details,
  ]);
}

/**
 * R64: Justin's approval of each draft document before it can be sent, marked sent or signed. Drafts 1, 2, 4 and 5 also
 * record the date the solicitor checked them. Nothing is approved by default.
 */
function ready() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS document_approvals (
    template_key TEXT PRIMARY KEY,
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    solicitor_checked_on TEXT
  )`);
}

export type DocumentApproval = { approvedAt: string; approvedByName: string; solicitorCheckedOn: string | null };

export function documentApproval(templateKey: string): DocumentApproval | null {
  ready();
  const row = get<{ approved_at: string; name: string | null; approved_by: string; solicitor_checked_on: string | null }>(
    `SELECT a.approved_at, a.approved_by, a.solicitor_checked_on, s.name FROM document_approvals a LEFT JOIN staff s ON s.id = a.approved_by WHERE a.template_key = ?`,
    [templateKey],
  );
  return row
    ? { approvedAt: String(row.approved_at), approvedByName: String(row.name || row.approved_by), solicitorCheckedOn: row.solicitor_checked_on ? String(row.solicitor_checked_on) : null }
    : null;
}

/** Approved by Justin, and checked by the solicitor where the draft needs it. */
export function isDocumentApproved(templateKey: string): boolean {
  const approval = documentApproval(templateKey);
  if (!approval) return false;
  const info = clientDraftInfo(templateKey);
  if (info?.outlineOnly) return false;
  if (info?.solicitor && !approval.solicitorCheckedOn) return false;
  return true;
}

/** Only Justin approves wording (the same permission as the automatic chasers' wording). */
export function canApproveDocuments(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(APPROVE_CHASER_TEMPLATES);
}

export function approveDocument(input: { templateKey: string; actorId: string; solicitorCheckedOn?: string }) {
  ready();
  if (!canApproveDocuments(input.actorId)) throw new Error("Only Justin can approve a document's wording.");
  const known = isClientDraftKey(input.templateKey) || input.templateKey === MID_BLOCK_KEY;
  if (!known) throw new Error("Unknown document.");
  const info = clientDraftInfo(input.templateKey);
  if (info?.outlineOnly) throw new Error(`${info.title} is an outline only. CAS's wording is needed first.`);
  const checked = String(input.solicitorCheckedOn || "").trim();
  if (info?.solicitor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) throw new Error("Enter the date the solicitor checked this wording.");
    if (checked > nowUtcIso().slice(0, 10)) throw new Error("The solicitor's check cannot be dated after today.");
  }
  run(
    `INSERT INTO document_approvals(template_key, approved_by, approved_at, solicitor_checked_on) VALUES (?, ?, ?, ?)
     ON CONFLICT(template_key) DO UPDATE SET approved_by = excluded.approved_by, approved_at = excluded.approved_at, solicitor_checked_on = excluded.solicitor_checked_on`,
    [input.templateKey, input.actorId, nowUtcIso(), checked || null],
  );
  recordAudit({ actorId: input.actorId, action: "document_wording_approved", entity: "template", entityId: input.templateKey, details: `${info?.title || input.templateKey} approved${checked ? `; solicitor checked on ${checked}` : ""}.` });
}

export function withdrawDocumentApproval(input: { templateKey: string; actorId: string }) {
  ready();
  if (!canApproveDocuments(input.actorId)) throw new Error("Only Justin can change a document's approval.");
  run(`DELETE FROM document_approvals WHERE template_key = ?`, [input.templateKey]);
  recordAudit({ actorId: input.actorId, action: "document_wording_withdrawn", entity: "template", entityId: input.templateKey, details: `${clientDraftInfo(input.templateKey)?.title || input.templateKey} approval withdrawn.` });
}

/** The latest MID search on the file. The policy number is kept in the search's own note. */
export function latestMidSearch(claimId: string): ClientDraftExtras["mid"] {
  const rows = all<{ registration: string | null; lookup_on: string | null; insurer: string | null; evidence: string | null }>(
    `SELECT registration, lookup_on, insurer, evidence FROM mid_lookups WHERE claim_id = ? AND lookup_on IS NOT NULL ORDER BY lookup_on DESC, rowid DESC`,
    [claimId],
  );
  const read = (row: (typeof rows)[number]) => {
    const evidence = String(row.evidence || "");
    const found = !/no record found/i.test(evidence) && String(row.insurer || "").toLowerCase() !== "no record found";
    const policyMatch = evidence.match(/Policy (.+?)\. (?:Not scraped|The CRM)/);
    const policy = policyMatch && policyMatch[1] !== "not stated" ? policyMatch[1] : "";
    const registration = String(row.registration || "");
    return { searchedOn: String(row.lookup_on), registration: /^unknown$/i.test(registration) ? "" : registration, insurer: found ? String(row.insurer || "") : "", policy, found };
  };
  // The MID search staff recorded (with its policy) is preferred over an insurer name typed on the third party.
  const searches = rows.map(read);
  return searches.find((search) => search.policy || !search.found) || searches[0] || null;
}

/** What the drafts need from the file, beyond the usual letter context. */
export function clientDraftExtras(claimId: string, accountLine = ""): ClientDraftExtras {
  const claim = get<{
    address_line1: string | null;
    address_line2: string | null;
    town: string | null;
    postcode: string | null;
    own_claim_ref: string | null;
    own_excess_pence: number | null;
    split_tp_percent: number | null;
  }>(
    `SELECT p.address_line1, p.address_line2, p.town, p.postcode, c.own_claim_ref, c.own_excess_pence, c.split_tp_percent
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
  const photos = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND (document_type LIKE '%photo%' OR mime_type LIKE 'image/%')`,
    [claimId],
  );
  return {
    clientAddress: [claim?.address_line1, claim?.address_line2, claim?.town, claim?.postcode].map((part) => String(part || "").trim()).filter(Boolean).join(", "),
    ownInsurerClaimRef: String(claim?.own_claim_ref || ""),
    ownExcessPence: claim?.own_excess_pence == null ? null : Number(claim.own_excess_pence),
    splitTpPercent: claim?.split_tp_percent == null ? null : Number(claim.split_tp_percent),
    mid: latestMidSearch(claimId),
    accountLine,
    photosAttached: Number(photos?.n || 0) > 0,
  };
}

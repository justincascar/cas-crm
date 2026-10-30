import type { DatabaseSync } from "node:sqlite";
import { EXPORT_AND_AUDIT } from "../auth/roles";
import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { toCsv } from "../ops/export";
import { writeZip } from "../ops/zip";
import { readStoredFile } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { listStaffPermissions } from "./permissions";
import { anonymisePerson, legalHold, retentionMonths } from "./retention";
import { recordView } from "./view-audit";

/**
 * "This person's data" (J15). Justin finds a person across every claim and role, exports everything held about them
 * for a subject access request, and restricts or erases where that is allowed. Erasure is blocked by a legal hold and
 * by the retention schedule. A reason is recorded for each, and everything, including opening the screen, is logged.
 */

export function ensurePersonDataColumns(db: DatabaseSync) {
  const people = new Set((db.prepare(`PRAGMA table_info(people)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!people.has("restricted_at")) db.exec(`ALTER TABLE people ADD COLUMN restricted_at TEXT`);
  if (!people.has("restricted_reason")) db.exec(`ALTER TABLE people ADD COLUMN restricted_reason TEXT`);
}

function ready() {
  ensurePersonDataColumns(getDb());
}

export function canUsePersonData(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(EXPORT_AND_AUDIT);
}

function guard(staffId: string) {
  if (!canUsePersonData(staffId)) throw new Error("Only Justin can open a person's data.");
}

export type PersonRole = { claimId: string; fileReference: string; role: string; closedOn: string | null; anonymised: boolean };

const ROLE_WORDS: Record<string, string> = {
  client: "Client",
  driver: "Driver",
  owner: "Owner",
  vehicle_owner: "Vehicle owner",
  witness: "Witness",
  third_party: "Third party",
};

/** Every claim and role the person appears in. */
export function personRoles(personId: string): PersonRole[] {
  const rows = all<{ claim_id: string; file_reference: string; role: string; closed_on: string | null; anonymised_at: string | null }>(
    `SELECT c.id AS claim_id, c.file_reference, r.role,
            (SELECT MAX(substr(e.occurred_at, 1, 10)) FROM claim_events e WHERE e.claim_id = c.id AND e.event_type = 'case_closed') AS closed_on,
            c.anonymised_at
     FROM (
       SELECT id AS claim_id, 'client' AS role FROM claims WHERE client_person_id = ?
       UNION SELECT claim_id, role FROM claim_parties WHERE person_id = ?
       UNION SELECT claim_id, 'third_party' AS role FROM claim_third_parties WHERE person_id = ?
     ) r JOIN claims c ON c.id = r.claim_id
     ORDER BY c.file_reference`,
    [personId, personId, personId],
  );
  return rows.map((row) => ({
    claimId: String(row.claim_id),
    fileReference: String(row.file_reference),
    role: ROLE_WORDS[String(row.role)] || String(row.role),
    closedOn: row.closed_on ? String(row.closed_on) : null,
    anonymised: Boolean(row.anonymised_at),
  }));
}

export type PersonMatch = { id: string; name: string; email: string; phone: string; postcode: string; restricted: boolean; roles: PersonRole[] };

/** Search by name, email, phone or postcode. Logged as a view of the screen. */
export function searchPeople(input: { actorId: string; query: string }): PersonMatch[] {
  ready();
  guard(input.actorId);
  const text = input.query.trim();
  if (text.length < 2) return [];
  recordView({ actorId: input.actorId, entity: "person-data", what: `Searched for a person (${text.length} characters typed)` });
  const like = `%${text.toLowerCase()}%`;
  const digits = text.replace(/\D/g, "");
  return all<{ id: string; full_name: string; email: string | null; telephone: string | null; mobile_tel: string | null; postcode: string | null; restricted_at: string | null }>(
    `SELECT id, full_name, email, telephone, mobile_tel, postcode, restricted_at FROM people
     WHERE full_name != 'Removed' AND (lower(full_name) LIKE ? OR lower(COALESCE(email, '')) LIKE ? OR lower(COALESCE(postcode, '')) LIKE ?
        OR (? != '' AND (replace(COALESCE(telephone, ''), ' ', '') LIKE ? OR replace(COALESCE(mobile_tel, ''), ' ', '') LIKE ?)))
     ORDER BY full_name LIMIT 50`,
    [like, like, like, digits, `%${digits}%`, `%${digits}%`],
  ).map((row) => ({
    id: String(row.id),
    name: String(row.full_name),
    email: String(row.email || ""),
    phone: String(row.mobile_tel || row.telephone || ""),
    postcode: String(row.postcode || ""),
    restricted: Boolean(row.restricted_at),
    roles: personRoles(String(row.id)),
  }));
}

/** Everything held about the person, as one zip, for a subject access request. To be checked before it is sent. */
export function exportPersonData(input: { actorId: string; personId: string }): { zip: Buffer; filename: string } {
  ready();
  guard(input.actorId);
  const person = get<Record<string, string | number | null>>(`SELECT * FROM people WHERE id = ?`, [input.personId]);
  if (!person) throw new Error("That person is not on the CRM.");
  const roles = personRoles(input.personId);
  const claimIds = roles.map((role) => role.claimId);
  const placeholders = claimIds.map(() => "?").join(", ") || "''";
  const clientClaims = roles.filter((role) => role.role === "Client").map((role) => role.claimId);
  const clientPlaceholders = clientClaims.map(() => "?").join(", ") || "''";
  const claims = all<Record<string, string | number | null>>(
    `SELECT id, file_reference, created_at, accident_at, accident_location, circumstances, claim_type, current_position FROM claims WHERE id IN (${placeholders})`,
    claimIds,
  ).map((claim) => ({ ...claim, role: roles.filter((role) => role.claimId === claim.id).map((role) => role.role).join(", ") }));
  const email = String(person.email || "").toLowerCase();
  const messages = email
    ? all<Record<string, string | number | null>>(
        `SELECT claim_id, created_at, direction, channel, subject, body, to_address, from_address FROM correspondence
         WHERE lower(COALESCE(to_address, '')) LIKE ? OR lower(COALESCE(from_address, '')) LIKE ? ORDER BY created_at`,
        [`%${email}%`, `%${email}%`],
      )
    : [];
  const history = all<Record<string, string | number | null>>(
    `SELECT claim_id, occurred_at, event_type, title, details FROM claim_events WHERE claim_id IN (${clientPlaceholders}) ORDER BY occurred_at`,
    clientClaims,
  );
  const docs = all<{ id: string; claim_id: string; title: string | null; document_type: string | null; stored_relpath: string | null; original_filename: string | null }>(
    `SELECT id, claim_id, title, document_type, stored_relpath, original_filename FROM documents WHERE claim_id IN (${clientPlaceholders}) AND stored_relpath IS NOT NULL`,
    clientClaims,
  );
  const entries: Array<{ name: string; data: Buffer }> = [];
  const today = londonTodayIso();
  entries.push({
    name: "README.txt",
    data: Buffer.from(
      [
        `Subject access export for ${String(person.full_name)}, made ${formatUkDate(today)}.`,
        "",
        "Check every file before it is sent. Other people's details (for example a third party named in the circumstances,",
        "or a witness) may appear and must be removed or redacted first. Messages are those sent to or from the person's email.",
        "History and documents are from the claims where the person is the client.",
        "",
        `Claims: ${roles.map((role) => `${role.fileReference} (${role.role})`).join(", ") || "none"}.`,
        `Messages: ${messages.length}. History entries: ${history.length}. Documents: ${docs.length}.`,
      ].join("\r\n"),
    ),
  });
  const columns = Object.keys(person).filter((key) => key !== "id");
  entries.push({ name: "person.csv", data: Buffer.from(toCsv(columns, [person])) });
  entries.push({ name: "claims.csv", data: Buffer.from(toCsv(["file_reference", "role", "created_at", "accident_at", "accident_location", "circumstances", "claim_type", "current_position"], claims)) });
  entries.push({ name: "messages.csv", data: Buffer.from(toCsv(["claim_id", "created_at", "direction", "channel", "subject", "body", "to_address", "from_address"], messages)) });
  entries.push({ name: "history.csv", data: Buffer.from(toCsv(["claim_id", "occurred_at", "event_type", "title", "details"], history)) });
  for (const doc of docs) {
    try {
      const { buffer } = readStoredFile(String(doc.stored_relpath));
      entries.push({ name: `documents/${doc.id}-${String(doc.original_filename || doc.title || "document").replace(/[\\/:*?"<>|]/g, "_")}`, data: buffer });
    } catch {
      /* A missing file is listed by its absence. */
    }
  }
  recordView({ actorId: input.actorId, entity: "person-data", what: `Exported everything held about one person (${roles.length} claims, ${docs.length} documents) for a subject access request` });
  return { zip: writeZip(entries), filename: `subject-access-${today}.zip` };
}

/** Processing restricted: the person's claims show it; nothing is deleted. Logged with the reason. */
export function restrictPerson(input: { actorId: string; personId: string; reason: string; lift?: boolean }) {
  ready();
  guard(input.actorId);
  const reason = input.reason.trim();
  if (!input.lift && !reason) throw new Error("Enter the reason for restricting this person's data.");
  run(`UPDATE people SET restricted_at = ?, restricted_reason = ? WHERE id = ?`, [input.lift ? null : nowUtcIso(), input.lift ? null : reason.slice(0, 500), input.personId]);
  for (const role of personRoles(input.personId)) {
    recordClaimEvent({
      claimId: role.claimId,
      eventType: "other",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: input.lift ? `Restriction lifted on the ${role.role.toLowerCase()}'s data.` : `The ${role.role.toLowerCase()}'s data is restricted: keep it, but use it only with Justin's agreement. Reason: ${reason}`,
      source: "staff",
    });
  }
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, 'person-data', NULL, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    input.lift ? "restriction_lifted" : "restricted",
    input.lift ? "Restriction lifted" : `Restricted. Reason: ${reason}`,
  ]);
}

/** Why the person cannot be erased yet, or null. A legal hold or a claim still inside its retention period blocks it. */
export function erasureBlock(personId: string, asAtYmd = londonTodayIso()): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const role of personRoles(personId)) {
    // One reason per claim, however many roles the person has on it.
    if (role.anonymised || seen.has(role.claimId)) continue;
    seen.add(role.claimId);
    if (legalHold(role.claimId)) blocks.push(`${role.fileReference} is on legal hold`);
    else if (!role.closedOn) blocks.push(`${role.fileReference} is still open`);
    else {
      const [y, m, d] = role.closedOn.split("-").map(Number);
      const keepUntil = new Date(Date.UTC(y, m - 1 + (retentionMonths("claim") ?? 72), d)).toISOString().slice(0, 10);
      if (keepUntil > asAtYmd) blocks.push(`${role.fileReference} must be kept until ${formatUkDate(keepUntil)} under the retention schedule`);
    }
  }
  return blocks.length ? `Not erased: ${blocks.join("; ")}.` : null;
}

export function erasePerson(input: { actorId: string; personId: string; reason: string }) {
  ready();
  guard(input.actorId);
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter the reason for the erasure.");
  const block = erasureBlock(input.personId);
  if (block) throw new Error(block);
  const roles = personRoles(input.personId);
  anonymisePerson(input.personId);
  run(`INSERT INTO deletion_log(id, at, actor_id, kind, file_reference, what, reason) VALUES (?, ?, ?, 'erasure', ?, ?, ?)`, [
    newId("del"),
    nowUtcIso(),
    input.actorId,
    roles.map((role) => role.fileReference).join(", ") || null,
    `One person's details removed from ${roles.length} claims`,
    reason.slice(0, 500),
  ]);
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'erased', 'person-data', NULL, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    `One person's details erased. Reason: ${reason}`,
  ]);
}

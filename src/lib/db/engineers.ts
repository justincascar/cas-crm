import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso } from "../dates";
import { get, getDb, newId, run } from "./connection";

export type Engineer = {
  id: string;
  name: string;
  address: string;
  email: string;
  active: number;
  /** CAS's real engineer: kept in Settings for live use only, never offered on or sent to from TEST files (R40). */
  liveOnly?: number;
};

/** The fictional engineer the TEST files use. */
export const SEEDED_ENGINEER = {
  id: "eng-test-assessor",
  name: "Rhodri Testun, Example Assessors (fictional)",
  address: "Unit 1, Example Business Park, Cardiff, CF10 9ZZ",
  email: "engineer.test@example.org",
};

/** CAS's own engineer, as supplied by Justin. Live use only: not chosen on, or emailed from, TEST files. */
const CAS_LIVE_ENGINEER = {
  id: "eng-andy-montgomery",
  name: "Andy Montgomery, Montgomery Assessors",
  address: "Woodlands, Ham Lane South, Llantwit Major, Vale Of Glamorgan, CF61 1RU",
  email: "andy.mont@hotmail.co.uk",
};

export const LIVE_ONLY_ENGINEER_REFUSAL =
  "That is CAS's real engineer, kept for live use only. Nothing is sent to him from the test CRM. Choose the fictional engineer for TEST files.";

export const ENGINEER_INSTRUCTION_PREPARED = "prepared_not_sent";
export const ENGINEER_INSTRUCTION_MARKED_SENT = "handler_marked_sent";
export const CORRESPONDENCE_SENDING = "sending";

export function correspondenceCanBeMarkedSent(status: string | null, deliveredByMailbox = false): boolean {
  if (status === ENGINEER_INSTRUCTION_PREPARED) return true;
  return deliveredByMailbox && status === CORRESPONDENCE_SENDING;
}

function mapEngineer(row: {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  active: number;
  live_only?: number | null;
}): Engineer {
  return {
    id: row.id,
    name: row.name,
    address: row.address || "",
    email: row.email || "",
    active: Number(row.active),
    liveOnly: Number(row.live_only || 0),
  };
}

export function ensureEngineers(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engineers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      email TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const columns = new Set((db.prepare(`PRAGMA table_info(engineers)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("live_only")) db.exec(`ALTER TABLE engineers ADD COLUMN live_only INTEGER NOT NULL DEFAULT 0`);
  const now = nowUtcIso();
  for (const [engineer, liveOnly] of [
    [SEEDED_ENGINEER, 0],
    [CAS_LIVE_ENGINEER, 1],
  ] as const) {
    const existing = db.prepare(`SELECT id FROM engineers WHERE id = ? OR lower(email) = lower(?)`).get(engineer.id, engineer.email) as { id: string } | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO engineers(id, name, address, email, active, live_only, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(engineer.id, engineer.name, engineer.address, engineer.email, liveOnly, now, now);
    } else if (liveOnly) {
      db.prepare(`UPDATE engineers SET live_only = 1 WHERE id = ?`).run(existing.id);
    }
  }
  // TEST files never use the real engineer. A file that did is moved to the fictional one, with a note.
  const moved = db
    .prepare(
      `SELECT c.id FROM claims c JOIN engineers e ON e.id = c.engineer_id WHERE e.live_only = 1 AND c.file_reference LIKE 'TEST-%'`,
    )
    .all() as Array<{ id: string }>;
  for (const claim of moved) {
    db.prepare(`UPDATE claims SET engineer_id = ? WHERE id = ?`).run(SEEDED_ENGINEER.id, claim.id);
    db.prepare(
      `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, source)
       VALUES (?, ?, 'other', 'Other', ?, ?, ?, 'system')`,
    ).run(
      newId("event"),
      claim.id,
      `Engineer on this TEST file changed to the fictional engineer (${SEEDED_ENGINEER.name}). CAS's real engineer is kept in Settings for live use only and is never emailed from test files.`,
      now,
      now,
    );
  }
}

/** A live-only engineer's address: nothing is sent to it from this test CRM. */
export function isLiveOnlyEngineerEmail(email: string): boolean {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  return Boolean(get<{ id: string }>(`SELECT id FROM engineers WHERE live_only = 1 AND lower(email) = ?`, [address]));
}

export function listEngineersOn(db: DatabaseSync, opts?: { activeOnly?: boolean }): Engineer[] {
  const sql = opts?.activeOnly
    ? `SELECT id, name, address, email, active, live_only FROM engineers WHERE active = 1 AND live_only = 0 ORDER BY name COLLATE NOCASE`
    : `SELECT id, name, address, email, active, live_only FROM engineers ORDER BY active DESC, name COLLATE NOCASE`;
  return (db.prepare(sql).all() as Array<Engineer & { address: string | null; email: string | null }>).map(mapEngineer);
}

export function getEngineerOn(db: DatabaseSync, id: string): Engineer | undefined {
  const row = db
    .prepare(`SELECT id, name, address, email, active, live_only FROM engineers WHERE id = ?`)
    .get(id) as (Engineer & { address: string | null; email: string | null }) | undefined;
  return row ? mapEngineer(row) : undefined;
}

export function listActiveEngineers(): Engineer[] {
  return listEngineersOn(getDb(), { activeOnly: true });
}

export function listAllEngineers(): Engineer[] {
  return listEngineersOn(getDb());
}

export function getEngineer(id: string): Engineer | undefined {
  return getEngineerOn(getDb(), id);
}

export function createEngineer(input: { name: string; address: string; email: string }): Engineer {
  const name = input.name.trim();
  const address = input.address.trim();
  const email = input.email.trim();
  if (!name) throw new Error("Engineer name is required.");
  if (!address) throw new Error("Engineer address is required.");
  if (!email || !email.includes("@")) throw new Error("A valid engineer email address is required.");
  const duplicate = get<{ id: string }>(`SELECT id FROM engineers WHERE lower(email) = lower(?)`, [email]);
  if (duplicate) throw new Error("An engineer with that email is already on the list.");
  const now = nowUtcIso();
  const id = newId("eng");
  run(
    `INSERT INTO engineers(id, name, address, email, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [id, name, address, email, now, now],
  );
  return getEngineer(id)!;
}

export function updateEngineer(input: { id: string; name: string; address: string; email: string }) {
  const name = input.name.trim();
  const address = input.address.trim();
  const email = input.email.trim();
  if (!name) throw new Error("Engineer name is required.");
  if (!address) throw new Error("Engineer address is required.");
  if (!email || !email.includes("@")) throw new Error("A valid engineer email address is required.");
  const duplicate = get<{ id: string }>(`SELECT id FROM engineers WHERE lower(email) = lower(?) AND id != ?`, [
    email,
    input.id,
  ]);
  if (duplicate) throw new Error("An engineer with that email is already on the list.");
  run(`UPDATE engineers SET name = ?, address = ?, email = ?, updated_at = ? WHERE id = ?`, [
    name,
    address,
    email,
    nowUtcIso(),
    input.id,
  ]);
}

export function setEngineerActive(id: string, active: boolean) {
  run(`UPDATE engineers SET active = ?, updated_at = ? WHERE id = ?`, [active ? 1 : 0, nowUtcIso(), id]);
}

export function setClaimEngineer(claimId: string, engineerId: string | null) {
  if (engineerId) {
    const engineer = getEngineer(engineerId);
    if (!engineer || engineer.active !== 1) throw new Error("Pick an engineer from the saved list.");
    if (engineer.liveOnly === 1) throw new Error(LIVE_ONLY_ENGINEER_REFUSAL);
  }
  run(`UPDATE claims SET engineer_id = ?, updated_at = ? WHERE id = ?`, [engineerId, nowUtcIso(), claimId]);
}

export function findPreparedEngineerInstruction(claimId: string) {
  return get<{
    id: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    sent_status: string | null;
    created_at: string;
  }>(
    `SELECT id, subject, to_address, body, sent_status, created_at
     FROM correspondence
     WHERE claim_id = ? AND template_key = 'engineer_instruction' AND sent_status = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [claimId, ENGINEER_INSTRUCTION_PREPARED],
  );
}

import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso } from "../dates";
import { get, getDb, newId, run } from "./connection";

export type Engineer = {
  id: string;
  name: string;
  address: string;
  email: string;
  active: number;
};

export const SEEDED_ENGINEER = {
  id: "eng-andy-montgomery",
  name: "Andy Montgomery, Montgomery Assessors",
  address: "Woodlands, Ham Lane South, Llantwit Major, Vale Of Glamorgan, CF61 1RU",
  email: "andy.mont@hotmail.co.uk",
};

export const ENGINEER_INSTRUCTION_PREPARED = "prepared_not_sent";
export const ENGINEER_INSTRUCTION_MARKED_SENT = "handler_marked_sent";

function mapEngineer(row: {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  active: number;
}): Engineer {
  return {
    id: row.id,
    name: row.name,
    address: row.address || "",
    email: row.email || "",
    active: Number(row.active),
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
  const now = nowUtcIso();
  const existing = db
    .prepare(`SELECT id FROM engineers WHERE lower(email) = lower(?)`)
    .get(SEEDED_ENGINEER.email) as { id: string } | undefined;
  if (!existing) {
    const byId = db.prepare(`SELECT id FROM engineers WHERE id = ?`).get(SEEDED_ENGINEER.id) as { id: string } | undefined;
    if (!byId) {
      db.prepare(
        `INSERT INTO engineers(id, name, address, email, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(SEEDED_ENGINEER.id, SEEDED_ENGINEER.name, SEEDED_ENGINEER.address, SEEDED_ENGINEER.email, now, now);
    }
  }
}

export function listEngineersOn(db: DatabaseSync, opts?: { activeOnly?: boolean }): Engineer[] {
  const sql = opts?.activeOnly
    ? `SELECT id, name, address, email, active FROM engineers WHERE active = 1 ORDER BY name COLLATE NOCASE`
    : `SELECT id, name, address, email, active FROM engineers ORDER BY active DESC, name COLLATE NOCASE`;
  return (db.prepare(sql).all() as Array<Engineer & { address: string | null; email: string | null }>).map(mapEngineer);
}

export function getEngineerOn(db: DatabaseSync, id: string): Engineer | undefined {
  const row = db
    .prepare(`SELECT id, name, address, email, active FROM engineers WHERE id = ?`)
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

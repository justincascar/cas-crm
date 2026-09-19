import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso } from "../dates";
import {
  blankInsurerField,
  isUsableInsurerName,
  insurerNameKey,
  type KnownInsurer,
} from "../insurers";

/** Fictional demonstration contacts only. Not live insurer switchboard numbers. */
const DEMONSTRATION_INSURERS: KnownInsurer[] = [
  {
    name: "Admiral",
    address: "",
    postcode: "",
    telephone: "029 2000 4001",
    email: "motor.claims@admiral.example.test",
  },
  {
    name: "Aviva",
    address: "",
    postcode: "",
    telephone: "029 2000 4002",
    email: "motor.claims@aviva.example.test",
  },
  {
    name: "Zurich",
    address: "",
    postcode: "",
    telephone: "029 2000 4003",
    email: "motor.claims@zurich.example.test",
  },
  {
    name: "Hastings",
    address: "",
    postcode: "",
    telephone: "029 2000 4004",
    email: "motor.claims@hastings.example.test",
  },
  {
    name: "Ageas",
    address: "",
    postcode: "",
    telephone: "029 2000 4005",
    email: "motor.claims@ageas.example.test",
  },
];

/** Fictional demonstration TPI agent contacts only. Not live switchboard numbers. */
const DEMONSTRATION_AGENTS: KnownInsurer[] = [
  {
    name: "Keoghs",
    address: "",
    postcode: "",
    telephone: "029 2000 5001",
    email: "motor.claims@keoghs.example.test",
  },
  {
    name: "DAC Beachcroft",
    address: "",
    postcode: "",
    telephone: "029 2000 5002",
    email: "motor.claims@dacbeachcroft.example.test",
  },
  {
    name: "Horwich Farrelly",
    address: "",
    postcode: "",
    telephone: "029 2000 5003",
    email: "motor.claims@horwichfarrelly.example.test",
  },
];

export function ensureKnownInsurers(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_insurers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      address TEXT,
      postcode TEXT,
      telephone TEXT,
      email TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  for (const row of DEMONSTRATION_INSURERS) {
    rememberInsurerOn(db, row, { fillBlanksOnly: true });
  }
  let saved: Array<{
    name: string | null;
    address: string | null;
    postcode: string | null;
    telephone: string | null;
    email: string | null;
  }> = [];
  try {
    saved = db
      .prepare(
        `SELECT insurer_name AS name, insurer_address AS address, insurer_postcode AS postcode,
                insurer_tel AS telephone, insurer_email AS email
         FROM claim_third_parties
         WHERE insurer_name IS NOT NULL AND TRIM(insurer_name) != ''`,
      )
      .all() as typeof saved;
  } catch {
    saved = [];
  }
  for (const row of saved) {
    rememberInsurerOn(db, {
      name: row.name || "",
      address: row.address || "",
      postcode: row.postcode || "",
      telephone: row.telephone || "",
      email: row.email || "",
    });
  }
  ensureKnownAgents(db);
}

export function rememberInsurerOn(
  db: DatabaseSync,
  input: KnownInsurer,
  opts?: { fillBlanksOnly?: boolean },
) {
  if (!isUsableInsurerName(input.name)) return;
  const name = input.name.trim();
  const key = insurerNameKey(name);
  const now = nowUtcIso();
  const address = blankInsurerField(input.address);
  const postcode = blankInsurerField(input.postcode);
  const telephone = blankInsurerField(input.telephone);
  const email = blankInsurerField(input.email);
  const existing = db.prepare(`SELECT id FROM known_insurers WHERE name_key = ?`).get(key) as { id: string } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO known_insurers(id, name, name_key, address, postcode, telephone, email, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`insurer_${crypto.randomUUID()}`, name, key, address || null, postcode || null, telephone || null, email || null, now);
    return;
  }
  if (opts?.fillBlanksOnly) {
    db.prepare(
      `UPDATE known_insurers SET
        address = COALESCE(NULLIF(address, ''), ?),
        postcode = COALESCE(NULLIF(postcode, ''), ?),
        telephone = COALESCE(NULLIF(telephone, ''), ?),
        email = COALESCE(NULLIF(email, ''), ?),
        updated_at = ?
       WHERE id = ?`,
    ).run(address || null, postcode || null, telephone || null, email || null, now, existing.id);
    return;
  }
  db.prepare(
    `UPDATE known_insurers SET
      name = ?,
      address = COALESCE(NULLIF(?, ''), address),
      postcode = COALESCE(NULLIF(?, ''), postcode),
      telephone = COALESCE(NULLIF(?, ''), telephone),
      email = COALESCE(NULLIF(?, ''), email),
      updated_at = ?
     WHERE id = ?`,
  ).run(name, address, postcode, telephone, email, now, existing.id);
}

export function listKnownInsurersOn(db: DatabaseSync): KnownInsurer[] {
  return (
    db
      .prepare(`SELECT name, address, postcode, telephone, email FROM known_insurers ORDER BY name COLLATE NOCASE`)
      .all() as Array<{
      name: string;
      address: string | null;
      postcode: string | null;
      telephone: string | null;
      email: string | null;
    }>
  ).map((row) => ({
    name: row.name,
    address: row.address || "",
    postcode: row.postcode || "",
    telephone: row.telephone || "",
    email: row.email || "",
  }));
}

export function findKnownInsurerOn(db: DatabaseSync, name: string): KnownInsurer | null {
  const key = insurerNameKey(name);
  if (!key) return null;
  const row = db
    .prepare(`SELECT name, address, postcode, telephone, email FROM known_insurers WHERE name_key = ?`)
    .get(key) as
    | {
        name: string;
        address: string | null;
        postcode: string | null;
        telephone: string | null;
        email: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    address: row.address || "",
    postcode: row.postcode || "",
    telephone: row.telephone || "",
    email: row.email || "",
  };
}

function ensureKnownAgents(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      address TEXT,
      postcode TEXT,
      telephone TEXT,
      email TEXT,
      handler_name TEXT,
      handler_email TEXT,
      handler_tel TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  for (const row of DEMONSTRATION_AGENTS) {
    rememberAgentOn(db, row, { fillBlanksOnly: true });
  }
  let saved: Array<{
    name: string | null;
    address: string | null;
    postcode: string | null;
    telephone: string | null;
    email: string | null;
    handlerName: string | null;
    handlerEmail: string | null;
    handlerTel: string | null;
  }> = [];
  try {
    saved = db
      .prepare(
        `SELECT agent_name AS name, agent_address AS address, agent_postcode AS postcode,
                agent_tel AS telephone, agent_email AS email,
                agent_handler_name AS handlerName, agent_handler_email AS handlerEmail, agent_handler_tel AS handlerTel
         FROM claim_third_parties
         WHERE agent_name IS NOT NULL AND TRIM(agent_name) != ''`,
      )
      .all() as typeof saved;
  } catch {
    saved = [];
  }
  for (const row of saved) {
    rememberAgentOn(db, {
      name: row.name || "",
      address: row.address || "",
      postcode: row.postcode || "",
      telephone: row.telephone || "",
      email: row.email || "",
      handlerName: row.handlerName || "",
      handlerEmail: row.handlerEmail || "",
      handlerTel: row.handlerTel || "",
    });
  }
}

export function rememberAgentOn(
  db: DatabaseSync,
  input: KnownInsurer,
  opts?: { fillBlanksOnly?: boolean },
) {
  if (!isUsableInsurerName(input.name)) return;
  const name = input.name.trim();
  const key = insurerNameKey(name);
  const now = nowUtcIso();
  const address = blankInsurerField(input.address);
  const postcode = blankInsurerField(input.postcode);
  const telephone = blankInsurerField(input.telephone);
  const email = blankInsurerField(input.email);
  const handlerName = blankInsurerField(input.handlerName);
  const handlerEmail = blankInsurerField(input.handlerEmail);
  const handlerTel = blankInsurerField(input.handlerTel);
  const existing = db.prepare(`SELECT id FROM known_agents WHERE name_key = ?`).get(key) as { id: string } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO known_agents(id, name, name_key, address, postcode, telephone, email, handler_name, handler_email, handler_tel, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `agent_${crypto.randomUUID()}`,
      name,
      key,
      address || null,
      postcode || null,
      telephone || null,
      email || null,
      handlerName || null,
      handlerEmail || null,
      handlerTel || null,
      now,
    );
    return;
  }
  if (opts?.fillBlanksOnly) {
    db.prepare(
      `UPDATE known_agents SET
        address = COALESCE(NULLIF(address, ''), ?),
        postcode = COALESCE(NULLIF(postcode, ''), ?),
        telephone = COALESCE(NULLIF(telephone, ''), ?),
        email = COALESCE(NULLIF(email, ''), ?),
        handler_name = COALESCE(NULLIF(handler_name, ''), ?),
        handler_email = COALESCE(NULLIF(handler_email, ''), ?),
        handler_tel = COALESCE(NULLIF(handler_tel, ''), ?),
        updated_at = ?
       WHERE id = ?`,
    ).run(
      address || null,
      postcode || null,
      telephone || null,
      email || null,
      handlerName || null,
      handlerEmail || null,
      handlerTel || null,
      now,
      existing.id,
    );
    return;
  }
  db.prepare(
    `UPDATE known_agents SET
      name = ?,
      address = COALESCE(NULLIF(?, ''), address),
      postcode = COALESCE(NULLIF(?, ''), postcode),
      telephone = COALESCE(NULLIF(?, ''), telephone),
      email = COALESCE(NULLIF(?, ''), email),
      handler_name = COALESCE(NULLIF(?, ''), handler_name),
      handler_email = COALESCE(NULLIF(?, ''), handler_email),
      handler_tel = COALESCE(NULLIF(?, ''), handler_tel),
      updated_at = ?
     WHERE id = ?`,
  ).run(name, address, postcode, telephone, email, handlerName, handlerEmail, handlerTel, now, existing.id);
}

export function listKnownAgentsOn(db: DatabaseSync): KnownInsurer[] {
  return (
    db
      .prepare(
        `SELECT name, address, postcode, telephone, email, handler_name, handler_email, handler_tel
         FROM known_agents ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{
      name: string;
      address: string | null;
      postcode: string | null;
      telephone: string | null;
      email: string | null;
      handler_name: string | null;
      handler_email: string | null;
      handler_tel: string | null;
    }>
  ).map((row) => ({
    name: row.name,
    address: row.address || "",
    postcode: row.postcode || "",
    telephone: row.telephone || "",
    email: row.email || "",
    handlerName: row.handler_name || "",
    handlerEmail: row.handler_email || "",
    handlerTel: row.handler_tel || "",
  }));
}

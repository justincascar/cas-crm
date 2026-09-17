import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ensureStaffAuth } from "../auth/ensure";
import { backfillChronologyIfEmpty, seedIfEmpty } from "./seed";
import { migrate } from "./migrate";

type GlobalDb = typeof globalThis & { __casDb?: DatabaseSync };

function databasePath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const root = process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
  const dir = path.join(root, "CAS-CRM");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "cas-crm.sqlite");
}

function openDatabase(): DatabaseSync {
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const schemaPath = path.join(process.cwd(), "src", "lib", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  migrate(db);
  seedIfEmpty(db);
  ensureStaffAuth(db);
  backfillChronologyIfEmpty(db);
  return db;
}

export function getDb(): DatabaseSync {
  const g = globalThis as GlobalDb;
  if (!g.__casDb) {
    g.__casDb = openDatabase();
  } else {
    migrate(g.__casDb);
    ensureStaffAuth(g.__casDb);
    backfillChronologyIfEmpty(g.__casDb);
  }
  return g.__casDb;
}

/** Run a function against a supplied database (tests). Restores the previous connection afterwards. */
export function withDatabase<T>(db: DatabaseSync, fn: () => T): T {
  const g = globalThis as GlobalDb;
  const previous = g.__casDb;
  g.__casDb = db;
  try {
    return fn();
  } finally {
    g.__casDb = previous;
  }
}

export async function withDatabaseAsync<T>(db: DatabaseSync, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as GlobalDb;
  const previous = g.__casDb;
  g.__casDb = db;
  try {
    return await fn();
  } finally {
    g.__casDb = previous;
  }
}

export function dbPath(): string {
  return databasePath();
}

export function newId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export type SqlRow = Record<string, string | number | null>;

export function all<T extends SqlRow>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T extends SqlRow>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): void {
  getDb().prepare(sql).run(...params);
}

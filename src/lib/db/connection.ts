import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ensureStaffAuth } from "../auth/ensure";
import { backfillChronologyIfEmpty, seedIfEmpty } from "./seed";
import { ensureEngineers } from "./engineers";
import { ensureKnownInsurers } from "./insurers";
import { ensureDefaultVehicleLocationSetting } from "./vehicle-location";
import { ensureChaseSettings, ensureDemoChases } from "./chase";
import { ensureRealFleet } from "./fleet";
import { ensureDemoDayJobs } from "./demo-jobs";
import { migrate } from "./migrate";

type GlobalDb = typeof globalThis & { __casDb?: DatabaseSync };

const preparedDatabases = new WeakSet<DatabaseSync>();

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
  ensureKnownInsurers(db);
  ensureEngineers(db);
  ensureDefaultVehicleLocationSetting(db);
  ensureChaseSettings(db);
  ensureDemoChases(db);
  ensureStaffAuth(db);
  ensureDemoDayJobs(db);
  ensureRealFleet(db);
  backfillChronologyIfEmpty(db);
  preparedDatabases.add(db);
  return db;
}

function prepareExistingDatabase(db: DatabaseSync) {
  if (preparedDatabases.has(db)) return;
  migrate(db);
  ensureKnownInsurers(db);
  ensureEngineers(db);
  ensureDefaultVehicleLocationSetting(db);
  ensureChaseSettings(db);
  ensureDemoChases(db);
  ensureStaffAuth(db);
  ensureDemoDayJobs(db);
  backfillChronologyIfEmpty(db);
  preparedDatabases.add(db);
}

export function getDb(): DatabaseSync {
  const g = globalThis as GlobalDb;
  if (!g.__casDb) {
    g.__casDb = openDatabase();
  } else {
    prepareExistingDatabase(g.__casDb);
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

let sqlCount = 0;

export function resetSqlStatementCount() {
  sqlCount = 0;
}

export function sqlStatementCount(): number {
  return sqlCount;
}

export function all<T extends SqlRow>(sql: string, params: unknown[] = []): T[] {
  sqlCount += 1;
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T extends SqlRow>(sql: string, params: unknown[] = []): T | undefined {
  sqlCount += 1;
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): void {
  sqlCount += 1;
  getDb().prepare(sql).run(...params);
}

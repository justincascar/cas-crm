import type { DatabaseSync } from "node:sqlite";
import { DEMO_STAFF, demoPasswordFor } from "./demo-staff";
import { hashPasswordSync } from "./passwords";

function columnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function run(db: DatabaseSync, sql: string, params: unknown[] = []) {
  db.prepare(sql).run(...params);
}

function get<T>(db: DatabaseSync, sql: string, params: unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function ensureStaffAuth(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  const columns = columnNames(db, "staff");
  if (!columns.has("username")) {
    db.exec("ALTER TABLE staff ADD COLUMN username TEXT");
  }
  if (!columns.has("password_hash")) {
    db.exec("ALTER TABLE staff ADD COLUMN password_hash TEXT");
  }

  for (const person of DEMO_STAFF) {
    const existing = get<{ id: string; username: string | null; password_hash: string | null }>(
      db,
      "SELECT id, username, password_hash FROM staff WHERE id = ?",
      [person.id],
    );
    if (!existing) {
      run(
        db,
        `INSERT INTO staff(id, name, email, username, password_hash, role, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [person.id, person.name, person.email, person.username, hashPasswordSync(demoPasswordFor(person.username)), person.role],
      );
      continue;
    }
    if (!existing.username) {
      run(db, "UPDATE staff SET username = ? WHERE id = ?", [person.username, person.id]);
    }
    if (!existing.password_hash) {
      run(db, "UPDATE staff SET password_hash = ? WHERE id = ?", [
        hashPasswordSync(demoPasswordFor(person.username)),
        person.id,
      ]);
    }
  }
}

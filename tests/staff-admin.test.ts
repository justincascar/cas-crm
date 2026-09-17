import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { DEMO_STAFF } from "../src/lib/auth/demo-staff.ts";
import { ensureStaffAuth } from "../src/lib/auth/ensure.ts";
import { isAdministrator } from "../src/lib/auth/roles.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  createStaffAccount,
  setStaffActive,
  setStaffRole,
} from "../src/lib/db/staff-admin.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("administrator role", () => {
  it("seeds Justin Roberts as administrator and the other three as staff", () => {
    const db = seeded();
    const rows = db.prepare("SELECT id, username, role FROM staff ORDER BY username").all() as Array<{
      id: string;
      username: string;
      role: string;
    }>;
    assert.equal(rows.find((r) => r.username === "justin")?.role, "administrator");
    assert.equal(isAdministrator("administrator"), true);
    assert.equal(isAdministrator("staff"), false);
    for (const username of ["sian", "tom", "megan"]) {
      assert.equal(rows.find((r) => r.username === username)?.role, "staff");
    }
    db.close();
  });

  it("maps older md/handler roles on an existing database", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        username TEXT,
        password_hash TEXT,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO staff(id, name, email, role, active) VALUES (?, ?, ?, ?, 1)").run(
      DEMO_STAFF[0].id,
      DEMO_STAFF[0].name,
      DEMO_STAFF[0].email,
      "md",
    );
    db.prepare("INSERT INTO staff(id, name, email, role, active) VALUES (?, ?, ?, ?, 1)").run(
      DEMO_STAFF[1].id,
      DEMO_STAFF[1].name,
      DEMO_STAFF[1].email,
      "handler",
    );
    ensureStaffAuth(db);
    const justin = db.prepare("SELECT role FROM staff WHERE id = ?").get("staff-justin") as { role: string };
    const sian = db.prepare("SELECT role FROM staff WHERE id = ?").get("staff-sian") as { role: string };
    assert.equal(justin.role, "administrator");
    assert.equal(sian.role, "staff");
    db.close();
  });

  it("lets an administrator create a login and refuses to disable the last administrator", () => {
    const db = seeded();
    withDatabase(db, () => {
      const created = createStaffAccount({
        name: "Nia Williams",
        username: "nia",
        email: "nia@completeaccidentsolutions.example",
        password: "CasDemo.NiaExtra",
        role: "staff",
        actorId: "staff-justin",
      });
      assert.equal(created.ok, true);
      const lastAdmin = setStaffActive("staff-justin", false, "staff-justin");
      assert.equal(lastAdmin.ok, false);
      if (!lastAdmin.ok) assert.match(lastAdmin.error, /your own login|at least one active administrator/i);
      const demote = setStaffRole("staff-justin", "staff", "staff-justin");
      assert.equal(demote.ok, false);
    });
    db.close();
  });
});

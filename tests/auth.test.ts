import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { DEMO_STAFF, demoPasswordFor } from "../src/lib/auth/demo-staff.ts";
import { ensureStaffAuth } from "../src/lib/auth/ensure.ts";
import { hashPasswordSync, verifyPassword } from "../src/lib/auth/passwords.ts";
import { seed } from "../src/lib/db/seed.ts";

function schema() {
  return fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
}

describe("staff passwords", () => {
  it("hashes and verifies, and rejects the wrong password", () => {
    const stored = hashPasswordSync("CasDemo.Sian");
    assert.match(stored, /^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
    assert.equal(stored.includes("CasDemo.Sian"), false);
    assert.equal(verifyPassword("CasDemo.Sian", stored), true);
    assert.equal(verifyPassword("wrong-password", stored), false);
  });
});

describe("seeded staff credentials", () => {
  it("stores hashed passwords for the four demonstration staff, not plain text", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(schema());
    seed(db);
    const rows = db.prepare("SELECT username, password_hash FROM staff ORDER BY username").all() as Array<{
      username: string;
      password_hash: string;
    }>;
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.username),
      ["justin", "megan", "sian", "tom"],
    );
    for (const row of rows) {
      const password = demoPasswordFor(row.username);
      assert.match(row.password_hash, /^scrypt\$/);
      assert.equal(row.password_hash.includes(password), false);
      assert.equal(verifyPassword(password, row.password_hash), true);
    }
    db.close();
  });

  it("adds usernames and hashes to an existing staff table that has none", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
    `);
    const first = DEMO_STAFF[0];
    db.prepare("INSERT INTO staff(id, name, email, role, active) VALUES (?, ?, ?, ?, 1)").run(
      first.id,
      first.name,
      first.email,
      first.role,
    );
    ensureStaffAuth(db);
    const row = db.prepare("SELECT username, password_hash FROM staff WHERE id = ?").get(first.id) as {
      username: string;
      password_hash: string;
    };
    assert.equal(row.username, "justin");
    assert.equal(verifyPassword(demoPasswordFor("justin"), row.password_hash), true);
    db.close();
  });
});

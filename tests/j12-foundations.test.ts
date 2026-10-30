import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { canExportAndAudit, listAudit } from "../src/lib/db/audit-view.ts";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { writeScreenIfCurrent } from "../src/lib/db/record-version.ts";
import { seed } from "../src/lib/db/seed.ts";
import { makeBackup, restoreBackup } from "../src/lib/ops/backup.ts";
import { buildFullExport, parseCsv, readFullExport, toCsv } from "../src/lib/ops/export.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function seededInto(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function tempDir(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cas-j12-${label}-`));
}

describe("J12 — foundations", () => {
  it("writes every table as CSV plus the documents into one zip that reads back", () => {
    const db = seededInto(":memory:");
    const files = tempDir("files");
    fs.mkdirSync(path.join(files, "claims", "c1", "documents"), { recursive: true });
    fs.writeFileSync(path.join(files, "claims", "c1", "documents", "letter.pdf"), "%PDF-1.4 fictional");
    const { zip, summary } = buildFullExport(db, files);
    const back = readFullExport(zip);
    const claims = Number((db.prepare(`SELECT COUNT(*) AS n FROM claims`).get() as { n: number }).n);
    assert.equal(back.tables.claims.length - 1, claims, "one CSV row per claim, after the header");
    for (const table of ["claims", "people", "financial_lines", "claim_events", "documents"]) assert.ok(back.tables[table], `${table} is in the export`);
    assert.ok(!back.tables.sessions, "sign-in sessions are left out");
    assert.ok(!back.tables.staff[0].includes("password_hash"), "password hashes are left out");
    assert.equal(back.documents.get("claims/c1/documents/letter.pdf")?.toString(), "%PDF-1.4 fictional");
    assert.equal(summary.documents, 1);
    db.close();
  });

  it("keeps commas, quotes and line breaks in a CSV cell", () => {
    const text = toCsv(["a", "b"], [{ a: 'He said "stop", then', b: "line one\nline two" }]);
    assert.deepEqual(parseCsv(text), [["a", "b"], ['He said "stop", then', "line one\nline two"]]);
  });

  it("backs up, and restores into a separate copy that matches the backup and not later changes", () => {
    const home = tempDir("live");
    const databasePath = path.join(home, "cas-crm.sqlite");
    const files = path.join(home, "files");
    fs.mkdirSync(path.join(files, "claims"), { recursive: true });
    fs.writeFileSync(path.join(files, "claims", "note.txt"), "fictional document");
    const live = seededInto(databasePath);
    const originalRef = (live.prepare(`SELECT file_reference FROM claims WHERE id = 'c1'`).get() as { file_reference: string }).file_reference;
    live.close();
    const backupsRoot = path.join(home, "backups");
    const folder = makeBackup({ databasePath, filesRoot: files, backupsRoot });
    assert.ok(fs.existsSync(path.join(folder, "manifest.json")));

    // Change the live data after the backup.
    const changed = new DatabaseSync(databasePath);
    changed.prepare(`UPDATE claims SET file_reference = 'CHANGED-AFTER-BACKUP' WHERE id = 'c1'`).run();
    changed.prepare(`DELETE FROM claim_events WHERE claim_id = 'c1'`).run();
    changed.close();
    fs.writeFileSync(path.join(files, "claims", "later.txt"), "added after the backup");

    assert.throws(() => restoreBackup({ backupFolder: folder, targetFolder: home, liveDatabasePath: databasePath }), /separate folder/);
    const target = path.join(home, "restore-test");
    const problems = restoreBackup({ backupFolder: folder, targetFolder: target, liveDatabasePath: databasePath });
    assert.deepEqual(problems, [], "the restored copy matches the backup");
    const restored = new DatabaseSync(path.join(target, "cas-crm.sqlite"), { readOnly: true });
    assert.equal((restored.prepare(`SELECT file_reference FROM claims WHERE id = 'c1'`).get() as { file_reference: string }).file_reference, originalRef);
    assert.ok(Number((restored.prepare(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c1'`).get() as { n: number }).n) > 0);
    restored.close();
    assert.ok(fs.existsSync(path.join(target, "files", "claims", "note.txt")));
    assert.ok(!fs.existsSync(path.join(target, "files", "claims", "later.txt")));
    assert.throws(() => restoreBackup({ backupFolder: folder, targetFolder: target }), /already a database/);
  });

  it("shows who changed what and when, with filters, to Justin only", () => {
    const db = seededInto(":memory:");
    withDatabase(db, () => {
      assert.equal(canExportAndAudit("staff-justin"), true);
      assert.equal(canExportAndAudit("staff-sian"), false);
      const saved = writeScreenIfCurrent({ claimId: "c1", screenKey: "general", expected: "", actorId: "staff-sian", stored: { ourPolicy: "Broker policy" }, labels: { ourPolicy: "Our policy / source" } });
      writeScreenIfCurrent({ claimId: "c1", screenKey: "general", expected: saved.now, actorId: "staff-tom", stored: { ourPolicy: "Client's own policy" }, labels: { ourPolicy: "Our policy / source" } });
      const reference = String(get<{ r: string }>(`SELECT file_reference AS r FROM claims WHERE id = 'c1'`)?.r);
      const saves = listAudit({ claim: reference, kind: "save" });
      assert.equal(saves.length, 2);
      assert.equal(saves[0].who, "Tom Hughes");
      assert.equal(saves[0].what, "Saved the General details screen");
      assert.equal(saves[0].detail, "Our policy / source: Broker policy → Client's own policy");
      assert.equal(saves[0].reference, reference);
      assert.equal(listAudit({ claim: reference, kind: "save", staffId: "staff-sian" }).length, 1);
      assert.ok(listAudit({ claim: reference, kind: "history" }).every((row) => row.kind === "history" && row.reference === reference));
      assert.equal(listAudit({ claim: "TEST-9999" }).length, 0);
      writeScreenIfCurrent({ claimId: "c2", screenKey: "general", expected: "", actorId: "staff-sian", stored: { claimTypeRta: "rta" }, labels: { claimTypeRta: "Claim type" } });
      const c2 = String(get<{ r: string }>(`SELECT file_reference AS r FROM claims WHERE id = 'c2'`)?.r);
      assert.equal(listAudit({ claim: c2, kind: "save" })[0].detail, "Claim type: blank → RTA", "a choice shows as staff saw it");
    });
    db.close();
  });
});

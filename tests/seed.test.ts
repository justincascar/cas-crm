import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import path from "node:path";
import { seed } from "../src/lib/db/seed.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("seeded prototype data", () => {
  it("loads twelve TEST claims covering the main operational branches", () => {
    const db = seeded();
    const claims = db.prepare("SELECT file_reference, hire_status, roadworthiness, claim_type FROM claims ORDER BY file_reference").all() as Array<{
      file_reference: string;
      hire_status: string;
      roadworthiness: string;
      claim_type: string;
    }>;
    assert.equal(claims.length, 12);
    assert.ok(claims.every((c) => c.file_reference.startsWith("TEST-")));
    const roadworthyReserved = db.prepare(
      "SELECT charges_started FROM reservations WHERE claim_id = 'c2'",
    ).get() as { charges_started: number };
    assert.equal(roadworthyReserved.charges_started, 0);
    const courtesy = db.prepare("SELECT credit_hire FROM hire_episodes WHERE claim_id = 'c4'").get() as { credit_hire: number };
    assert.equal(courtesy.credit_hire, 0);
    const ready = db.prepare(
      "SELECT repairs_complete, repaired_vehicle_returned FROM claims WHERE id = 'c8'",
    ).get() as { repairs_complete: number; repaired_vehicle_returned: number };
    assert.equal(ready.repairs_complete, 1);
    assert.equal(ready.repaired_vehicle_returned, 0);
    const unsigned = db.prepare("SELECT signed, signature_status FROM agreements WHERE id = 'ag-c11b'").get() as {
      signed: number;
      signature_status: string;
    };
    assert.equal(unsigned.signed, 0);
    assert.equal(unsigned.signature_status, "unsigned_urgent");
    const letter = db.prepare(
      "SELECT title FROM claim_events WHERE claim_id = 'c3' AND event_type = 'initial_letter_tp_insurer'",
    ).get() as { title: string };
    assert.equal(letter.title, "Initial letter to third-party insurer");
    db.close();
  });
});

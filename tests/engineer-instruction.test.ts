import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  instructEngineer,
  letterPreview,
  listClaimEvents,
  markEngineerInstructionSent,
} from "../src/lib/db/chronology.ts";
import {
  ENGINEER_INSTRUCTION_MARKED_SENT,
  ENGINEER_INSTRUCTION_PREPARED,
  SEEDED_ENGINEER,
  createEngineer,
  ensureEngineers,
  listActiveEngineers,
  listAllEngineers,
  setClaimEngineer,
} from "../src/lib/db/engineers.ts";
import { seed } from "../src/lib/db/seed.ts";
import { generateLetter } from "../src/lib/documents/templates.ts";
import { emptyCorrespondenceFields } from "../src/lib/documents/correspondence.ts";
import { parseMailtoHref } from "../src/lib/email/mailto.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
  return db;
}

describe("saved engineers", () => {
  it("seeds the fictional engineer for TEST files, keeps CAS's real engineer for live use only, and can add further engineers later", () => {
    const db = seeded();
    withDatabase(db, () => {
      ensureEngineers(db);
      const first = listActiveEngineers();
      assert.equal(first.length, 1);
      assert.equal(first[0]?.name, SEEDED_ENGINEER.name);
      assert.equal(first[0]?.address, SEEDED_ENGINEER.address);
      assert.equal(first[0]?.email, SEEDED_ENGINEER.email);

      const extra = createEngineer({
        name: "Example Assessors Ltd",
        address: "1 Example Street, Cardiff, CF10 1AA",
        email: "reports@example-assessors.test",
      });
      const listed = listAllEngineers();
      // The fictional engineer, CAS's real engineer (live use only, never offered on a file) and the new one.
      assert.equal(listed.length, 3);
      assert.equal(listed.filter((row) => row.liveOnly === 1).length, 1);
      assert.ok(!listActiveEngineers().some((row) => row.liveOnly === 1));
      assert.ok(listed.some((row) => row.id === extra.id));
      assert.ok(listed.some((row) => row.email === SEEDED_ENGINEER.email));
    });
    db.close();
  });
});

describe("engineer instruction letter", () => {
  it("fills the seeded engineer's name and address into the generated letter", () => {
    const letter = generateLetter("engineer_instruction", {
      fileReference: "TEST-0003",
      clientName: "Ceri Walsh",
      handlerName: "Tom Hughes",
      accidentAt: "2026-09-09T07:00:00.000Z",
      accidentLocation: "M4 Junction 42, Swansea",
      circumstances: "Undriveable after offside impact.",
      registration: "SA12 CWA",
      make: "Volkswagen",
      model: "Golf",
      tpInsurer: "Unknown",
      tpPolicyOrClaimRef: "Unknown",
      ownInsurer: "Unknown",
      ownPolicyRef: "Unknown",
      dates: {},
      letterDate: "2026-09-19T08:00:00.000Z",
      ...emptyCorrespondenceFields(),
      engineerName: SEEDED_ENGINEER.name,
      engineerAddress: SEEDED_ENGINEER.address,
      engineerEmail: SEEDED_ENGINEER.email,
      vehicleLocation: "CAS compound, Swansea",
    });
    assert.match(letter.text, /Rhodri Testun, Example Assessors \(fictional\)/);
    assert.match(letter.text, /Unit 1, Example Business Park, Cardiff, CF10 9ZZ/);
    assert.match(letter.text, /Dear Rhodri Testun, Example Assessors \(fictional\)/);
    assert.match(letter.html, /Unit 1, Example Business Park/);
    assert.match(letter.text, new RegExp(CAS_CLAIMS_MAILBOX));
    assert.equal(letter.missing.includes("Engineer name"), false);
    assert.equal(letter.missing.includes("Engineer address"), false);
  });

  it("uses the claim's selected engineer when generating from the file", () => {
    const db = seeded();
    withDatabase(db, () => {
      setClaimEngineer("c3", SEEDED_ENGINEER.id);
      const preview = letterPreview("c3", "engineer_instruction");
      assert.match(preview.text, /Rhodri Testun, Example Assessors \(fictional\)/);
      assert.match(preview.text, /Unit 1, Example Business Park, Cardiff, CF10 9ZZ/);
      assert.match(preview.html, /Rhodri Testun, Example Assessors \(fictional\)/);
    });
    db.close();
  });
});

describe("instruct engineer — prepared, not auto-sent", () => {
  it("prepares a mailto to the selected engineer and logs mark-as-sent in history", () => {
    const db = seeded();
    withDatabase(db, () => {
      const prepared = instructEngineer({
        claimId: "c3",
        engineerId: SEEDED_ENGINEER.id,
        actorId: "staff-justin",
      });
      assert.equal(prepared.to, SEEDED_ENGINEER.email);
      const mailto = parseMailtoHref(prepared.mailto);
      assert.equal(mailto.to, SEEDED_ENGINEER.email);
      assert.match(mailto.subject, /Engineer instruction/);
      assert.match(mailto.subject, /TEST-0003/);
      assert.match(mailto.body, /Rhodri Testun, Example Assessors \(fictional\)/);
      assert.match(mailto.body, /Unit 1, Example Business Park/);
      assert.doesNotMatch(mailto.body, /Live sending is not connected/);

      const pending = db
        .prepare(`SELECT sent_status, to_address, from_address FROM correspondence WHERE id = ?`)
        .get(prepared.correspondenceId) as {
        sent_status: string;
        to_address: string;
        from_address: string;
      };
      assert.equal(pending.sent_status, ENGINEER_INSTRUCTION_PREPARED);
      assert.equal(pending.to_address, SEEDED_ENGINEER.email);
      assert.equal(pending.from_address, CAS_CLAIMS_MAILBOX);

      const beforeMark = listClaimEvents("c3");
      assert.equal(
        beforeMark.some((event) => event.event_type === "engineer_instructed" && event.correspondence_id === prepared.correspondenceId),
        false,
      );

      const marked = markEngineerInstructionSent({
        claimId: "c3",
        correspondenceId: prepared.correspondenceId,
        actorId: "staff-justin",
      });
      assert.equal(marked.handlerName, "Justin Roberts");

      const sent = db
        .prepare(`SELECT sent_status FROM correspondence WHERE id = ?`)
        .get(prepared.correspondenceId) as { sent_status: string };
      assert.equal(sent.sent_status, ENGINEER_INSTRUCTION_MARKED_SENT);

      const events = listClaimEvents("c3").filter((event) => event.correspondence_id === prepared.correspondenceId);
      const instructed = events.find((event) => event.event_type === "engineer_instructed");
      const emailed = events.find((event) => event.event_type === "outgoing_email");
      assert.ok(instructed);
      assert.equal(instructed.actor_name, "Justin Roberts");
      assert.ok(instructed.occurred_at);
      assert.match(String(instructed.details), /Justin Roberts/);
      assert.match(String(instructed.details), /Not auto-sent|prepared, not auto-sent/i);
      assert.ok(emailed);
      assert.equal(emailed.actor_name, "Justin Roberts");
      assert.match(String(emailed.details), /engineer\.test@example\.org/);
    });
    db.close();
  });
});

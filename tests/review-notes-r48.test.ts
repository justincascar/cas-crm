import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { combinedChaseEmail } from "../src/lib/db/auto-chasers.ts";
import { ensureChaseSettings, ensureDemoChases } from "../src/lib/db/chase.ts";
import { chaseHistoryLine } from "../src/lib/db/chase-history.ts";
import { letterPreview, prepareOutstandingChase, recordClaimEvent } from "../src/lib/db/chronology.ts";
import { run, withDatabase } from "../src/lib/db/connection.ts";
import { ensureEngineers } from "../src/lib/db/engineers.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { chaseHistorySentence, withChaseHistory } from "../src/lib/domain/chase-history.ts";

process.env.EMAIL_SEND_MODE = "simulate";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  ensureEngineers(db);
  ensureChaseSettings(db);
  ensureDemoChases(db);
  return db;
}

const CLAIM = "c5";
const LIABILITY_EVENTS = ["initial_letter_tp_insurer", "initial_letter_own_insurer", "liability_response_chase_sent", "liability_chase_sent", "chase_reply_substantive"];

/** TEST-0005's liability chase with only the events these tests add. */
function liabilityFile() {
  run(`DELETE FROM claim_events WHERE claim_id = ? AND event_type IN (${LIABILITY_EVENTS.map(() => "?").join(", ")})`, [CLAIM, ...LIABILITY_EVENTS]);
  run(`UPDATE claim_third_parties SET insurer_email = 'aviva.handler@example.test' WHERE id = 'tp-c5'`);
}

function event(eventType: string, occurredAt: string, details = "") {
  recordClaimEvent({ claimId: CLAIM, eventType, occurredAt, details, actorId: "staff-sian", source: "staff" });
}

function liabilityChaser() {
  return prepareOutstandingChase({ claimId: CLAIM, actorId: "staff-sian", kind: "liability_response" }).body;
}

describe("R48 — every chaser says when we first wrote and how often we have chased", () => {
  it("first chaser: says when we wrote and that no response has come, with no count", () => {
    const db = seeded();
    withDatabase(db, () => {
      liabilityFile();
      event("initial_letter_tp_insurer", "2026-10-03T11:00:00.000Z");
      const body = liabilityChaser();
      const lines = body.split("\n");
      assert.match(lines[0]!, /^Dear /);
      assert.equal(lines[2], "We wrote to you on 03/10/2026 requesting your decision on liability and have not yet received a response.");
      assert.doesNotMatch(body, /occasion/);
    });
    db.close();
  });

  it("fourth chaser: counts the three chasers already sent and gives the latest date, not every date", () => {
    const db = seeded();
    withDatabase(db, () => {
      liabilityFile();
      event("initial_letter_tp_insurer", "2026-10-03T11:00:00.000Z");
      event("liability_response_chase_sent", "2026-10-06T11:00:00.000Z");
      event("liability_response_chase_sent", "2026-10-09T11:00:00.000Z");
      event("liability_chase_sent", "2026-10-12T11:00:00.000Z");
      const body = liabilityChaser();
      assert.match(
        body,
        /We first wrote to you on 03\/10\/2026 requesting your decision on liability and have chased on 3 occasions since, most recently on 12\/10\/2026\./,
      );
      assert.doesNotMatch(body, /06\/10\/2026|09\/10\/2026/);
    });
    db.close();
  });

  it("a chase restarted after a substantive reply counts from the reply, and says so", () => {
    const db = seeded();
    withDatabase(db, () => {
      liabilityFile();
      event("initial_letter_tp_insurer", "2026-10-03T11:00:00.000Z");
      event("liability_response_chase_sent", "2026-10-06T11:00:00.000Z");
      event("liability_response_chase_sent", "2026-10-09T11:00:00.000Z");
      event("chase_reply_substantive", "2026-10-14T11:00:00.000Z", "The insurer replied to the liability response chase chase with a decision, offer or dispute.");
      assert.equal(
        chaseHistoryLine(CLAIM, "liability_response"),
        "We first wrote to you on 03/10/2026 requesting your decision on liability. Since your reply of 14/10/2026 this remains outstanding.",
      );
      event("liability_response_chase_sent", "2026-10-18T11:00:00.000Z");
      assert.match(
        liabilityChaser(),
        /We first wrote to you on 03\/10\/2026 requesting your decision on liability\. Since your reply of 14\/10\/2026 we have chased on 1 occasion, most recently on 18\/10\/2026\./,
      );
    });
    db.close();
  });

  it("leaves the sentence out when the first-request date is not on the file", () => {
    const db = seeded();
    withDatabase(db, () => {
      liabilityFile();
      assert.equal(chaseHistoryLine(CLAIM, "liability_response"), null);
      assert.equal(chaseHistorySentence(null), null);
      assert.equal(withChaseHistory("Dear Sirs,\n\nText.", null), "Dear Sirs,\n\nText.");
    });
    db.close();
  });

  it("shows on the liability chaser letter prepared by hand", () => {
    const db = seeded();
    withDatabase(db, () => {
      liabilityFile();
      event("initial_letter_tp_insurer", "2026-10-03T11:00:00.000Z");
      event("liability_chase_sent", "2026-10-07T11:00:00.000Z");
      const letter = letterPreview(CLAIM, "liability_chaser");
      const sentence = "We first wrote to you on 03/10/2026 requesting your decision on liability and have chased on 1 occasion since, most recently on 07/10/2026.";
      assert.ok(letter.text.includes(sentence));
      assert.ok(letter.html.includes(sentence));
    });
    db.close();
  });

  it("puts the sentence after a payment chaser's reference line, and once per item in the combined email", () => {
    const payment = withChaseHistory("Dear Sirs,\n\nClaim ref: TEST-0005 / your ref: AV-1\n\nWe refer to TEST-0005.\n\nKind regards,\nSian", "SENTENCE A.");
    assert.equal(payment, "Dear Sirs,\n\nClaim ref: TEST-0005 / your ref: AV-1\n\nSENTENCE A.\n\nWe refer to TEST-0005.\n\nKind regards,\nSian");
    const other = withChaseHistory("Dear Sir / Madam,\n\nWe refer to TEST-0005.\n\nKind regards,\nSian", "SENTENCE B.");
    const combined = combinedChaseEmail("TEST-0005", [
      { title: "Repair invoice payment", body: payment },
      { title: "Liability response chase", body: other },
    ]);
    assert.equal(combined.body.split("SENTENCE A.").length - 1, 1);
    assert.equal(combined.body.split("SENTENCE B.").length - 1, 1);
    assert.ok(combined.body.indexOf("1. Repair invoice payment") < combined.body.indexOf("SENTENCE A."));
    assert.ok(combined.body.indexOf("2. Liability response chase") < combined.body.indexOf("SENTENCE B."));
  });
});

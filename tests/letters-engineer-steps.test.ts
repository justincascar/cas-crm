import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { recordAudatexEstimate, recordEngineerInstructedByHand, recordInspectionRoute, recordReportSentByHand } from "../src/lib/db/claim-step-record.ts";
import { generateClaimDocument, logEngineerReportReceived, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { CAS_EMAIL_SPECS, CAS_LETTER_SPECS } from "../src/lib/documents/cas-wording.ts";
import { generationMarksStep } from "../src/lib/documents/catalog.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

async function blankNonFault() {
  const form = new FormData();
  form.set("client_forename", "Cerys");
  form.set("client_surname", "Letters");
  form.set("client_mobile", "07700900456");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-3));
  form.set("accidentTime", "09:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "roadworthy");
  return createClaimFromIntake(intakeFromFormData(form));
}

function step(claimId: string, key: string) {
  const found = loadClaimSteps(claimId)?.find((item) => item.key === key);
  assert.ok(found, `step ${key} missing`);
  return found;
}

const sian = { actorId: "staff-sian", role: "staff" };

describe("letters mark their step (J4)", () => {
  it("marks the initial letter step done as sent, unless the handler holds it back", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const held = await blankNonFault();
      generateClaimDocument({ claimId: held.id, templateKey: "initial_tp_insurer", actorId: "staff-sian", recordOnFile: false, markSent: true });
      assert.equal(step(held.id, "initial_letter").state, "to_do");

      const sent = await blankNonFault();
      generateClaimDocument({ claimId: sent.id, templateKey: "initial_tp_insurer", actorId: "staff-sian", recordOnFile: true, markSent: true });
      const letter = step(sent.id, "initial_letter");
      assert.equal(letter.state, "done");
      assert.match(letter.statusText, /Marked as sent/);
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'initial_letter_tp_insurer'`, [sent.id]);
      assert.match(String(event?.details), /Marked as sent by Sian/);
    });
    db.close();
  });

  it("does not mark repairs started when the repair commencement letter is generated", () => {
    assert.equal(generationMarksStep("repair_commencement"), false);
    assert.equal(generationMarksStep("initial_tp_insurer"), true);
    assert.equal(generationMarksStep("fault_own_insurer"), true);
    assert.equal(generationMarksStep("client_welcome"), false);
  });

  it("offers an email to the third-party insurer with the supplied wording, and refuses it on a fault file", async () => {
    const letter = CAS_LETTER_SPECS.find((item) => item.key === "initial_tp_insurer");
    const email = CAS_EMAIL_SPECS.find((item) => item.key === "initial_tp_insurer_email");
    assert.ok(letter && email);
    assert.equal(email.body, letter.body);
    assert.equal(email.subject, letter.subject);
    assert.equal(email.eventType, "initial_letter_tp_insurer");
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      assert.throws(
        () => generateClaimDocument({ claimId: "c4", templateKey: "initial_tp_insurer_email", actorId: "staff-sian" }),
        /do not apply on a fault claim/,
      );
      const refused = await sendClaimEmail({
        claimId: "c4",
        actorId: "staff-sian",
        to: "insurer@example.test",
        subject: "Uninsured losses",
        body: "Dear Sir / Madam",
        templateKey: "initial_tp_insurer_email",
      });
      assert.equal(refused.ok, false);
      assert.equal(get(`SELECT id FROM claim_events WHERE claim_id = 'c4' AND event_type = 'initial_letter_tp_insurer'`), undefined);
    });
    db.close();
  });
});

describe("engineer and Audatex steps in one click (J4)", () => {
  it("records engineer instructed, report received and sent to the insurer, each with a date", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await blankNonFault();
      recordInspectionRoute({ claimId: claim.id, ...sian, route: "engineer", occurredOn: isoDateFromNow(-2) });
      assert.deepEqual(step(claim.id, "engineer").forms, ["engineer_instructed"]);
      assert.throws(() => recordEngineerInstructedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(1) }), /future/);
      recordEngineerInstructedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-2) });
      assert.equal(step(claim.id, "engineer").state, "done");
      assert.throws(() => recordEngineerInstructedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-1) }), /already on the file/);

      assert.throws(() => recordReportSentByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(0) }), /received first/);
      assert.deepEqual(step(claim.id, "send_report").forms, []);
      logEngineerReportReceived({ claimId: claim.id, actorId: "staff-sian", occurredAt: isoDateFromNow(-1) });
      assert.equal(step(claim.id, "engineer_report").state, "done");
      assert.deepEqual(step(claim.id, "send_report").forms, ["report_sent"]);

      recordReportSentByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(0) });
      const sent = step(claim.id, "send_report");
      assert.equal(sent.state, "done");
      assert.match(sent.statusText, /Marked as sent/);
      assert.throws(() => recordReportSentByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(0) }), /already recorded/);
    });
    db.close();
  });

  it("records the Audatex estimate as sent with a date alone, and still checks figures when they are typed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await blankNonFault();
      recordInspectionRoute({ claimId: claim.id, ...sian, route: "audatex", occurredOn: isoDateFromNow(-2) });
      assert.deepEqual(step(claim.id, "engineer").forms, ["audatex_sent"]);
      const blank = { reference: "", estimate: "", labour: "", parts: "", paint: "", authorised: "", hourly: "", hourlyNote: "", times: "", timesNote: "", partsReduction: "", partsNote: "", other: "", otherNote: "" };
      assert.throws(
        () => recordAudatexEstimate({ claimId: claim.id, ...sian, kind: "sent", occurredOn: isoDateFromNow(-1), ...blank, estimate: "1200" }),
        /Audatex reference/,
      );
      recordAudatexEstimate({ claimId: claim.id, ...sian, kind: "sent", occurredOn: isoDateFromNow(-1), ...blank });
      assert.equal(step(claim.id, "engineer").state, "done");
      assert.deepEqual(step(claim.id, "engineer_report").forms, ["audatex_received"]);
      recordAudatexEstimate({ claimId: claim.id, ...sian, kind: "received", occurredOn: isoDateFromNow(0), ...blank });
      assert.deepEqual(step(claim.id, "send_report").forms, ["report_sent"]);
    });
    db.close();
  });

  it("keeps a fault file on Audatex and the client's own insurer, with no engineer or third-party letter step", () => {
    const db = prepared();
    withDatabase(db, () => {
      const keys = loadClaimSteps("c4")?.map((item) => item.key) || [];
      assert.ok(keys.includes("own_insurer"));
      assert.ok(keys.includes("audatex_send"));
      assert.equal(keys.includes("engineer"), false);
      assert.equal(keys.includes("initial_letter"), false);
    });
    db.close();
  });
});

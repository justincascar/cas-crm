import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { dueFollowUpChases } from "../src/lib/db/follow-up-chases.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { outstandingForClaim } from "../src/lib/db/outstanding.ts";
import { getInsurerPaymentDetails, saveInsurerPaymentDetails } from "../src/lib/db/payment-details.ts";
import { seed } from "../src/lib/db/seed.ts";
import { totalLossNoticeBody } from "../src/lib/db/total-loss.ts";
import { listClaims } from "../src/lib/db/queries.ts";
import {
  DOCUMENT_CHASES,
  documentChaseDecision,
  totalLossPaymentChaseDecision,
} from "../src/lib/domain/follow-up-chases.ts";
import { PAYMENT_DETAILS_MISSING } from "../src/lib/domain/payment-details.ts";
import type { TotalLossFigures } from "../src/lib/domain/total-loss.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

const REPORT: TotalLossFigures = {
  pavPence: 1000000,
  salvagePence: 150000,
  interest: "no_interest",
  insurerOfferedPence: null,
  disposal: null,
  saleProceedsPence: null,
  returnedOn: null,
  customerChargePence: null,
  casPurchasePence: null,
  casRequest: "full_pav",
};

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function event(db: DatabaseSync, id: string, claimId: string, type: string, at: string, details = "") {
  db.prepare(
    `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'staff-justin', 'staff')`,
  ).run(id, claimId, type, type, details, at, at);
}

function hireAgreement(db: DatabaseSync, claimId: string, at: string) {
  const documentId = `ha-${claimId}`;
  db.prepare(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, template_key, created_at)
     VALUES (?, ?, 'Hire Agreement', 'agreement', 'hire_agreement', 'hire_agreement', ?)`,
  ).run(documentId, claimId, at);
  db.prepare(
    `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, document_id, source)
     VALUES (?, ?, 'document_generated', 'Hire Agreement', 'Hire Agreement filed', ?, ?, 'staff-justin', ?, 'system')`,
  ).run(`ev-${documentId}`, claimId, at, at, documentId);
}

function labelsAt(claimId: string, asAt: string) {
  return outstandingForClaim(claimId, new Date(asAt)).map((item) => item.label);
}

describe("client paper and total-loss payment chases", () => {
  it("does not chase a paper until 24 hours after it was requested, then clears when it is uploaded", () => {
    const requested = "2026-10-01T12:00:00.000Z";
    const under = "2026-10-02T11:59:00.000Z";
    const over = "2026-10-02T12:01:00.000Z";
    assert.equal(documentChaseDecision({ requestedAt: requested, received: false, lastChaseSentAt: null, asAt: under }).due, false);
    assert.equal(documentChaseDecision({ requestedAt: requested, received: false, lastChaseSentAt: null, asAt: over }).due, true);
    assert.equal(documentChaseDecision({ requestedAt: requested, received: true, lastChaseSentAt: null, asAt: over }).due, false);

    const db = prepared();
    withDatabase(db, () => {
      event(db, "welcome-c4", "c4", "client_welcome_sent", requested);
      assert.equal(labelsAt("c4", under).includes("Driving licence chase due"), false);
      assert.equal(labelsAt("c4", under).includes("Logbook (V5C) chase due"), false);
      const due = labelsAt("c4", over);
      for (const paper of DOCUMENT_CHASES.filter((item) => item.trigger === "welcome")) {
        assert.ok(due.includes(paper.label), paper.label);
      }
      assert.equal(due.includes("Bank statements chase due"), false);
      assert.equal(due.includes("Engineer's report chase due"), false);
      db.prepare(
        `INSERT INTO documents(id, claim_id, title, document_type, created_at) VALUES ('doc-lic', 'c4', 'Licence', 'driving_licence', ?)`,
      ).run(over);
      const afterUpload = labelsAt("c4", over);
      assert.equal(afterUpload.includes("Driving licence chase due"), false);
      assert.ok(afterUpload.includes("Insurance certificate chase due"));
      const listed = dueFollowUpChases(over).filter((row) => row.claimId === "c4").map((row) => row.label);
      assert.equal(listed.includes("Driving licence chase due"), false);
      assert.equal(listed.includes("Bank statements chase due"), false);
      const recent = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE claim_events SET occurred_at = ? WHERE id = 'welcome-c4'`).run(recent);
      const onList = listClaims().find((row) => row.id === "c4");
      const next = String(onList?.next_action || "");
      assert.equal(next.includes("Driving licence chase due"), false);
      assert.ok(next.includes("Insurance certificate chase due"));
    });
  });

  it("clears the bank-statement chase when the hire pack says they are on file", () => {
    const db = prepared();
    withDatabase(db, () => {
      const requested = "2026-10-01T12:00:00.000Z";
      const over = "2026-10-02T13:00:00.000Z";
      event(db, "welcome-c2", "c2", "client_welcome_sent", requested);
      hireAgreement(db, "c2", requested);
      db.prepare(`INSERT INTO hire_pack_data(claim_id, means_documents_on_file) VALUES ('c2', 1)`).run();
      const due = labelsAt("c2", over);
      assert.equal(due.includes("Bank statements chase due"), false);
      assert.ok(due.includes("Driving licence chase due"));
    });
  });

  it("starts bank statements from the hire agreement, not the welcome letter", () => {
    const welcome = "2026-09-01T12:00:00.000Z";
    const agreement = "2026-10-01T12:00:00.000Z";
    const under = "2026-10-02T11:59:00.000Z";
    const over = "2026-10-02T12:01:00.000Z";
    const db = prepared();
    withDatabase(db, () => {
      event(db, "welcome-c3", "c3", "client_welcome_sent", welcome);
      const beforeAgreement = labelsAt("c3", over);
      assert.equal(beforeAgreement.includes("Bank statements chase due"), false);
      assert.ok(beforeAgreement.includes("Driving licence chase due"));
      assert.ok(beforeAgreement.includes("Insurance certificate chase due"));
      assert.ok(beforeAgreement.includes("Logbook (V5C) chase due"));

      hireAgreement(db, "c3", agreement);
      assert.equal(labelsAt("c3", under).includes("Bank statements chase due"), false);
      assert.ok(labelsAt("c3", over).includes("Bank statements chase due"));
      db.prepare(
        `INSERT INTO documents(id, claim_id, title, kind, document_type, template_key, created_at)
         VALUES ('ha-c3-again', 'c3', 'Hire Agreement', 'agreement', 'hire_agreement', 'hire_agreement', ?)`,
      ).run(over);
      assert.ok(labelsAt("c3", over).includes("Bank statements chase due"));
      db.prepare(
        `INSERT INTO documents(id, claim_id, title, document_type, created_at) VALUES ('doc-bank', 'c3', 'Statements', 'bank_statements', ?)`,
      ).run(over);
      assert.equal(labelsAt("c3", over).includes("Bank statements chase due"), false);
      assert.ok(labelsAt("c3", over).includes("Driving licence chase due"));
    });
  });

  it("repeats a total-loss payment chase every 3 days until the insurer confirms, then every 7 days", () => {
    const notice = "2026-10-01T12:00:00.000Z";
    const db = prepared();
    withDatabase(db, () => {
      event(db, "tl-notice", "c9", "total_loss_notice_sent", notice);
      assert.equal(labelsAt("c9", "2026-10-03T12:00:00.000Z").includes("Total-loss payment chase due"), false);
      assert.ok(labelsAt("c9", "2026-10-04T12:00:00.000Z").includes("Total-loss payment chase due"));
      event(db, "tl-chase-1", "c9", "total_loss_payment_chase_sent", "2026-10-04T12:00:00.000Z");
      assert.equal(labelsAt("c9", "2026-10-06T12:00:00.000Z").includes("Total-loss payment chase due"), false);
      assert.ok(labelsAt("c9", "2026-10-07T12:00:00.000Z").includes("Total-loss payment chase due"));

      db.prepare(
        `INSERT INTO total_loss_reports(claim_id, insurer_payment_promised_at, updated_at, updated_by)
         VALUES ('c9', '2026-10-08T12:00:00.000Z', '2026-10-08T12:00:00.000Z', 'staff-justin')`,
      ).run();
      assert.equal(labelsAt("c9", "2026-10-14T12:00:00.000Z").includes("Total-loss payment chase due"), false);
      assert.ok(labelsAt("c9", "2026-10-15T12:00:00.000Z").includes("Total-loss payment chase due"));
      event(db, "tl-chase-2", "c9", "total_loss_payment_chase_sent", "2026-10-15T12:00:00.000Z");
      assert.equal(labelsAt("c9", "2026-10-21T12:00:00.000Z").includes("Total-loss payment chase due"), false);
      assert.ok(labelsAt("c9", "2026-10-22T12:00:00.000Z").includes("Total-loss payment chase due"));
      event(db, "tl-chase-3", "c9", "total_loss_payment_chase_sent", "2026-10-22T12:00:00.000Z");
      assert.ok(labelsAt("c9", "2026-10-29T12:00:00.000Z").includes("Total-loss payment chase due"));
    });
  });

  it("does not chase when payment arrives before a chase is due, or within 7 days of confirmation", () => {
    const early = totalLossPaymentChaseDecision({
      noticeSentAt: "2026-10-01T12:00:00.000Z",
      insurerPromisedAt: null,
      paymentReceived: true,
      lastChaseSentAt: null,
      asAt: "2026-10-20T12:00:00.000Z",
    });
    assert.equal(early.due, false);
    const withinSeven = totalLossPaymentChaseDecision({
      noticeSentAt: "2026-09-01T12:00:00.000Z",
      insurerPromisedAt: "2026-10-01T12:00:00.000Z",
      paymentReceived: true,
      lastChaseSentAt: null,
      asAt: "2026-10-05T12:00:00.000Z",
    });
    assert.equal(withinSeven.due, false);

    const db = prepared();
    withDatabase(db, () => {
      event(db, "tl-notice-paid", "c9", "total_loss_notice_sent", "2026-10-01T12:00:00.000Z");
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 400000 WHERE id = 'f-c9-vd'`).run();
      assert.ok(labelsAt("c9", "2026-10-20T12:00:00.000Z").includes("Total-loss payment chase due"));
      db.prepare(`UPDATE financial_lines SET received_pence = 1000000 WHERE id = 'f-c9-vd'`).run();
      assert.equal(labelsAt("c9", "2026-10-20T12:00:00.000Z").includes("Total-loss payment chase due"), false);

      db.prepare(`UPDATE financial_lines SET received_pence = 0 WHERE id = 'f-c9-vd'`).run();
      db.prepare(
        `INSERT INTO total_loss_reports(claim_id, insurer_payment_promised_at, updated_at, updated_by)
         VALUES ('c9', '2026-10-10T12:00:00.000Z', '2026-10-10T12:00:00.000Z', 'staff-justin')`,
      ).run();
      db.prepare(`UPDATE financial_lines SET received_pence = 500000 WHERE id = 'f-c9-vd'`).run();
      assert.ok(labelsAt("c9", "2026-10-20T12:00:00.000Z").includes("Total-loss payment chase due"));
      db.prepare(`UPDATE financial_lines SET received_pence = 1000000 WHERE id = 'f-c9-vd'`).run();
      assert.equal(labelsAt("c9", "2026-10-20T12:00:00.000Z").includes("Total-loss payment chase due"), false);
      assert.equal(dueFollowUpChases("2026-10-20T12:00:00.000Z").some((row) => row.claimId === "c9" && row.kind === "total_loss_payment"), false);
    });
  });

  it("puts the saved insurer account on the total-loss letter, and flags it when the account is blank", () => {
    const blank = totalLossNoticeBody({
      fileReference: "TEST-0099",
      insurerReference: "INS-1",
      report: REPORT,
      paymentDetails: { accountName: "", sortCode: "", accountNumber: "" },
    });
    assert.match(blank.body, new RegExp(PAYMENT_DETAILS_MISSING));
    assert.doesNotMatch(blank.body, /\d{2}-\d{2}-\d{2}/);

    const db = prepared();
    withDatabase(db, () => {
      assert.deepEqual(getInsurerPaymentDetails(), { accountName: "", sortCode: "", accountNumber: "" });
      assert.throws(() => saveInsurerPaymentDetails({ accountName: "CAS", sortCode: "12-34", accountNumber: "" }), /all three/);
      const saved = saveInsurerPaymentDetails({
        accountName: "Complete Accident Solutions Ltd",
        sortCode: "12 34 56",
        accountNumber: "12345678",
      });
      const filled = totalLossNoticeBody({
        fileReference: "TEST-0099",
        insurerReference: null,
        report: REPORT,
        paymentDetails: saved,
      });
      assert.match(filled.body, /Complete Accident Solutions Ltd/);
      assert.match(filled.body, /12-34-56/);
      assert.match(filled.body, /12345678/);
      assert.doesNotMatch(filled.body, new RegExp(PAYMENT_DETAILS_MISSING));
      saveInsurerPaymentDetails({ accountName: "", sortCode: "", accountNumber: "" });
      const cleared = totalLossNoticeBody({
        fileReference: "TEST-0099",
        insurerReference: null,
        report: REPORT,
        paymentDetails: getInsurerPaymentDetails(),
      });
      assert.match(cleared.body, new RegExp(PAYMENT_DETAILS_MISSING));
      assert.doesNotMatch(cleared.body, /12345678/);
    });
  });
});

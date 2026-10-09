import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { PAYMENT_TERM_NOT_SET_LABEL } from "../src/lib/constants.ts";
import { isoDaysFromNow } from "../src/lib/dates.ts";
import { chaseForClaim, getInsurerPaymentTermDays, listChasesForClaim, listDueChases } from "../src/lib/db/chase.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { listClaimEvents, logIncomingEmail, markOutstandingChaseSent, prepareOutstandingChase } from "../src/lib/db/chronology.ts";
import { ensureChaseSettings } from "../src/lib/db/chase.ts";
import { ensureEngineers } from "../src/lib/db/engineers.ts";
import { recordAgreedRepairInvoice, recordHeadPayment, recordUnreferencedPayment } from "../src/lib/db/payment-ledger.ts";
import { seed } from "../src/lib/db/seed.ts";
import { emailTemplatesForRole } from "../src/lib/documents/email-templates.ts";
import {
  classifyPaymentReply,
  headSettledInFull,
  partPaymentCountsAsPaid,
  paymentRequestCopy,
} from "../src/lib/domain/payment-chase.ts";
import { BLANK_PAYMENT_DETAILS } from "../src/lib/domain/payment-details.ts";
import { formatGbp } from "../src/lib/money.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
  ensureChaseSettings(db);
  return db;
}

function repairs(db: DatabaseSync) {
  return db.prepare(`SELECT agreed_pence, received_pence, claimed_pence FROM financial_lines WHERE id = 'f-c6-rep'`).get() as {
    agreed_pence: number;
    received_pence: number;
    claimed_pence: number;
  };
}

describe("payment chase — a part-payment is not paid", () => {
  it("does not treat a shortfall as paid", () => {
    assert.equal(partPaymentCountsAsPaid(100_000, 25_000), false);
    assert.equal(headSettledInFull(100_000, 25_000), false);
    assert.equal(headSettledInFull(100_000, 100_000), true);
  });
});

describe("payment chase — partial, full, reminder and backlog", () => {
  it("pauses on a part-payment, reduces only the repair balance, and flags review", () => {
    const db = seeded();
    withDatabase(db, () => {
      const claimedBefore = repairs(db).claimed_pence;
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      db.prepare(
        `INSERT INTO financial_lines(
          id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
          claimed_pence, offered_pence, agreed_pence, received_pence
        ) VALUES ('f-c6-st', 'c6', 'storage', 'Storage', 1, 'job', 0, 0, 0, 0, 50000, 0, 50000, 0)`,
      ).run();
      const hireBefore = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c6'`).get() as
        | { billing_end_at: string | null }
        | undefined;
      const storageEndBefore = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c6'`).get() as {
        storage_billing_end_on: string | null;
      };
      const logged = recordHeadPayment({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 25_000,
        correction: false,
      });
      assert.equal(logged.paused, true);
      assert.equal(logged.paidInFull, false);
      assert.equal(logged.receivedPence, 25_000);
      assert.equal(logged.outstandingPence, 75_000);
      const money = repairs(db);
      assert.equal(money.received_pence, 25_000);
      assert.equal(money.agreed_pence, 100_000);
      assert.equal(money.claimed_pence, claimedBefore);
      const storage = db.prepare(`SELECT agreed_pence, received_pence FROM financial_lines WHERE id = 'f-c6-st'`).get() as {
        agreed_pence: number;
        received_pence: number;
      };
      assert.equal(storage.agreed_pence, 50_000);
      assert.equal(storage.received_pence, 0);
      const chase = listChasesForClaim("c6").find((row) => row.kind === "repair_payment");
      assert.equal(chase?.handlerState, "paused");
      assert.equal(chase?.due, false);
      assert.equal(chase?.outcomeOnFile, false);
      assert.equal(chase?.payment?.partPaid, true);
      assert.equal(chase?.payment?.paidInFull, false);
      assert.equal(partPaymentCountsAsPaid(100_000, 25_000), false);
      assert.match(String(chase?.reason || ""), /part-payment/i);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_chase_review_flagged"));
      const hireAfter = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c6'`).get() as
        | { billing_end_at: string | null }
        | undefined;
      const storageEndAfter = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c6'`).get() as {
        storage_billing_end_on: string | null;
      };
      assert.equal(hireAfter?.billing_end_at ?? null, hireBefore?.billing_end_at ?? null);
      assert.equal(storageEndAfter.storage_billing_end_on, storageEndBefore.storage_billing_end_on);
      db.prepare(
        `INSERT INTO claim_third_parties(id, claim_id, person_id, insurer_name, insurer_email, insurer_ref) VALUES ('tp-c6','c6','p-tp2','Ageas','claims@ageas.example.test','AG-1')`,
      ).run();
      const prepared = prepareOutstandingChase({ claimId: "c6", actorId: "staff-justin", kind: "repair_payment" });
      assert.match(prepared.body, /750\.00/);
      assert.match(prepared.body, /Please pay/);
      assert.match(prepared.body, /1,000\.00/);
      assert.doesNotMatch(prepared.body, /500\.00/);
      assert.match(prepared.body, /Payment details not yet on file/);
      assert.match(prepared.body, new RegExp(PAYMENT_TERM_NOT_SET_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(prepared.body, /\b14\b/);
      assert.doesNotMatch(prepared.body, /\b28\b/);
      const stored = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as {
        sent_status: string;
      };
      assert.equal(stored.sent_status, "prepared_not_sent");
    });
    db.close();
  });

  it("stops the chase when the balance is paid and flags hire and storage without closing them", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 80_000 });
      const hireBefore = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c6'`).all();
      const storageBefore = db.prepare(`SELECT storage_billing_end_on, storage_started_on FROM claims WHERE id = 'c6'`).get();
      const logged = recordHeadPayment({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 80_000,
        correction: false,
      });
      assert.equal(logged.paidInFull, true);
      assert.equal(logged.paused, false);
      assert.equal(logged.outstandingPence, 0);
      assert.equal(headSettledInFull(80_000, 80_000), true);
      const chase = chaseForClaim("repair_payment", "c6");
      assert.equal(chase?.due, false);
      assert.equal(chase?.outcomeOnFile, true);
      assert.equal(chase?.handlerState, "tracking");
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_hire_storage_review"));
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "hire_ended"), false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "storage_ended"), false);
      const hireAfter = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c6'`).all();
      const storageAfter = db.prepare(`SELECT storage_billing_end_on, storage_started_on FROM claims WHERE id = 'c6'`).get();
      assert.deepEqual(hireAfter, hireBefore);
      assert.deepEqual(storageAfter, storageBefore);
    });
    db.close();
  });

  it("prepares one reminder after the interval, and only one catch-up after an outage", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      db.prepare(
        `INSERT INTO claim_third_parties(id, claim_id, person_id, insurer_name, insurer_email, insurer_ref) VALUES ('tp-c6','c6','p-tp2','Ageas','claims@ageas.example.test','AG-1')`,
      ).run();
      const firstAt = isoDaysFromNow(-6);
      const prepared = prepareOutstandingChase({ claimId: "c6", actorId: "staff-justin", kind: "repair_payment" });
      markOutstandingChaseSent({
        claimId: "c6",
        kind: "repair_payment",
        correspondenceId: prepared.correspondenceId,
        actorId: "staff-justin",
        occurredAt: firstAt,
      });
      db.prepare(`UPDATE correspondence SET created_at = ? WHERE id = ?`).run(firstAt, prepared.correspondenceId);
      assert.equal(chaseForClaim("repair_payment", "c6", isoDaysFromNow(-6))?.due, false);
      assert.equal(chaseForClaim("repair_payment", "c6", isoDaysFromNow(-3))?.due, true);
      const again = prepareOutstandingChase({ claimId: "c6", actorId: "staff-justin", kind: "repair_payment" });
      const reminderAt = isoDaysFromNow(-3);
      markOutstandingChaseSent({
        claimId: "c6",
        kind: "repair_payment",
        correspondenceId: again.correspondenceId,
        actorId: "staff-justin",
        occurredAt: reminderAt,
      });
      db.prepare(`UPDATE correspondence SET created_at = ? WHERE id = ?`).run(reminderAt, again.correspondenceId);
      assert.equal(chaseForClaim("repair_payment", "c6", reminderAt)?.due, false);
      assert.equal(chaseForClaim("repair_payment", "c6", isoDaysFromNow(0))?.due, true);
      const history = listClaimEvents("c6");
      assert.ok(history.some((event) => event.event_type === "payment_chase_1_sent"));
      assert.ok(history.some((event) => event.event_type === "payment_chase_2_sent"));
    });
    db.close();
  });

  it("leaves at most one catch-up reminder due after an outage", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      db.prepare(
        `INSERT INTO claim_third_parties(id, claim_id, person_id, insurer_name, insurer_email, insurer_ref) VALUES ('tp-c6b','c6','p-tp2','Ageas','claims@ageas.example.test','AG-1')`,
      ).run();
      const prepared = prepareOutstandingChase({ claimId: "c6", actorId: "staff-justin", kind: "repair_payment" });
      const sentAt = isoDaysFromNow(-40);
      markOutstandingChaseSent({
        claimId: "c6",
        kind: "repair_payment",
        correspondenceId: prepared.correspondenceId,
        actorId: "staff-justin",
        occurredAt: sentAt,
      });
      db.prepare(`UPDATE correspondence SET created_at = ? WHERE id = ?`).run(sentAt, prepared.correspondenceId);
      const due = listDueChases(isoDaysFromNow(0)).filter((row) => row.claimId === "c6" && row.kind === "repair_payment");
      assert.equal(due.length, 1);
      const preparedCount = db
        .prepare(`SELECT COUNT(*) AS c FROM correspondence WHERE claim_id = 'c6' AND template_key = 'repair_payment_chase'`)
        .get() as { c: number };
      assert.equal(Number(preparedCount.c), 1);
      const sent = db
        .prepare(
          `SELECT COUNT(*) AS c FROM correspondence WHERE claim_id = 'c6' AND template_key = 'repair_payment_chase' AND sent_status = 'sent'`,
        )
        .get() as { c: number };
      assert.equal(Number(sent.c), 0);
    });
    db.close();
  });

  it("replaces a correction logged straight after the first figure", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      recordHeadPayment({ claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 50_000, correction: false });
      const corrected = recordHeadPayment({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 20_000,
        correction: true,
      });
      assert.equal(corrected.replacedPrevious, true);
      assert.equal(corrected.receivedPence, 20_000);
      assert.equal(repairs(db).received_pence, 20_000);
      assert.equal(partPaymentCountsAsPaid(100_000, 20_000), false);
    });
    db.close();
  });

  it("does not allocate a payment that has no head of loss", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      const before = repairs(db).received_pence;
      const result = recordUnreferencedPayment({ claimId: "c6", actorId: "staff-justin", amountPence: 10_000, note: "No reference on the advice." });
      void result;
      assert.equal(repairs(db).received_pence, before);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_reference_unclear"));
      const chase = chaseForClaim("repair_payment", "c6");
      assert.equal(chase?.payment?.receivedPence, 0);
    });
    db.close();
  });

  it("pauses for a dispute, ignores an acknowledgement, and flags an uncertain reply", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(classifyPaymentReply("Thank you for your email. We acknowledge receipt."), "acknowledgement");
      assert.equal(classifyPaymentReply("We dispute the repair invoice."), "substantive");
      assert.equal(classifyPaymentReply("Please see attached."), "uncertain");
      recordAgreedRepairInvoice({ claimId: "c6", actorId: "staff-justin", agreedPence: 100_000 });
      logIncomingEmail({
        claimId: "c6",
        actorId: "staff-justin",
        from: "claims@ageas.example.test",
        subject: "Acknowledgement",
        body: "Thank you for your email. This is an automatic reply.",
      });
      assert.equal(chaseForClaim("repair_payment", "c6")?.handlerState, "tracking");
      assert.equal(chaseForClaim("repair_payment", "c6")?.outcomeOnFile, false);
      logIncomingEmail({
        claimId: "c6",
        actorId: "staff-justin",
        from: "claims@ageas.example.test",
        subject: "Query",
        body: "We dispute the figure on the repair invoice.",
      });
      assert.equal(chaseForClaim("repair_payment", "c6")?.handlerState, "paused");
      assert.equal(chaseForClaim("repair_payment", "c6")?.due, false);
      db.prepare(`UPDATE automations SET paused = 0, status = 'tracking' WHERE claim_id = 'c6' AND rule_key = 'repair_payment_chase'`).run();
      logIncomingEmail({
        claimId: "c6",
        actorId: "staff-justin",
        from: "claims@ageas.example.test",
        subject: "Hello",
        body: "Please see attached.",
      });
      assert.equal(chaseForClaim("repair_payment", "c6")?.handlerState, "tracking");
      assert.equal(chaseForClaim("repair_payment", "c6")?.outcomeOnFile, false);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_reply_uncertain"));
    });
    db.close();
  });
});

describe("payment chase — term and templates", () => {
  it("has no payment-term default and does not offer the old templates in the picker", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(getInsurerPaymentTermDays(), null);
    });
    db.close();
    const copy = paymentRequestCopy({
      stage: "first",
      fileReference: "TEST-0006",
      theirRef: "AG-1",
      head: "repairs",
      agreedPence: 100_000,
      receivedPence: 0,
      outstandingPence: 100_000,
      bank: BLANK_PAYMENT_DETAILS,
      paymentTermDays: null,
      asAt: "2026-10-09T12:00:00.000Z",
      hirePackSentOn: null,
      firstChaseOn: null,
      handlerName: "Justin Roberts",
    });
    assert.equal(copy.dueDateUnset, true);
    assert.match(copy.body, /£1,000\.00/);
    assert.match(copy.body, /Payment details not yet on file/);
    assert.doesNotMatch(copy.body, /\b14\b/);
    assert.doesNotMatch(copy.body, /\b28\b/);
    assert.equal(formatGbp(100_000), "£1,000.00");
    const titles = emailTemplatesForRole("third_party").map((template) => template.key);
    assert.equal(titles.includes("payment_chase_1"), false);
    assert.equal(titles.includes("payment_chase_2"), false);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ACCEPT_PAYMENT_SETTLEMENT, canAcceptPaymentSettlement } from "../src/lib/auth/roles.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { chaseForClaim, listChasesForClaim } from "../src/lib/db/chase.ts";
import { listClaimEvents } from "../src/lib/db/chronology.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import {
  acceptPaymentAsFinal,
  disputePaymentSettlement,
  listOpenPaymentReviews,
  listPaymentAttention,
  listPaymentsAfterSettlement,
  paymentDecisionForHead,
} from "../src/lib/db/payment-review.ts";
import { getDashboard } from "../src/lib/db/queries.ts";
import { listStaffPermissions } from "../src/lib/db/permissions.ts";
import { seed } from "../src/lib/db/seed.ts";
import { createStaffAccount } from "../src/lib/db/staff-admin.ts";
import { saveTotalLossReport } from "../src/lib/db/total-loss.ts";
import { awaitingDecisionLabel, recordedSalvageProceedsPence, settlementTargetPence } from "../src/lib/domain/payment-review.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function money(db: DatabaseSync, id: string) {
  return db
    .prepare(`SELECT claimed_pence, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE id = ?`)
    .get(id) as { claimed_pence: number; offered_pence: number; agreed_pence: number; received_pence: number };
}

function hireStorage(db: DatabaseSync, claimId: string) {
  const claim = db
    .prepare(`SELECT hire_status, storage_status, storage_billing_end_on FROM claims WHERE id = ?`)
    .get(claimId) as { hire_status: string | null; storage_status: string | null; storage_billing_end_on: string | null };
  const hire = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = ?`).all(claimId) as { billing_end_at: string | null }[];
  return { claim, hire };
}

describe("payment review — figures", () => {
  it("nets agreed PAV by salvage proceeds and does not add salvage to sale proceeds", () => {
    assert.equal(
      settlementTargetPence({
        head: "vehicle_damage",
        agreedPence: 1_315_000,
        claimedPence: 1_450_000,
        salvageProceedsPence: 19_075,
        acceptedAsFinal: false,
      }),
      1_295_925,
    );
    assert.equal(
      recordedSalvageProceedsPence({
        interest: "no_interest",
        salvagePence: 19_075,
        saleProceedsPence: 10_000,
        disposal: "sold",
      }),
      10_000,
    );
    assert.equal(
      recordedSalvageProceedsPence({
        interest: "takes_interest",
        salvagePence: 19_075,
        saleProceedsPence: null,
        disposal: null,
      }),
      0,
    );
    assert.equal(
      settlementTargetPence({
        head: "repairs",
        agreedPence: 0,
        claimedPence: 240_000,
        salvageProceedsPence: 0,
        acceptedAsFinal: false,
      }),
      240_000,
    );
  });
});

describe("payment review — nothing agreed, and total loss", () => {
  it("treats a short payment with no agreed figure as a review against the claimed figure", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = money(db, "f-c6-rep");
      assert.equal(before.agreed_pence, 0);
      assert.equal(before.claimed_pence, 240_000);
      const logged = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-1",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 100_000,
        correction: false,
      });
      assert.equal(logged.paidInFull, false);
      assert.equal(logged.receivedPence, 100_000);
      assert.equal(logged.outstandingPence, 140_000);
      const after = money(db, "f-c6-rep");
      assert.equal(after.agreed_pence, 0);
      assert.equal(after.claimed_pence, 240_000);
      assert.equal(after.received_pence, 100_000);
      const reviews = listOpenPaymentReviews("c6");
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].head, "repairs");
      assert.equal(reviews[0].receivedPence, 100_000);
      assert.equal(reviews[0].outstandingPence, 140_000);
      assert.equal(reviews[0].insurerReasonLabel, "no reason given");
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_write_off"), false);
    });
    db.close();
  });

  it("treats a payment that matches the claimed figure as full, and flags hire and storage without closing them", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = hireStorage(db, "c6");
      const logged = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-2",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 240_000,
        correction: false,
      });
      assert.equal(logged.paidInFull, true);
      assert.equal(logged.outstandingPence, 0);
      assert.equal(money(db, "f-c6-rep").agreed_pence, 0);
      assert.equal(listOpenPaymentReviews("c6").length, 0);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_hire_storage_review"));
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "hire_ended"), false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "storage_ended"), false);
      assert.deepEqual(hireStorage(db, "c6"), before);
    });
    db.close();
  });

  it("compares a total-loss receipt with agreed PAV minus salvage, and a matching receipt stops the chase", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1315000 WHERE id = 'f-c9-vd'`).run();
      saveTotalLossReport({
        claimId: "c9",
        actorId: "staff-justin",
        pavPence: 1_315_000,
        salvagePence: 19_075,
        interest: "no_interest",
        disposal: null,
      });
      const before = hireStorage(db, "c9");
      const short = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-3",
        claimId: "c9",
        actorId: "staff-justin",
        head: "vehicle_damage",
        amountPence: 1_000_000,
        correction: false,
        insurerReason: "Betterment",
      });
      assert.equal(short.paidInFull, false);
      assert.equal(short.outstandingPence, 295_925);
      const review = listOpenPaymentReviews("c9");
      assert.equal(review.length, 1);
      assert.equal(review[0].head, "vehicle_damage");
      assert.equal(review[0].receivedPence, 1_000_000);
      assert.equal(review[0].outstandingPence, 295_925);
      assert.equal(review[0].insurerReasonLabel, "Betterment");
      assert.equal(money(db, "f-c9-vd").agreed_pence, 1_315_000);
      assert.equal(money(db, "f-c9-hire").agreed_pence, 0);
      const chase = listChasesForClaim("c9").find((row) => row.kind === "settlement_payment");
      assert.equal(chase?.handlerState, "paused");
      assert.equal(chase?.payment?.paidInFull, false);
      assert.equal(chase?.outcomeOnFile, false);

      db.prepare(`UPDATE financial_lines SET received_pence = 0 WHERE id = 'f-c9-vd'`).run();
      db.prepare(
        `DELETE FROM claim_events WHERE claim_id = 'c9' AND event_type IN ('settlement_payment_logged', 'total_loss_payment_received', 'payment_chase_review_flagged')`,
      ).run();
      const full = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-4",
        claimId: "c9",
        actorId: "staff-justin",
        head: "vehicle_damage",
        amountPence: 1_295_925,
        correction: false,
      });
      assert.equal(full.paidInFull, true);
      assert.equal(full.outstandingPence, 0);
      assert.equal(listOpenPaymentReviews("c9").length, 0);
      const settled = chaseForClaim("settlement_payment", "c9");
      assert.equal(settled?.due, false);
      assert.equal(settled?.outcomeOnFile, true);
      assert.ok(listClaimEvents("c9").some((event) => event.event_type === "payment_hire_storage_review"));
      assert.equal(listClaimEvents("c9").some((event) => event.event_type === "hire_ended"), false);
      assert.equal(listClaimEvents("c9").some((event) => event.event_type === "storage_ended"), false);
      assert.deepEqual(hireStorage(db, "c9"), before);
      assert.equal(money(db, "f-c9-vd").agreed_pence, 1_315_000);
    });
    db.close();
  });

  it("recalculates the outstanding figure when salvage is recorded after the payment", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1315000 WHERE id = 'f-c9-vd'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-5",
        claimId: "c9",
        actorId: "staff-justin",
        head: "vehicle_damage",
        amountPence: 1_000_000,
        correction: false,
      });
      const before = listOpenPaymentReviews("c9");
      assert.equal(before.length, 1);
      assert.equal(before[0].outstandingPence, 315_000);
      saveTotalLossReport({
        claimId: "c9",
        actorId: "staff-justin",
        pavPence: 1_315_000,
        salvagePence: 19_075,
        interest: "no_interest",
        disposal: null,
      });
      const after = listOpenPaymentReviews("c9");
      assert.equal(after.length, 1);
      assert.equal(after[0].receivedPence, 1_000_000);
      assert.equal(after[0].outstandingPence, 295_925);
      assert.equal(money(db, "f-c9-vd").received_pence, 1_000_000);
      assert.equal(money(db, "f-c9-vd").agreed_pence, 1_315_000);
    });
    db.close();
  });

  it("uses sale proceeds when a sale is recorded, and does not also deduct the engineer's salvage value", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1315000 WHERE id = 'f-c9-vd'`).run();
      saveTotalLossReport({
        claimId: "c9",
        actorId: "staff-justin",
        pavPence: 1_315_000,
        salvagePence: 19_075,
        interest: "no_interest",
        disposal: "sold",
        saleProceedsPence: 10_000,
      });
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-6",
        claimId: "c9",
        actorId: "staff-justin",
        head: "vehicle_damage",
        amountPence: 1_000_000,
        correction: false,
      });
      const review = listOpenPaymentReviews("c9");
      assert.equal(review.length, 1);
      assert.equal(review[0].outstandingPence, 305_000);
    });
    db.close();
  });
});

describe("payment review — one item, and a missing invoice", () => {
  it("keeps one review when two payments arrive, and a correction is not added twice", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-7", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 10_000, correction: false });
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-8", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 15_000, correction: false });
      const both = listOpenPaymentReviews("c6");
      assert.equal(both.length, 1);
      assert.equal(both[0].receivedPence, 25_000);
      assert.equal(both[0].outstandingPence, 75_000);
      const corrected = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-9",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 20_000,
        correction: true,
      });
      assert.equal(corrected.replacedPrevious, true);
      assert.equal(corrected.receivedPence, 30_000);
      const reviews = listOpenPaymentReviews("c6");
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].receivedPence, 30_000);
      assert.equal(reviews[0].outstandingPence, 70_000);
    });
    db.close();
  });

  it("flags a payment on a head with no claim or invoice, and does not create a financial record", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = db.prepare(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = 'c5'`).get() as { n: number };
      const result = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-10",
        claimId: "c5",
        actorId: "staff-justin",
        head: "recovery",
        amountPence: 5_000,
        correction: false,
      });
      assert.equal(result.allocated, false);
      assert.equal(result.reconciliation, true);
      const after = db.prepare(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = 'c5'`).get() as { n: number };
      assert.equal(after.n, before.n);
      assert.ok(listClaimEvents("c5").some((event) => event.event_type === "payment_manual_reconciliation"));
      assert.equal(listOpenPaymentReviews("c5").length, 0);
    });
    db.close();
  });

  it("leaves storage, repairs and vehicle damage alone when the review is on hire", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(
        `INSERT INTO financial_lines(
          id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
          claimed_pence, offered_pence, agreed_pence, received_pence
        ) VALUES
          ('f-c7-st', 'c7', 'storage', 'Storage', 1, 'job', 0, 0, 0, 0, 20000, 0, 20000, 0),
          ('f-c7-rep', 'c7', 'repairs', 'Repairs', 1, 'job', 0, 0, 0, 0, 80000, 0, 80000, 0),
          ('f-c7-vd', 'c7', 'vehicle_damage', 'PAV', 1, 'item', 0, 0, 0, 0, 50000, 0, 50000, 0)`,
      ).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-11",
        claimId: "c7",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 10_000,
        correction: false,
        insurerReason: "",
      });
      const reviews = listOpenPaymentReviews("c7");
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].head, "hire");
      assert.equal(reviews[0].outstandingPence, 80_000);
      assert.equal(reviews[0].insurerReasonLabel, "no reason given");
      assert.equal(money(db, "f-c7-st").received_pence, 0);
      assert.equal(money(db, "f-c7-st").agreed_pence, 20_000);
      assert.equal(money(db, "f-c7-rep").received_pence, 0);
      assert.equal(money(db, "f-c7-vd").agreed_pence, 50_000);
      assert.equal(money(db, "f-c7-hire").agreed_pence, 90_000);
      assert.equal(money(db, "f-c7-hire").received_pence, 10_000);
    });
    db.close();
  });
});

describe("payment review — accept and dispute", () => {
  it("refuses accept without the permission, including an administrator who has not been granted it", () => {
    assert.equal(canAcceptPaymentSettlement({ role: "administrator", permissions: [] }), false);
    assert.equal(canAcceptPaymentSettlement({ role: "administrator", permissions: [ACCEPT_PAYMENT_SETTLEMENT] }), true);
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(listStaffPermissions("staff-sian").includes(ACCEPT_PAYMENT_SETTLEMENT), false);
      assert.equal(listStaffPermissions("staff-justin").includes(ACCEPT_PAYMENT_SETTLEMENT), true);
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-12", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 40_000, correction: false });
      const before = money(db, "f-c6-rep");
      assert.throws(() => acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-sian", head: "repairs" }), /permission/);
      const created = createStaffAccount({
        name: "Second Admin",
        username: "secondadmin",
        email: "second.admin@example.test",
        password: "password1",
        role: "administrator",
        actorId: "staff-justin",
      });
      if (!created.ok) throw new Error(created.error);
      assert.equal(canAcceptPaymentSettlement({ role: "administrator", permissions: listStaffPermissions(created.id) }), false);
      assert.throws(() => acceptPaymentAsFinal({ claimId: "c6", actorId: created.id, head: "repairs" }), /permission/);
      db.prepare(`DELETE FROM staff_permissions WHERE staff_id = 'staff-justin' AND permission = ?`).run(ACCEPT_PAYMENT_SETTLEMENT);
      assert.throws(() => acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs" }), /permission/);
      assert.deepEqual(money(db, "f-c6-rep"), before);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_write_off"), false);
    });
    db.close();
  });

  it("does not accept a shortfall until the write-off is confirmed", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-13", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 40_000, correction: false });
      const before = money(db, "f-c6-rep");
      assert.throws(
        () => acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs" }),
        /Confirm the write-off/,
      );
      assert.throws(
        () => acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs", confirmed: false }),
        /Confirm the write-off/,
      );
      assert.deepEqual(money(db, "f-c6-rep"), before);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_settlement_accepted"), false);
    });
    db.close();
  });

  it("accepts the amount received as final, writes off the shortfall, stops the chase, and does not close hire or storage", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      db.prepare(
        `INSERT INTO financial_lines(
          id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
          claimed_pence, offered_pence, agreed_pence, received_pence
        ) VALUES ('f-c6-st', 'c6', 'storage', 'Storage', 1, 'job', 0, 0, 0, 0, 50000, 0, 50000, 0)`,
      ).run();
      const positions = hireStorage(db, "c6");
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-14",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 40_000,
        correction: false,
        insurerReason: "We allow the labour only",
      });
      const result = acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs", confirmed: true });
      assert.equal(result.agreedPence, 40_000);
      assert.equal(result.writeOffPence, 60_000);
      assert.equal(result.reason, "We allow the labour only");
      const repairs = money(db, "f-c6-rep");
      assert.equal(repairs.agreed_pence, 40_000);
      assert.equal(repairs.received_pence, 40_000);
      assert.equal(repairs.claimed_pence, 240_000);
      assert.equal(money(db, "f-c6-st").agreed_pence, 50_000);
      assert.equal(money(db, "f-c6-st").received_pence, 0);
      const chase = chaseForClaim("repair_payment", "c6");
      assert.equal(chase?.due, false);
      assert.equal(chase?.outcomeOnFile, true);
      assert.equal(chase?.payment?.paidInFull, true);
      assert.equal(listOpenPaymentReviews("c6").some((item) => item.head === "repairs"), false);
      const written = listClaimEvents("c6").find((event) => event.event_type === "payment_write_off");
      assert.match(String(written?.details || ""), /write_off_pence=60000/);
      assert.match(String(written?.details || ""), /We allow the labour only/);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_hire_storage_review"));
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "hire_ended"), false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "storage_ended"), false);
      assert.deepEqual(hireStorage(db, "c6"), positions);
    });
    db.close();
  });

  it("resumes the chase on dispute, keeps the agreed figure, and a later full payment stops it", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      const positions = hireStorage(db, "c6");
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-15", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 25_000, correction: false });
      assert.equal(listChasesForClaim("c6").find((row) => row.kind === "repair_payment")?.handlerState, "paused");
      const disputed = disputePaymentSettlement({
        claimId: "c6",
        actorId: "staff-sian",
        head: "repairs",
        grounds: "The invoice includes items that were not on the estimate.",
      });
      assert.equal(disputed.outstandingPence, 75_000);
      assert.equal(money(db, "f-c6-rep").agreed_pence, 100_000);
      assert.equal(money(db, "f-c6-rep").received_pence, 25_000);
      assert.equal(listOpenPaymentReviews("c6").length, 0);
      const resumed = chaseForClaim("repair_payment", "c6");
      assert.equal(resumed?.handlerState, "tracking");
      assert.equal(resumed?.outcomeOnFile, false);
      assert.equal(resumed?.payment?.paidInFull, false);
      const grounds = listClaimEvents("c6").find((event) => event.event_type === "payment_settlement_disputed");
      assert.match(String(grounds?.details || ""), /items that were not on the estimate/);
      const rest = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-16", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 75_000, correction: false });
      assert.equal(rest.paidInFull, true);
      assert.equal(rest.outstandingPence, 0);
      const settled = chaseForClaim("repair_payment", "c6");
      assert.equal(settled?.due, false);
      assert.equal(settled?.outcomeOnFile, true);
      assert.equal(settled?.payment?.paidInFull, true);
      assert.ok(listClaimEvents("c6").some((event) => event.event_type === "payment_hire_storage_review"));
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "hire_ended"), false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "storage_ended"), false);
      assert.deepEqual(hireStorage(db, "c6"), positions);
      assert.equal(money(db, "f-c6-rep").agreed_pence, 100_000);
    });
    db.close();
  });

  it("grants acceptPaymentSettlement to Justin's staff row on migrate, and not to Sian", () => {
    const db = seeded();
    const claimsBefore = (db.prepare(`SELECT COUNT(*) AS n FROM claims`).get() as { n: number }).n;
    db.prepare(`DELETE FROM staff_permissions WHERE permission = ?`).run(ACCEPT_PAYMENT_SETTLEMENT);
    migrate(db);
    const justin = db
      .prepare(`SELECT permission FROM staff_permissions WHERE staff_id = 'staff-justin' AND permission = ?`)
      .get(ACCEPT_PAYMENT_SETTLEMENT) as { permission: string };
    assert.equal(justin.permission, ACCEPT_PAYMENT_SETTLEMENT);
    const sian = db
      .prepare(`SELECT COUNT(*) AS n FROM staff_permissions WHERE staff_id = 'staff-sian' AND permission = ?`)
      .get(ACCEPT_PAYMENT_SETTLEMENT) as { n: number };
    assert.equal(sian.n, 0);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM claims`).get() as { n: number }).n, claimsBefore);
    db.close();
  });
});

describe("payment review — log first, decide later", () => {
  it("logs a partial payment without a decision, and the awaiting flag is still there on a later read", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      const logged = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-17",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 40_000,
        correction: false,
      });
      assert.equal(logged.paidInFull, false);
      assert.equal(logged.settledReview, false);
      assert.equal("decision" in logged, false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_settlement_accepted"), false);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_settlement_disputed"), false);
      const first = listOpenPaymentReviews("c6");
      assert.equal(first.length, 1);
      assert.equal(first[0].outstandingPence, 60_000);
      const later = listOpenPaymentReviews("c6");
      assert.equal(later.length, 1);
      assert.equal(later[0].head, "repairs");
      assert.equal(later[0].receivedPence, 40_000);
      assert.equal(later[0].outstandingPence, 60_000);
      const attention = listPaymentAttention().awaiting;
      assert.equal(attention.length, 1);
      assert.equal(attention[0].fileReference, "TEST-0006");
      assert.equal(attention[0].href, "/claims/c6/heads/vehicle");
      assert.equal(attention[0].label, awaitingDecisionLabel(later[0]));
      const dashboard = getDashboard();
      assert.equal(dashboard.awaitingDecisions.length, 1);
      assert.equal(dashboard.awaitingDecisions[0].claimId, "c6");
    });
    db.close();
  });

  it("updates the one awaiting item when a second payment arrives before any decision", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-18", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 10_000, correction: false });
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-19", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 15_000, correction: false });
      const reviews = listOpenPaymentReviews("c6");
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].receivedPence, 25_000);
      assert.equal(reviews[0].outstandingPence, 75_000);
      const screen = paymentDecisionForHead("c6", "repairs");
      assert.equal(screen?.receivedPence, 25_000);
      assert.equal(screen?.outstandingPence, 75_000);
      assert.equal(screen?.targetPence, 100_000);
      const attention = listPaymentAttention().awaiting;
      assert.equal(attention.length, 1);
      assert.match(attention[0].label, /£250\.00 received, £750\.00 still outstanding/);
      assert.equal(listClaimEvents("c6").some((event) => event.event_type === "payment_settlement_accepted"), false);
    });
    db.close();
  });

  it("does not put Accept or Dispute on the log action or the record-payment form", () => {
    const actions = fs.readFileSync(path.join(process.cwd(), "src/app/chase-actions.ts"), "utf8");
    const start = actions.indexOf("export async function actionLogHeadPayment");
    const end = actions.indexOf("export async function actionAcceptPaymentSettlement");
    const body = actions.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(body, /Accept as final/);
    assert.doesNotMatch(body, /Dispute/);
    assert.doesNotMatch(body, /actionAcceptPaymentSettlement/);
    assert.doesNotMatch(body, /actionDisputePaymentSettlement/);
    const logPanel = fs.readFileSync(path.join(process.cwd(), "src/components/claims/PaymentReviewPanel.tsx"), "utf8");
    assert.doesNotMatch(logPanel, /Accept as final/);
    assert.doesNotMatch(logPanel, /Dispute \/ keep chasing/);
    assert.doesNotMatch(logPanel, /lg:grid-cols-2/);
    assert.doesNotMatch(logPanel, /actionAcceptPaymentSettlement/);
    const decision = fs.readFileSync(path.join(process.cwd(), "src/components/claims/HeadDecisionForm.tsx"), "utf8");
    assert.match(decision, /Accept as final/);
    assert.match(decision, /Dispute \/ keep chasing/);
    assert.match(decision, /Yes, write this off/);
    assert.match(decision, /confirm/);
    assert.doesNotMatch(decision, /lg:grid-cols-2/);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
    assert.match(page, /paymentDecision/);
    assert.match(page, /headScreenPath/);
    assert.match(page, /AwaitingDecisionList/);
    assert.doesNotMatch(page, /PaymentDecisionScreen/);
    assert.match(page, /heads\/hire/);
    const dashboard = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.match(dashboard, /Awaiting decision/);
    assert.match(dashboard, /Payments to review/);
  });

  it("flags a payment that arrives after accept, and does not change the settled figures", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-20",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 40_000,
        correction: false,
        insurerReason: "We allow the labour only",
      });
      acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs", confirmed: true });
      const settled = money(db, "f-c6-rep");
      assert.equal(settled.agreed_pence, 40_000);
      assert.equal(settled.received_pence, 40_000);
      const extra = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-21",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 10_000,
        correction: false,
      });
      assert.equal(extra.settledReview, true);
      assert.equal(extra.allocated, false);
      const after = money(db, "f-c6-rep");
      assert.equal(after.agreed_pence, 40_000);
      assert.equal(after.received_pence, 40_000);
      assert.equal(after.claimed_pence, settled.claimed_pence);
      assert.equal(listOpenPaymentReviews("c6").some((item) => item.head === "repairs"), false);
      const flags = listPaymentsAfterSettlement("c6");
      assert.equal(flags.length, 1);
      assert.equal(flags[0].head, "repairs");
      assert.equal(flags[0].amountPence, 10_000);
      assert.match(flags[0].label, /was not added/);
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-22",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 5_000,
        correction: true,
      });
      assert.equal(money(db, "f-c6-rep").agreed_pence, 40_000);
      assert.equal(money(db, "f-c6-rep").received_pence, 40_000);
      assert.equal(listPaymentsAfterSettlement("c6").length, 1);
      assert.equal(listPaymentsAfterSettlement("c6")[0].amountPence, 5_000);
      const dashboard = listPaymentAttention().afterSettlement;
      assert.equal(dashboard.length, 1);
      assert.equal(dashboard[0].fileReference, "TEST-0006");
      assert.equal(dashboard[0].href, "/claims/c6/heads/vehicle");
    });
    db.close();
  });

  it("after a dispute, a further part-payment reduces the outstanding figure and does not open another decision", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-23", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 25_000, correction: false });
      disputePaymentSettlement({
        claimId: "c6",
        actorId: "staff-sian",
        head: "repairs",
        grounds: "The invoice includes items that were not on the estimate.",
      });
      assert.equal(listOpenPaymentReviews("c6").length, 0);
      const further = recordHeadPayment({
        submitKey: "payment-review-recordHeadPayment-24",
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 20_000,
        correction: false,
      });
      assert.equal(further.allocated, true);
      assert.equal(further.paidInFull, false);
      assert.equal(further.paused, false);
      assert.equal(further.outstandingPence, 55_000);
      assert.equal(further.receivedPence, 45_000);
      assert.equal(money(db, "f-c6-rep").agreed_pence, 100_000);
      assert.equal(listOpenPaymentReviews("c6").length, 0);
      assert.equal(listPaymentAttention().awaiting.length, 0);
      const chase = chaseForClaim("repair_payment", "c6");
      assert.equal(chase?.handlerState, "tracking");
      assert.equal(chase?.outcomeOnFile, false);
      assert.equal(paymentDecisionForHead("c6", "repairs"), null);
    });
    db.close();
  });
});

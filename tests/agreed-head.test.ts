import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { chaseForClaim, chaseRow, pauseChase } from "../src/lib/db/chase.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { recordAgreedHeadFigure, recordAgreedRepairInvoice, recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import { listOpenPaymentReviews } from "../src/lib/db/payment-review.ts";
import { seed } from "../src/lib/db/seed.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function line(db: DatabaseSync, id: string) {
  return db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE id = ?`).get(id) as {
    claimed_pence: number;
    agreed_pence: number;
    received_pence: number;
  };
}

function chases(db: DatabaseSync, claimId: string) {
  return db
    .prepare(`SELECT rule_key, status, paused, reason FROM automations WHERE claim_id = ? ORDER BY rule_key`)
    .all(claimId);
}

describe("agreed figures on hire, recovery and storage", () => {
  it("records an agreed hire, recovery and storage figure without touching claimed or received", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-1", claimId: "c3", actorId: "staff-justin", head: "recovery", agreedPence: 25000 });
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-2", claimId: "c3", actorId: "staff-justin", head: "storage", agreedPence: 18000 });
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-3", claimId: "c4", actorId: "staff-justin", head: "hire", agreedPence: 5000 });
    });
    const recovery = line(db, "f-c3-rec");
    assert.equal(recovery.claimed_pence, 39500);
    assert.equal(recovery.agreed_pence, 25000);
    assert.equal(recovery.received_pence, 0);
    const storage = line(db, "f-c3-st");
    assert.equal(storage.claimed_pence, 23400);
    assert.equal(storage.agreed_pence, 18000);
    assert.equal(storage.received_pence, 0);
    const hire = db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c4' AND head_of_loss = 'hire'`).get() as {
      claimed_pence: number;
      agreed_pence: number;
      received_pence: number;
    };
    assert.equal(hire.claimed_pence, 0);
    assert.equal(hire.agreed_pence, 5000);
    assert.equal(hire.received_pence, 0);
    assert.throws(
      () => withDatabase(db, () => recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-4", claimId: "c3", actorId: "staff-justin", head: "hire", agreedPence: 0 })),
      /not taken from the claimed figure/,
    );
    db.close();
  });

  it("switches an open comparison from claimed to the new agreed figure and leaves a running chase alone", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordHeadPayment({
        submitKey: "agreed-head-recordHeadPayment-5", claimId: "c3", actorId: "staff-justin", head: "hire", amountPence: 10000, correction: false });
      const before = listOpenPaymentReviews("c3").find((item) => item.head === "hire");
      assert.equal(before?.targetPence, 53400);
      assert.equal(before?.outstandingPence, 43400);
      const running = chases(db, "c3");
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-6", claimId: "c3", actorId: "staff-justin", head: "hire", agreedPence: 40000 });
      const after = listOpenPaymentReviews("c3").find((item) => item.head === "hire");
      assert.equal(after?.targetPence, 40000);
      assert.equal(after?.outstandingPence, 30000);
      assert.equal(loadHeadSection("c3", "hire").outstandingPence, 30000);
      assert.deepEqual(chases(db, "c3"), running);
      const money = line(db, "f-c3-hire");
      assert.equal(money.claimed_pence, 53400);
      assert.equal(money.received_pence, 10000);
      assert.equal(money.agreed_pence, 40000);
    });
    db.close();
  });

  it("keeps a paused repair payment chase paused when the agreed repair figure changes, and measures it against the new figure", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedRepairInvoice({
        submitKey: "agreed-head-recordAgreedRepairInvoice-7", claimId: "c6", actorId: "staff-justin", agreedPence: 100000 });
      pauseChase("repair_payment", "c6", "Paused while the figure is checked.");
      const paused = chaseRow("c6", "repair_payment");
      assert.equal(paused?.status, "paused");
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-8", claimId: "c6", actorId: "staff-justin", head: "hire", agreedPence: 20000 });
      assert.equal(chaseRow("c6", "repair_payment")?.status, "paused");
      recordAgreedRepairInvoice({
        submitKey: "agreed-head-recordAgreedRepairInvoice-9", claimId: "c6", actorId: "staff-justin", agreedPence: 80000 });
      const still = chaseRow("c6", "repair_payment");
      assert.equal(still?.status, "paused");
      assert.equal(Number(still?.paused), 1);
      const view = chaseForClaim("repair_payment", "c6");
      assert.equal(view?.payment?.outstandingPence, 80000);
      assert.equal(view?.payment?.agreedPence, 80000);
      const repairs = db.prepare(`SELECT claimed_pence, received_pence FROM financial_lines WHERE id = 'f-c6-rep'`).get() as {
        claimed_pence: number;
        received_pence: number;
      };
      assert.equal(repairs.claimed_pence, 240000);
      assert.equal(repairs.received_pence, 0);
    });
    db.close();
  });

  it("records a payment against the agreed figure through the same action the head screen uses", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordAgreedHeadFigure({
        submitKey: "agreed-head-recordAgreedHeadFigure-10", claimId: "c4", actorId: "staff-justin", head: "hire", agreedPence: 5000 });
      const fromHeadScreen = recordHeadPayment({
        submitKey: "agreed-head-recordHeadPayment-11",
        claimId: "c4",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 1000,
        correction: false,
      });
      assert.equal(fromHeadScreen.allocated, true);
      assert.equal(fromHeadScreen.receivedPence, 1000);
      assert.equal(fromHeadScreen.outstandingPence, 4000);
      const again = recordHeadPayment({
        submitKey: "agreed-head-recordHeadPayment-12",
        claimId: "c4",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 500,
        correction: false,
      });
      assert.equal(again.receivedPence, 1500);
      assert.equal(again.outstandingPence, 3500);
      assert.equal(loadHeadSection("c4", "hire").outstandingPence, 3500);
    });
    db.close();
  });

  it("puts record-payment and record-agreed on each head screen, using the existing actions", () => {
    const hire = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/heads/hire/page.tsx"), "utf8");
    const recovery = [
      fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/heads/recovery/page.tsx"), "utf8"),
      fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/heads/storage/page.tsx"), "utf8"),
    ].join("\n");
    const vehicle = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/heads/vehicle/page.tsx"), "utf8");
    const payment = fs.readFileSync(path.join(process.cwd(), "src/components/claims/PaymentReviewPanel.tsx"), "utf8");
    const agreed = fs.readFileSync(path.join(process.cwd(), "src/components/claims/HeadAgreedForm.tsx"), "utf8");
    const totalLoss = fs.readFileSync(path.join(process.cwd(), "src/components/claims/TotalLossAgreedForm.tsx"), "utf8");
    assert.match(hire, /HeadAgreedForm/);
    assert.match(hire, /head="hire"/);
    assert.match(hire, /lockedHead=\{\{ head: "hire"/);
    assert.match(recovery, /head="recovery"/);
    assert.match(recovery, /head="storage"/);
    assert.match(recovery, /lockedHead=\{\{[\s\S]*?head: "recovery"/);
    assert.match(recovery, /lockedHead=\{\{[\s\S]*?head: "storage"/);
    assert.match(vehicle, /VehicleOffers/);
    assert.doesNotMatch(vehicle, /HeadAgreedForm/);
    assert.match(vehicle, /TotalLossAgreedForm/);
    assert.match(vehicle, /suggestionOnly/);
    assert.match(vehicle, /lockedHead=/);
    const offers = fs.readFileSync(path.join(process.cwd(), "src/components/claims/VehicleOffers.tsx"), "utf8");
    const offerRoute = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/vehicle-offers/route.ts"), "utf8");
    assert.match(offers, /Record offer/);
    assert.match(offers, /Record agreed figure/);
    assert.match(offers, /Use this figure/);
    assert.match(offerRoute, /recordAgreedRepairInvoice/);
    assert.match(offerRoute, /confirmTypedVehicleDamageAgreed/);
    assert.match(offerRoute, /recordVehicleOffer/);
    assert.match(payment, /actionLogHeadPayment/);
    assert.match(agreed, /actionRecordAgreedRepair/);
    assert.match(agreed, /actionRecordAgreedHead/);
    assert.match(agreed, /Record agreed figure/);
    assert.match(totalLoss, /confirm_suggestion/);
    assert.match(totalLoss, /confirm_agreed/);
    assert.match(totalLoss, /Use this suggestion as the agreed amount/);
    assert.match(totalLoss, /Save this as the agreed amount/);
  });
});

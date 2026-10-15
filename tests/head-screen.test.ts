import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import { acceptPaymentAsFinal, disputePaymentSettlement } from "../src/lib/db/payment-review.ts";
import { seed } from "../src/lib/db/seed.ts";
import { saveTotalLossReport } from "../src/lib/db/total-loss.ts";
import { applicableVehicleHead, describeHeadStatus, headScreenPath } from "../src/lib/domain/head-screen.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("head of loss screens", () => {
  it("shows nothing recorded on a new file, and keeps recovery and storage as separate figures", () => {
    const db = seeded();
    withDatabase(db, () => {
      const empty = loadHeadSection("c1", "recovery");
      assert.equal(empty.empty, true);
      assert.equal(empty.statusLabel, "Nothing recorded yet");
      assert.equal(empty.history.length, 0);
      const recovery = loadHeadSection("c3", "recovery");
      const storage = loadHeadSection("c3", "storage");
      assert.equal(recovery.claimedPence, 39_500);
      assert.equal(storage.claimedPence, 23_400);
      assert.notEqual(recovery.claimedPence, storage.claimedPence);
      assert.equal(recovery.receivedPence, 0);
      assert.equal(storage.receivedPence, 0);
      assert.equal(headScreenPath("c3", "recovery"), "/claims/c3/heads/recovery");
      assert.equal(headScreenPath("c3", "storage"), "/claims/c3/heads/storage");
    });
    db.close();
  });

  it("matches hire figures, a part-payment awaiting decision, a dispute, and a confirmed settlement", () => {
    const db = seeded();
    withDatabase(db, () => {
      const hire = loadHeadSection("c7", "hire");
      assert.equal(hire.claimedPence, 129_600);
      assert.equal(hire.agreedPence, 90_000);
      assert.equal(hire.receivedPence, 0);
      assert.equal(hire.outstandingPence, 90_000);
      assert.equal(hire.statusLabel, "On file");
      assert.equal(hire.review, null);

      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000 WHERE id = 'f-c6-rep'`).run();
      recordHeadPayment({
        submitKey: "head-screen-recordHeadPayment-1", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 40_000, correction: false });
      const waiting = loadHeadSection("c6", "repairs");
      assert.equal(waiting.statusLabel, "Awaiting decision");
      assert.equal(waiting.receivedPence, 40_000);
      assert.equal(waiting.outstandingPence, 60_000);
      assert.equal(waiting.review?.outstandingPence, 60_000);
      assert.equal(waiting.history.some((entry) => entry.title === "Repair invoice payment logged"), true);
      const logged = waiting.history.find((entry) => entry.title === "Repair invoice payment logged");
      assert.match(logged?.detail || "", /£400\.00 recorded/);
      assert.doesNotMatch(logged?.detail || "", /amount_pence/);

      disputePaymentSettlement({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        grounds: "The labour rate is not agreed",
      });
      const disputed = loadHeadSection("c6", "repairs");
      assert.equal(disputed.statusLabel, "Disputed");
      assert.equal(disputed.agreedPence, 100_000);
      assert.equal(disputed.receivedPence, 40_000);
      assert.equal(disputed.review, null);
      assert.equal(
        disputed.history.some((entry) => entry.title === "Disputed" && entry.detail.includes("The labour rate is not agreed")),
        true,
      );

      db.prepare(`UPDATE financial_lines SET agreed_pence = 100000, received_pence = 0 WHERE id = 'f-c6-rep'`).run();
      db.prepare(`DELETE FROM payment_settlement_decisions WHERE claim_id = 'c6'`).run();
      recordHeadPayment({
        submitKey: "head-screen-recordHeadPayment-2", claimId: "c6", actorId: "staff-justin", head: "repairs", amountPence: 40_000, correction: false, confirmSeparate: true });
      acceptPaymentAsFinal({ claimId: "c6", actorId: "staff-justin", head: "repairs", confirmed: true });
      const settled = loadHeadSection("c6", "repairs");
      assert.equal(settled.statusLabel, "Settled");
      assert.equal(settled.agreedPence, 40_000);
      assert.equal(settled.receivedPence, 40_000);
      const accepted = settled.history.find((entry) => entry.title === "Accepted as the final figure");
      assert.ok(accepted);
      assert.match(accepted.detail, /£600\.00/);
      assert.equal(headScreenPath("c6", "repairs"), "/claims/c6/heads/vehicle");
    });
    db.close();
  });

  it("shows total-loss figures net of salvage, and switches off repairs when the file becomes a total loss", () => {
    assert.equal(applicableVehicleHead(false), "repairs");
    assert.equal(applicableVehicleHead(true), "vehicle_damage");
    const db = seeded();
    withDatabase(db, () => {
      const repairable = loadHeadSection("c6", applicableVehicleHead(false));
      assert.equal(repairable.head, "repairs");
      assert.equal(repairable.title, "Repairs");
      assert.equal(repairable.claimedPence, 240_000);

      db.prepare(`UPDATE claims SET later_declared_total_loss = 1 WHERE id = 'c6'`).run();
      db.prepare(
        `INSERT INTO financial_lines(
          id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
          claimed_pence, offered_pence, agreed_pence, received_pence
        ) VALUES ('f-c6-vd', 'c6', 'vehicle_damage', 'PAV', 1, 'item', 0, 0, 0, 0, 500000, 0, 400000, 0)`,
      ).run();
      const flags = db.prepare(`SELECT total_loss, later_declared_total_loss FROM claims WHERE id = 'c6'`).get() as {
        total_loss: number;
        later_declared_total_loss: number;
      };
      const converted = loadHeadSection(
        "c6",
        applicableVehicleHead(Number(flags.total_loss) === 1 || Number(flags.later_declared_total_loss) === 1),
      );
      assert.equal(converted.head, "vehicle_damage");
      assert.equal(converted.title, "Total loss");
      assert.equal(converted.claimedPence, 500_000);
      assert.equal(converted.agreedPence, 400_000);
      assert.equal(loadHeadSection("c6", "repairs").claimedPence, 240_000);

      db.prepare(`UPDATE financial_lines SET agreed_pence = 1315000 WHERE id = 'f-c9-vd'`).run();
      saveTotalLossReport({
        claimId: "c9",
        actorId: "staff-justin",
        pavPence: 1_315_000,
        salvagePence: 19_075,
        interest: "no_interest",
        disposal: null,
      });
      const totalLoss = loadHeadSection("c9", applicableVehicleHead(true));
      assert.equal(totalLoss.head, "vehicle_damage");
      assert.equal(totalLoss.preAccidentValuePence, 1_315_000);
      assert.equal(totalLoss.salvageProceedsPence, 19_075);
      assert.equal(totalLoss.agreedPence, 1_315_000 - 19_075);
      assert.equal(totalLoss.outstandingPence, 1_315_000 - 19_075);
      const hire = loadHeadSection("c9", "hire");
      assert.equal(hire.claimedPence, 200_000);
      assert.notEqual(hire.claimedPence, totalLoss.claimedPence);
    });
    db.close();
  });

  it("names the four staff-facing statuses", () => {
    assert.equal(describeHeadStatus({ empty: true, awaitingDecision: false, acceptedAsFinal: false, paidInFull: false, disputed: false, chase: "none" }), "Nothing recorded yet");
    assert.equal(describeHeadStatus({ empty: false, awaitingDecision: true, acceptedAsFinal: false, paidInFull: false, disputed: false, chase: "paused" }), "Awaiting decision");
    assert.equal(describeHeadStatus({ empty: false, awaitingDecision: false, acceptedAsFinal: false, paidInFull: false, disputed: true, chase: "tracking" }), "Disputed");
    assert.equal(describeHeadStatus({ empty: false, awaitingDecision: false, acceptedAsFinal: true, paidInFull: true, disputed: false, chase: "none" }), "Settled");
    assert.equal(describeHeadStatus({ empty: false, awaitingDecision: false, acceptedAsFinal: false, paidInFull: false, disputed: false, chase: "paused" }), "Paused");
    assert.equal(describeHeadStatus({ empty: false, awaitingDecision: false, acceptedAsFinal: false, paidInFull: false, disputed: false, chase: "tracking" }), "Active chase");
  });
});

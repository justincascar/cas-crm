import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  confirmTotalLossSuggestion,
  confirmTypedVehicleDamageAgreed,
  getTotalLossReport,
  getVehicleDamageMoney,
  saveTotalLossReport,
} from "../src/lib/db/total-loss.ts";
import { disposalApplies, optionalPoundsToPence, totalLossSuggestion } from "../src/lib/domain/total-loss.ts";
import { pence } from "../src/lib/money.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function money(db: DatabaseSync, claimId: string) {
  const lines = db.prepare(
    `SELECT head_of_loss, claimed_pence, offered_pence, agreed_pence, received_pence
     FROM financial_lines WHERE claim_id = ? ORDER BY head_of_loss, id`,
  ).all(claimId) as Array<{
    head_of_loss: string;
    claimed_pence: number;
    offered_pence: number;
    agreed_pence: number;
    received_pence: number;
  }>;
  const claim = db.prepare(
    `SELECT off_hire_scheduled_on, storage_billing_end_on, storage_started_on, total_loss FROM claims WHERE id = ?`,
  ).get(claimId) as {
    off_hire_scheduled_on: string | null;
    storage_billing_end_on: string | null;
    storage_started_on: string | null;
    total_loss: number;
  };
  return { lines, claim };
}

describe("total-loss engineer's figures", () => {
  it("suggests pre-accident value minus salvage only when both figures are present", () => {
    assert.deepEqual(
      totalLossSuggestion({ pavPence: pence(10000), salvagePence: pence(1500), interest: "no_interest" }),
      { kind: "suggestion", pence: pence(8500) },
    );
    assert.equal(totalLossSuggestion({ pavPence: pence(10000), salvagePence: null, interest: "no_interest" }).kind, "incomplete");
    assert.equal(totalLossSuggestion({ pavPence: null, salvagePence: pence(1500), interest: "no_interest" }).kind, "incomplete");
    assert.equal(optionalPoundsToPence(""), null);
    assert.equal(optionalPoundsToPence("0"), 0);
  });

  it("records each disposal outcome and does not turn a suggestion into agreed or paid", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = money(db, "c10");
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: "sold",
        saleProceedsPence: pence(1100),
      });
      const sold = getTotalLossReport("c10");
      assert.equal(sold.disposal, "sold");
      assert.equal(sold.saleProceedsPence, pence(1100));
      assert.equal(sold.customerChargePence, null);
      assert.equal(getVehicleDamageMoney("c10").agreedPence, pence(8200));
      assert.equal(getVehicleDamageMoney("c10").receivedPence, pence(8200));
      assert.deepEqual(money(db, "c10").lines, before.lines);

      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: "returned",
        returnedOn: "2026-09-20",
        customerChargePence: null,
      });
      const returned = getTotalLossReport("c10");
      assert.equal(returned.disposal, "returned");
      assert.equal(returned.returnedOn, "2026-09-20");
      assert.equal(returned.customerChargePence, null);
      assert.equal(returned.saleProceedsPence, pence(1100));

      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: "bought_by_cas",
        casPurchasePence: pence(900),
      });
      const bought = getTotalLossReport("c10");
      assert.equal(bought.disposal, "bought_by_cas");
      assert.equal(bought.casPurchasePence, pence(900));
      assert.equal(getVehicleDamageMoney("c10").receivedPence, pence(8200));
      assert.equal(money(db, "c10").claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.equal(money(db, "c10").claim.storage_billing_end_on, before.claim.storage_billing_end_on);
    });
    db.close();
  });

  it("hides disposal when the insurer takes the salvage, and keeps an insurer offer separate from the engineer", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: "sold",
        saleProceedsPence: pence(1100),
      });
      const beforeDamage = getVehicleDamageMoney("c10");
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "takes_interest",
        insurerOfferedPence: pence(7000),
        disposal: "returned",
        returnedOn: "2026-09-01",
      });
      const report = getTotalLossReport("c10");
      assert.equal(disposalApplies(report.interest), false);
      assert.equal(totalLossSuggestion(report).kind, "hidden");
      assert.equal(report.disposal, "sold");
      assert.equal(report.pavPence, pence(8200));
      assert.equal(report.salvagePence, pence(1500));
      assert.equal(report.insurerOfferedPence, pence(7000));
      const after = getVehicleDamageMoney("c10");
      assert.equal(after.offeredPence, pence(7000));
      assert.equal(after.agreedPence, beforeDamage.agreedPence);
      assert.equal(after.receivedPence, beforeDamage.receivedPence);
      assert.equal(after.claimedPence, beforeDamage.claimedPence);
    });
    db.close();
  });

  it("writes the agreed amount only when staff confirm, and refuses a file that is not a total loss", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-justin",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: null,
      });
      assert.equal(getVehicleDamageMoney("c10").agreedPence, pence(8200));
      confirmTotalLossSuggestion({ claimId: "c10", actorId: "staff-justin" });
      assert.equal(getVehicleDamageMoney("c10").agreedPence, pence(6700));
      assert.equal(getVehicleDamageMoney("c10").receivedPence, pence(8200));
      assert.equal(getVehicleDamageMoney("c10").claimedPence, pence(8200));
      const hire = money(db, "c10").lines.find((line) => line.head_of_loss === "hire");
      assert.equal(hire?.agreed_pence, pence(3610));
      assert.equal(hire?.received_pence, pence(3610));

      confirmTypedVehicleDamageAgreed({ claimId: "c10", actorId: "staff-justin", agreedPence: pence(6400) });
      assert.equal(getVehicleDamageMoney("c10").agreedPence, pence(6400));
      assert.equal(getVehicleDamageMoney("c10").receivedPence, pence(8200));
      assert.equal(getTotalLossReport("c10").salvagePence, pence(1500));

      assert.throws(
        () =>
          saveTotalLossReport({
            claimId: "c3",
            actorId: "staff-sian",
            pavPence: pence(1000),
            salvagePence: pence(100),
            interest: "no_interest",
            disposal: null,
          }),
        /only for a file marked total loss/,
      );
    });
    db.close();
  });
});

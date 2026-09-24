import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  confirmTotalLossSuggestion,
  confirmTypedVehicleDamageAgreed,
  getTotalLossReport,
  getVehicleDamageMoney,
  markTotalLossNoticeSent,
  prepareTotalLossInsurerEmail,
  saveTotalLossReport,
} from "../src/lib/db/total-loss.ts";
import {
  disposalApplies,
  optionalPoundsToPence,
  SALVAGE_REQUEST_MISMATCH_NOTE,
  salvageRequestMismatch,
  totalLossSuggestion,
} from "../src/lib/domain/total-loss.ts";
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

  it("notes a mismatch only when the request and the insurer's answer both exist and differ", () => {
    assert.equal(salvageRequestMismatch("full_pav", "takes_interest"), null);
    assert.equal(salvageRequestMismatch("net_cas", "no_interest"), null);
    assert.equal(salvageRequestMismatch("full_pav", "no_interest"), SALVAGE_REQUEST_MISMATCH_NOTE);
    assert.equal(salvageRequestMismatch("net_cas", "takes_interest"), SALVAGE_REQUEST_MISMATCH_NOTE);
    assert.equal(salvageRequestMismatch(null, "no_interest"), null);
    assert.equal(salvageRequestMismatch("full_pav", null), null);

    const db = prepared();
    withDatabase(db, () => {
      const before = money(db, "c10");
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: "no_interest",
        disposal: null,
        casRequest: "full_pav",
      });
      const report = getTotalLossReport("c10");
      assert.equal(report.casRequest, "full_pav");
      assert.equal(salvageRequestMismatch(report.casRequest, report.interest), SALVAGE_REQUEST_MISMATCH_NOTE);
      assert.equal(getVehicleDamageMoney("c10").agreedPence, pence(8200));
      assert.equal(getVehicleDamageMoney("c10").receivedPence, pence(8200));
      assert.equal(money(db, "c10").claim.storage_billing_end_on, before.claim.storage_billing_end_on);
      assert.equal(money(db, "c10").claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.deepEqual(
        money(db, "c10").lines.find((line) => line.head_of_loss === "hire"),
        before.lines.find((line) => line.head_of_loss === "hire"),
      );
    });
    db.close();
  });

  it("prepares a notification email for the handler to send, and does not send it", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.throws(
        () => prepareTotalLossInsurerEmail({ claimId: "c10", actorId: "staff-sian" }),
        /Record what CAS is asking/,
      );
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: null,
        disposal: null,
        casRequest: "net_cas",
      });
      assert.throws(
        () => prepareTotalLossInsurerEmail({ claimId: "c10", actorId: "staff-sian" }),
        /No insurer email on file/,
      );
      db.prepare(`UPDATE claim_third_parties SET insurer_email = ? WHERE claim_id = 'c10'`).run("claims@insurer.example.test");
      const inserted = db.prepare(`SELECT COUNT(*) AS n FROM claim_third_parties WHERE claim_id = 'c10'`).get() as { n: number };
      if (inserted.n === 0) {
        db.prepare(
          `INSERT INTO claim_third_parties(id, claim_id, person_id, insurer_name, insurer_email)
           VALUES ('tp-c10-test', 'c10', 'p-jess', 'Example Insurer', 'claims@insurer.example.test')`,
        ).run();
      }
      const before = money(db, "c10");
      const preparedNotice = prepareTotalLossInsurerEmail({ claimId: "c10", actorId: "staff-sian" });
      assert.match(preparedNotice.body || "", /^Dear Sir \/ Madam,/);
      assert.match(preparedNotice.body || "", /Our ref: TEST-0010/);
      assert.match(preparedNotice.body || "", /Your claim \/ policy reference: \[not yet on file\]/);
      assert.match(preparedNotice.body || "", /Engineer's pre-accident value: £8,200\.00/);
      assert.match(preparedNotice.body || "", /Engineer's salvage value: £1,500\.00/);
      assert.match(preparedNotice.body || "", /Please pay the net figure of £6,700\.00/);
      assert.doesNotMatch(preparedNotice.body || "", /CAS asks for/);
      assert.doesNotMatch(preparedNotice.body || "", /Prepared for the handler/);
      assert.doesNotMatch(preparedNotice.body || "", /claims@cascar\.co\.uk/);
      assert.match(preparedNotice.mailto || "", /^mailto:claims@insurer\.example\.test/);
      const row = db.prepare(`SELECT sent_status, template_key FROM correspondence WHERE id = ?`).get(preparedNotice.id) as {
        sent_status: string;
        template_key: string;
      };
      assert.equal(row.sent_status, "prepared_not_sent");
      assert.equal(row.template_key, "total_loss_salvage_request");
      assert.equal(money(db, "c10").claim.storage_billing_end_on, before.claim.storage_billing_end_on);
      assert.equal(getVehicleDamageMoney("c10").agreedPence, before.lines.find((line) => line.head_of_loss === "vehicle_damage")?.agreed_pence);

      markTotalLossNoticeSent({ claimId: "c10", correspondenceId: preparedNotice.id, actorId: "staff-sian" });
      const sent = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(preparedNotice.id) as { sent_status: string };
      assert.equal(sent.sent_status, "handler_marked_sent");
      const logged = db.prepare(
        `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c10' AND event_type = 'outgoing_email'`,
      ).get() as { n: number };
      assert.equal(logged.n, 1);
      const instructed = db.prepare(
        `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c10' AND event_type = 'engineer_instructed'`,
      ).get() as { n: number };
      assert.equal(instructed.n, 0);
      assert.equal(money(db, "c10").claim.storage_started_on, before.claim.storage_started_on);
    });
    db.close();
  });

  it("recognises a Third party 1 email saved immediately before preparing the notification", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveTotalLossReport({
        claimId: "c10",
        actorId: "staff-sian",
        pavPence: pence(8200),
        salvagePence: pence(1500),
        interest: null,
        disposal: null,
        casRequest: "net_cas",
      });
      const before = db.prepare(`SELECT COUNT(*) AS n FROM claim_third_parties WHERE claim_id = 'c10'`).get() as { n: number };
      assert.equal(before.n, 0);
      saveScreenData(
        "c10",
        "tp1",
        { insurerEmail: "saved-now@insurer.example.test", insurerReference: "TP-REF-100" },
        "staff-sian",
      );
      const stored = db.prepare(`SELECT insurer_email FROM claim_third_parties WHERE claim_id = 'c10' AND sequence = 1`).get() as {
        insurer_email: string;
      };
      assert.equal(stored.insurer_email, "saved-now@insurer.example.test");
      const notice = prepareTotalLossInsurerEmail({ claimId: "c10", actorId: "staff-sian" });
      assert.match(notice.body || "", /Your claim \/ policy reference: TP-REF-100/);
      assert.equal(notice.toAddress, "saved-now@insurer.example.test");
      assert.match(notice.mailto || "", /^mailto:saved-now@insurer\.example\.test/);
      const row = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(notice.id) as { sent_status: string };
      assert.equal(row.sent_status, "prepared_not_sent");
    });
    db.close();
  });
});

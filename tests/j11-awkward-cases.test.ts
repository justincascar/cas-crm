import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { chaseRow } from "../src/lib/db/chase.ts";
import { get, run, withDatabaseAsync, withDatabase } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordHeadPayment, recordSplitPayment } from "../src/lib/db/payment-ledger.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import { syncStorageClaimed } from "../src/lib/db/storage-charge.ts";
import { closeRepairStepsForTotalLoss } from "../src/lib/db/total-loss-switch.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { TOTAL_LOSS_SHORTFALL_CHASE_DUE_LABEL, totalLossPaymentChaseDecision } from "../src/lib/domain/follow-up-chases.ts";
import { classifyInsurerReply, classifyPaymentReply } from "../src/lib/domain/payment-chase.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-j11-"));
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

/** A new file with the recovery recorded five days ago and the storage charge to today. */
async function recoveryAndStorage() {
  const form = new FormData();
  form.set("client_forename", "Iwan");
  form.set("client_surname", "Awkward");
  form.set("client_mobile", "07700900222");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-7));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  const claim = await createClaimFromIntake(intakeFromFormData(form));
  const recovery = new FormData();
  recovery.set("arrivedDate", isoDateFromNow(-5));
  recovery.set("arrivedTime", "10:00");
  recovery.set("recoveryLocation", "A48");
  recovery.set("carCondition", "Front damaged.");
  recovery.set("notDriveable", "unsafe");
  recovery.set("recoveryTick_standard", "yes");
  recovery.set("recoveryAmount_standard", "395");
  recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recovery });
  syncStorageClaimed(claim.id);
  return claim.id;
}

function received(claimId: string, head: string): number {
  return Number(get<{ r: number }>(`SELECT received_pence AS r FROM financial_lines WHERE claim_id = ? AND head_of_loss = ?`, [claimId, head])?.r || 0);
}

describe("J11 — fixes found by the awkward-case journeys", () => {
  it("chases a part-paid total loss for the shortfall on its own 3-day clock", () => {
    const partPaidAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const decision = totalLossPaymentChaseDecision({
      noticeSentAt: null,
      insurerPromisedAt: null,
      paymentReceived: false,
      lastChaseSentAt: null,
      asAt: new Date().toISOString(),
      partPaidAt,
    });
    assert.equal(decision.stage, "shortfall");
    assert.equal(decision.started, true);
    assert.equal(decision.due, true);
    assert.equal(decision.label, TOTAL_LOSS_SHORTFALL_CHASE_DUE_LABEL);
    const paid = totalLossPaymentChaseDecision({ noticeSentAt: null, insurerPromisedAt: null, paymentReceived: true, lastChaseSentAt: null, asAt: new Date().toISOString(), partPaidAt });
    assert.equal(paid.stage, "received");
  });

  it("reads insurer replies: automatic replies never pause, decisions do, anything else goes to a person", () => {
    assert.equal(classifyInsurerReply("I am out of the office. Your email about the dispute will be read on Monday."), "acknowledgement");
    assert.equal(classifyPaymentReply("Automatic reply: we dispute nothing until I am back."), "acknowledgement");
    assert.equal(classifyInsurerReply("Thank you for your email. We have received your email."), "acknowledgement");
    assert.equal(classifyInsurerReply("We authorise the repairs as quoted."), "substantive");
    assert.equal(classifyInsurerReply("Liability is denied."), "substantive");
    assert.equal(classifyInsurerReply("Please call me about this one."), "uncertain");
  });

  it("closes the repair steps with a reason and stops the repair chase when a repairable file becomes a total loss", () => {
    const db = prepared();
    withDatabase(db, () => {
      // c6 has a repair authorisation request and its chase on the seed.
      assert.ok(chaseRow("c6", "repair_authorisation"));
      run(`UPDATE claims SET total_loss = 1 WHERE id = 'c6'`);
      closeRepairStepsForTotalLoss("c6", "staff-sian");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c6' AND event_type = 'repair_steps_closed_total_loss'`);
      assert.match(String(event?.details), /kept in the history and closed/);
      assert.equal(chaseRow("c6", "repair_authorisation")?.status, "cancelled");
      assert.equal(Number(get<{ n: number }>(`SELECT later_declared_total_loss AS n FROM claims WHERE id = 'c6'`)?.n), 1);
      const kept = get<{ n: number }>(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c6' AND event_type = 'repair_authorisation_requested'`);
      assert.equal(Number(kept?.n), 1, "the history is kept");
    });
    db.close();
  });

  it("records a confirmed overpayment on its own head, shown separately and never set against another head", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claimId = await recoveryAndStorage();
      const asked = recordHeadPayment({ claimId, actorId: "staff-sian", head: "recovery", amountPence: 50000, correction: false, submitKey: "over-1" });
      assert.ok("needsConfirm" in asked && asked.needsConfirm);
      assert.equal("confirmField" in asked ? asked.confirmField : "", "confirmOverpayment");
      assert.equal(received(claimId, "recovery"), 0, "nothing is recorded until it is confirmed");
      recordHeadPayment({ claimId, actorId: "staff-sian", head: "recovery", amountPence: 50000, correction: false, submitKey: "over-2", confirmOverpayment: true });
      assert.equal(received(claimId, "recovery"), 50000);
      assert.equal(received(claimId, "storage"), 0);
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'payment_overpaid'`, [claimId]);
      assert.match(String(event?.details), /overpaid_pence=2600/);
    });
    db.close();
  });

  it("splits one payment by head before anything is recorded, with no double counting", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claimId = await recoveryAndStorage();
      assert.throws(
        () => recordSplitPayment({ claimId, actorId: "staff-sian", totalPence: 60000, parts: [{ head: "recovery", pence: 47400 }, { head: "storage", pence: 10000 }], submitKey: "s1" }),
        /adds up to £574\.00, not the payment of £600\.00/,
      );
      assert.throws(
        () => recordSplitPayment({ claimId, actorId: "staff-sian", totalPence: 60000, parts: [{ head: "recovery", pence: 50000 }, { head: "storage", pence: 10000 }], submitKey: "s2" }),
        /more than the £474\.00 outstanding there\. Nothing was recorded/,
      );
      assert.throws(() => recordSplitPayment({ claimId, actorId: "staff-sian", totalPence: 47400, parts: [{ head: "recovery", pence: 47400 }], submitKey: "s3" }), /at least two heads/);
      assert.equal(received(claimId, "recovery") + received(claimId, "storage"), 0, "a refused split records nothing");
      recordSplitPayment({ claimId, actorId: "staff-sian", totalPence: 60000, parts: [{ head: "recovery", pence: 47400 }, { head: "storage", pence: 12600 }], submitKey: "s4" });
      assert.equal(received(claimId, "recovery"), 47400);
      assert.equal(received(claimId, "storage"), 12600);
      recordSplitPayment({ claimId, actorId: "staff-sian", totalPence: 60000, parts: [{ head: "recovery", pence: 47400 }, { head: "storage", pence: 12600 }], submitKey: "s4" });
      assert.equal(received(claimId, "recovery") + received(claimId, "storage"), 60000, "the same submit is not counted twice");
    });
    db.close();
  });

  it("keeps a save's message when a screen address redirects to its tab", () => {
    const page = read("src/app/claims/[id]/work/[screen]/page.tsx");
    assert.match(page, /A save comes back here with \?saved, \?error or \?clash/);
    assert.match(page, /query\.append\(name, item\)/);
  });

  it("sends a car change on a running hire to the vehicle swap, which needs a new signed agreement (R26)", () => {
    assert.match(read("src/lib/db/hire-choice.ts"), /This hire is running\. Use Swap the car/);
  });
});

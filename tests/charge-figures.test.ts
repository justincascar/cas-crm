import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { EMAIL_SEND_MODE_ENV } from "../src/lib/email/send-mode.ts";
import { setMailboxFetchForTests } from "../src/lib/email/microsoft-graph.ts";
import { BANK_DETAILS_MISSING_SETTINGS } from "../src/lib/domain/payment-details.ts";
import { paymentRequestCopy } from "../src/lib/domain/payment-chase.ts";
import { PAYMENT_TERM_NOT_SET_LABEL } from "../src/lib/constants.ts";
import { BLANK_PAYMENT_DETAILS } from "../src/lib/domain/payment-details.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { chaseForClaim, chaseRow, syncOutstandingPaymentChases } from "../src/lib/db/chase.ts";
import { acceptChargeFigure, disputeCharge, latestChargeDecision, proposeChargeAcceptance } from "../src/lib/db/charge-decision.ts";
import { figureFlag, keepStoredFigure, useCalculatedFigure } from "../src/lib/db/figure-resolution.ts";
import { hireChargeForClaim } from "../src/lib/db/hire-charge.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { sendPreparedCorrespondence } from "../src/lib/db/mailbox-send.ts";
import { recordAgreedHeadFigure, recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import { accountCanApproveSettlement } from "../src/lib/db/permissions.ts";
import { getClaim, getDashboard, listFinancials } from "../src/lib/db/queries.ts";
import { listVehicleOffers, recordVehicleOffer } from "../src/lib/db/vehicle-offers.ts";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";
import { isoDaysFromNow } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function seeded() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function money(db: DatabaseSync, claimId: string, head: string) {
  return db.prepare(
    `SELECT claimed_pence, agreed_pence, received_pence, offered_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
  ).get(claimId, head) as { claimed_pence: number; agreed_pence: number; received_pence: number; offered_pence: number } | undefined;
}

function ends(db: DatabaseSync, claimId: string) {
  const storage = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = ?`).get(claimId) as { storage_billing_end_on: string | null };
  const hire = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = ?`).all() as Array<{ billing_end_at: string | null }>;
  return { storage: storage.storage_billing_end_on, hire };
}

describe("calculated hire, storage and recovery figures", () => {
  it("lets office staff use the calculation or keep the stored figure, and shows one claimed figure", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = money(db, "c8", "hire");
      assert.ok(before);
      assert.equal(before.agreed_pence, 189600);
      assert.throws(() => useCalculatedFigure({ claimId: "c8", actorId: "staff-driver", role: "driver", head: "hire" }), /cannot open the money/i);
      assert.throws(() => keepStoredFigure({ claimId: "c3", actorId: "staff-mechanic", role: "mechanic", head: "storage", reason: "Checked" }), /cannot open the money/i);
      assert.deepEqual(money(db, "c8", "hire"), before);

      const calculated = hireChargeForClaim("c8").charge;
      assert.equal(calculated.status, "calculated");
      const target = calculated.status === "calculated" ? calculated.totalPence : 0;
      if ((before.claimed_pence || 0) === target) {
        db.prepare(`UPDATE financial_lines SET claimed_pence = ? WHERE claim_id = 'c8' AND head_of_loss = 'hire'`).run(target + 500);
      }
      const stored = money(db, "c8", "hire")!;
      useCalculatedFigure({ claimId: "c8", actorId: "staff-sian", role: "staff", head: "hire" });
      const used = money(db, "c8", "hire")!;
      assert.equal(used.agreed_pence, 189600);
      assert.equal(used.received_pence, stored.received_pence);
      assert.equal(used.claimed_pence, target);
      const page = loadHeadSection("c8", "hire").claimedPence;
      const overview = getClaim("c8")?.financials.find((line) => String(line.head_of_loss) === "hire");
      const financials = listFinancials().lines.find((line) => String(line.claim_id) === "c8" && String(line.head_of_loss) === "hire");
      const dashboard = getDashboard().byHead.hire?.claimed;
      const hireLines = db.prepare(`SELECT COALESCE(SUM(claimed_pence), 0) AS n FROM financial_lines WHERE head_of_loss = 'hire'`).get() as { n: number };
      assert.equal(page, used.claimed_pence);
      assert.equal(Number(overview?.claimed_pence), used.claimed_pence);
      assert.equal(Number(financials?.claimed_pence), used.claimed_pence);
      assert.equal(dashboard, Number(hireLines.n));
      assert.equal(figureFlag("c8", "hire", used.claimed_pence, target).differs, false);

      const storageBefore = money(db, "c3", "storage")!;
      db.prepare(`UPDATE financial_lines SET claimed_pence = ? WHERE claim_id = 'c3' AND head_of_loss = 'storage'`).run(storageBefore.claimed_pence + 100);
      assert.throws(() => keepStoredFigure({ claimId: "c3", actorId: "staff-sian", role: "staff", head: "storage", reason: "   " }), /reason is required/i);
      keepStoredFigure({ claimId: "c3", actorId: "staff-tom", role: "administrator", head: "storage", reason: "Engineer confirmed this figure" });
      const kept = money(db, "c3", "storage")!;
      assert.equal(kept.claimed_pence, storageBefore.claimed_pence + 100);
      assert.equal(kept.agreed_pence, storageBefore.agreed_pence);
      assert.equal(kept.received_pence, storageBefore.received_pence);
      const flag = figureFlag("c3", "storage", kept.claimed_pence, storageBefore.claimed_pence);
      assert.equal(flag.mode, "kept");
      assert.equal(flag.label, "Stored figure kept: Engineer confirmed this figure");
      assert.equal(loadHeadSection("c3", "storage").claimedPence, kept.claimed_pence);
    });
    db.close();
  });

  it("records offers and decisions on hire, storage and recovery without changing the other charges", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(accountCanApproveSettlement("staff-justin", "administrator"), true);
      assert.equal(accountCanApproveSettlement("staff-sian", "administrator"), false);
      assert.equal(accountCanApproveSettlement("staff-sian", "staff"), false);
      for (const head of ["hire", "storage", "recovery"] as const) {
        const before = money(db, "c3", head)!;
        recordVehicleOffer({
          claimId: "c3",
          actorId: "staff-megan",
          head,
          amountPence: 20_000,
          offeredOn: "2026-10-02",
          note: "",
          offeredDays: head === "recovery" ? null : 10,
          offeredDailyRatePence: head === "recovery" ? null : 1_000,
        });
        const after = money(db, "c3", head)!;
        assert.equal(after.claimed_pence, before.claimed_pence);
        assert.equal(after.agreed_pence, before.agreed_pence);
        assert.equal(after.received_pence, before.received_pence);
        const offer = listVehicleOffers("c3", head)[0];
        assert.equal(offer.amountPence, 20_000);
        if (head !== "recovery") assert.equal(offer.rateMismatch, true);
      }
      const again = recordVehicleOffer({
        claimId: "c3",
        actorId: "staff-megan",
        head: "hire",
        amountPence: 20_000,
        offeredOn: "2026-10-02",
        note: "",
        offeredDays: 10,
        offeredDailyRatePence: 1_000,
      });
      assert.equal(listVehicleOffers("c3", "hire").length, 1);
      assert.equal(again, listVehicleOffers("c3", "hire")[0].id);

      assert.throws(() => disputeCharge({ claimId: "c3", actorId: "staff-sian", role: "staff", head: "hire", reason: " " }), /reason/i);
      const hireBefore = money(db, "c3", "hire")!;
      const storageBefore = money(db, "c3", "storage")!;
      const datesBefore = ends(db, "c3");
      disputeCharge({ claimId: "c3", actorId: "staff-sian", role: "staff", head: "hire", reason: "rate" });
      assert.equal(latestChargeDecision("c3", "hire").decision, "disputed");
      assert.equal(latestChargeDecision("c3", "storage").decision, "awaiting");
      assert.deepEqual(money(db, "c3", "storage"), storageBefore);
      assert.equal(money(db, "c3", "hire")!.agreed_pence, hireBefore.agreed_pence);
      assert.deepEqual(ends(db, "c3"), datesBefore);

      const claimed = money(db, "c3", "recovery")!.claimed_pence;
      assert.ok(claimed > 100);
      assert.throws(
        () => acceptChargeFigure({ claimId: "c3", actorId: "staff-sian", role: "staff", head: "recovery", agreedPence: claimed - 100 }),
        /approveSettlement/,
      );
      assert.throws(
        () => recordAgreedHeadFigure({ claimId: "c3", actorId: "staff-sian", head: "recovery", agreedPence: claimed - 100 }),
        /approveSettlement/,
      );
      assert.equal(money(db, "c3", "recovery")!.agreed_pence, 0);
      proposeChargeAcceptance({ claimId: "c3", actorId: "staff-sian", role: "staff", head: "recovery", agreedPence: claimed - 100 });
      assert.equal(latestChargeDecision("c3", "recovery").decision, "proposed");
      assert.equal(money(db, "c3", "recovery")!.agreed_pence, 0);
      assert.equal(latestChargeDecision("c3", "hire").decision, "disputed");
      acceptChargeFigure({ claimId: "c3", actorId: "staff-justin", role: "staff", head: "storage", agreedPence: storageBefore.claimed_pence });
      assert.equal(money(db, "c3", "storage")!.agreed_pence, storageBefore.claimed_pence);
      assert.equal(money(db, "c3", "hire")!.agreed_pence, hireBefore.agreed_pence);
      assert.equal(money(db, "c3", "recovery")!.agreed_pence, 0);
      assert.deepEqual(ends(db, "c3"), datesBefore);
    });
    db.close();
  });

  it("starts a charge chase only when the figure is final and a payment request was recorded as sent", async () => {
    const db = seeded();
    const savedMode = process.env[EMAIL_SEND_MODE_ENV];
    process.env[EMAIL_SEND_MODE_ENV] = "simulate";
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabase(db, async () => {
        db.prepare(
          `INSERT INTO financial_lines(
            id, claim_id, head_of_loss, description, claimed_pence, offered_pence, agreed_pence, received_pence
          ) VALUES ('f-c4-hire-test', 'c4', 'hire', 'Hire', 10000, 0, 0, 0)`,
        ).run();
        db.prepare(
          `INSERT INTO financial_lines(
            id, claim_id, head_of_loss, description, claimed_pence, offered_pence, agreed_pence, received_pence
          ) VALUES ('f-c4-st-test', 'c4', 'storage', 'Storage', 8000, 0, 0, 0)`,
        ).run();
        const hireBefore = money(db, "c4", "hire")!;
        const c5 = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as { storage_billing_end_on: string | null };
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseForClaim("hire_payment", "c4"), null);
        assert.equal(chaseForClaim("storage_payment", "c4"), null);
        db.prepare(`UPDATE hire_episodes SET billing_end_at = '2026-10-01T17:00:00.000Z' WHERE claim_id = 'c4'`).run();
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseForClaim("hire_payment", "c4"), null);
        const sentAt = isoDaysFromNow(-10);
        db.prepare(
          `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source)
           VALUES ('ev-c4-hire-pay', 'c4', 'hire_payment_request_sent', 'Hire payment request marked as sent', 'head=hire', ?, ?, 'staff-justin', 'file', 'staff')`,
        ).run(sentAt, sentAt);
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseRow("c4", "hire_payment")?.status, "tracking");
        assert.equal(chaseForClaim("storage_payment", "c4"), null);
        db.prepare(`UPDATE claims SET storage_billing_end_on = '2026-09-14' WHERE id = 'c4'`).run();
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseForClaim("storage_payment", "c4"), null);
        db.prepare(
          `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source)
           VALUES ('ev-c4-st-pay', 'c4', 'storage_payment_request_sent', 'Storage payment request marked as sent', 'head=storage', ?, ?, 'staff-justin', 'file', 'staff')`,
        ).run(sentAt, sentAt);
        syncOutstandingPaymentChases(["c4"]);
        assert.ok(chaseForClaim("storage_payment", "c4"));
        assert.equal(chaseForClaim("storage_payment", "c4")?.handlerState, "tracking");

        const part = recordHeadPayment({ claimId: "c4", actorId: "staff-justin", head: "storage", amountPence: 3000, correction: false });
        assert.equal(part.paused, true);
        assert.equal(chaseRow("c4", "storage_payment")?.paused, 1);
        assert.equal(money(db, "c4", "hire")!.claimed_pence, hireBefore.claimed_pence);
        assert.equal(money(db, "c4", "hire")!.agreed_pence, hireBefore.agreed_pence);

        const full = recordHeadPayment({ claimId: "c4", actorId: "staff-justin", head: "storage", amountPence: 5000, correction: false });
        assert.equal(full.paidInFull, true);
        const stopped = chaseForClaim("storage_payment", "c4");
        assert.equal(stopped?.due, false);
        assert.equal(stopped?.outcomeOnFile, true);
        const review = db.prepare(`SELECT details FROM claim_events WHERE claim_id = 'c4' AND event_type = 'payment_hire_storage_review'`).get() as { details: string };
        assert.match(review.details, /not been closed/i);
        assert.equal(money(db, "c4", "hire")!.claimed_pence, hireBefore.claimed_pence);
        assert.equal(db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() && c5.storage_billing_end_on, c5.storage_billing_end_on);
        assert.equal(String(c5.storage_billing_end_on || ""), "");

        db.prepare(
          `INSERT INTO correspondence(id, claim_id, direction, channel, subject, body, to_address, from_address, unread, sent_status, template_key, created_at)
           VALUES ('corr-c4-st', 'c4', 'outgoing', 'email', 'Storage payment', 'Please pay the storage charge.', 'insurer@example.test', ?, 0, 'prepared_not_sent', 'storage_payment_chase', ?)`,
        ).run(CAS_CLAIMS_MAILBOX, sentAt);
        await assert.rejects(() => sendPreparedCorrespondence({ claimId: "c4", correspondenceId: "corr-c4-st", actorId: "staff-justin" }), /Bank details missing in Settings/);
        assert.equal(calls, 0);
        assert.equal(BANK_DETAILS_MISSING_SETTINGS, "Bank details missing in Settings");

        const copy = paymentRequestCopy({
          stage: "first",
          fileReference: "TEST-0004",
          theirRef: "",
          head: "storage",
          agreedPence: 0,
          claimedPence: 8000,
          receivedPence: 0,
          outstandingPence: 8000,
          salvageProceedsPence: 0,
          bank: BLANK_PAYMENT_DETAILS,
          paymentTermDays: null,
          asAt: "2026-10-14T12:00:00.000Z",
          hirePackSentOn: null,
          firstChaseOn: null,
          handlerName: "Justin Roberts",
        });
        assert.equal(copy.dueDateUnset, true);
        assert.match(copy.body, /not set/);
        assert.equal(copy.body.includes(PAYMENT_TERM_NOT_SET_LABEL), true);
      });
    } finally {
      setMailboxFetchForTests(null);
      if (savedMode == null) delete process.env[EMAIL_SEND_MODE_ENV];
      else process.env[EMAIL_SEND_MODE_ENV] = savedMode;
      db.close();
    }
  });

  it("makes no Graph call when simulate mode sends a charge chase", async () => {
    const db = seeded();
    const savedMode = process.env[EMAIL_SEND_MODE_ENV];
    process.env[EMAIL_SEND_MODE_ENV] = "simulate";
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabase(db, async () => {
        db.prepare(`UPDATE claims SET storage_billing_end_on = '2026-09-01' WHERE id = 'c4'`).run();
        db.prepare(
          `INSERT INTO financial_lines(id, claim_id, head_of_loss, description, claimed_pence, offered_pence, agreed_pence, received_pence)
           VALUES ('f-c4-st-sim', 'c4', 'storage', 'Storage', 8000, 0, 0, 0)`,
        ).run();
        const sentAt = isoDaysFromNow(-10);
        db.prepare(
          `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source)
           VALUES ('ev-c4-st-sim', 'c4', 'storage_payment_request_sent', 'Storage payment request marked as sent', 'head=storage', ?, ?, 'staff-justin', 'file', 'staff')`,
        ).run(sentAt, sentAt);
        db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('insurer_payment_account_name', 'Test account')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('insurer_payment_sort_code', '00-00-00')`).run();
        db.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('insurer_payment_account_number', '12345678')`).run();
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseForClaim("storage_payment", "c4")?.due, true);
        db.prepare(
          `INSERT INTO correspondence(id, claim_id, direction, channel, subject, body, to_address, from_address, unread, sent_status, template_key, created_at)
           VALUES ('corr-c4-sim', 'c4', 'outgoing', 'email', 'Storage payment', 'Please pay the storage charge.', 'insurer@example.test', ?, 0, 'prepared_not_sent', 'storage_payment_chase', ?)`,
        ).run(CAS_CLAIMS_MAILBOX, sentAt);
        const outcome = await sendPreparedCorrespondence({ claimId: "c4", correspondenceId: "corr-c4-sim", actorId: "staff-justin" });
        assert.equal(outcome.simulated, true);
        assert.equal(calls, 0);
      });
    } finally {
      setMailboxFetchForTests(null);
      if (savedMode == null) delete process.env[EMAIL_SEND_MODE_ENV];
      else process.env[EMAIL_SEND_MODE_ENV] = savedMode;
      db.close();
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  CLAIMED_UNDER_REVIEW_NOTE,
  PAYMENT_DUE_ON_RECEIPT,
  PAYMENT_DUE_ON_RECEIPT_SENTENCE,
  STORAGE_START_MISSING_REVIEW,
} from "../src/lib/constants.ts";
import { formatUkDate } from "../src/lib/dates.ts";
import { offerComparisonText } from "../src/lib/domain/figure-resolution.ts";
import { paymentRequestCopy } from "../src/lib/domain/payment-chase.ts";
import { paymentTermLabel, paymentTermLine } from "../src/lib/domain/payment-term.ts";
import { EMAIL_SEND_MODE_ENV } from "../src/lib/email/send-mode.ts";
import { setMailboxFetchForTests } from "../src/lib/email/microsoft-graph.ts";
import { withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { chaseForClaim, syncOutstandingPaymentChases } from "../src/lib/db/chase.ts";
import { logIncomingEmail } from "../src/lib/db/chronology.ts";
import { storeClaimDocument } from "../src/lib/db/claim-documents.ts";
import { figureFlag } from "../src/lib/db/figure-resolution.ts";
import { ensureRealFleet } from "../src/lib/db/fleet.ts";
import { hireChargeForClaim } from "../src/lib/db/hire-charge.ts";
import { createClaimFromIntake } from "../src/lib/db/intake.ts";
import { paymentTermForClaim, setInsurerPaymentTerm } from "../src/lib/db/insurers.ts";
import { sendPreparedCorrespondence } from "../src/lib/db/mailbox-send.ts";
import { getInsurerPaymentDetails, latestBankDetailsChange, saveInsurerPaymentDetails } from "../src/lib/db/payment-details.ts";
import { saveScreenData, screenSaveFieldError } from "../src/lib/db/screens.ts";
import { confirmStorageAuthorisationEnd } from "../src/lib/db/storage-authorisation-end.ts";
import { storageChargeForClaim } from "../src/lib/db/storage-charge.ts";
import { confirmStorageEndDate, getStorageEndDateReview } from "../src/lib/db/storage-recovery-date.ts";
import { flagStorageStartMissing } from "../src/lib/db/test-charge-figures.ts";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function seeded() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function bankSettings(db: DatabaseSync) {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'insurer_payment_%' ORDER BY key`).all() as Array<{
    key: string;
    value: string;
  }>;
  return rows.map((row) => `${row.key}=${row.value}`).join("|");
}

describe("storage and hire with no start date", () => {
  it("shows no figure, blocks an end, and does not chase when the start or handover is missing", () => {
    const db = seeded();
    const endsBefore = db.prepare(`SELECT id, file_reference, storage_started_on, storage_billing_end_on FROM claims ORDER BY id`).all() as Array<{
      id: string;
      file_reference: string;
      storage_started_on: string | null;
      storage_billing_end_on: string | null;
    }>;
    const c9Offers = db.prepare(`SELECT id, amount_pence, status FROM insurer_offers WHERE claim_id = 'c9' ORDER BY id`).all() as Array<{
      id: string;
      amount_pence: number;
      status: string;
    }>;
    const c6 = db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c6' ORDER BY id`).all() as Array<{
      claimed_pence: number;
      agreed_pence: number;
      received_pence: number;
    }>;
    const c7Hire = db.prepare(`SELECT agreed_pence, received_pence FROM financial_lines WHERE id = 'f-c7-hire'`).get() as {
      agreed_pence: number;
      received_pence: number;
    };
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims LIMIT 1`).get();
      const c11 = db.prepare(`SELECT file_reference, storage_started_on, storage_billing_end_on FROM claims WHERE id = 'c11'`).get() as {
        file_reference: string;
        storage_started_on: string | null;
        storage_billing_end_on: string | null;
      };
      const c11Before = endsBefore.find((row) => row.id === "c11");
      assert.equal(c11.file_reference, "TEST-0011");
      assert.equal(String(c11.storage_started_on || ""), "");
      assert.equal(c11.storage_billing_end_on, c11Before?.storage_billing_end_on);
      assert.ok(String(c11.storage_billing_end_on || ""));
      const charge = storageChargeForClaim("c11");
      assert.ok(charge);
      assert.equal(charge.status, "missing_start");
      const line = db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c11' AND head_of_loss = 'storage'`).get() as
        | { claimed_pence: number; agreed_pence: number; received_pence: number }
        | undefined;
      if (line) {
        assert.equal(line.claimed_pence, 0);
        assert.equal(line.agreed_pence, 0);
        assert.equal(line.received_pence, 0);
      }
      assert.equal(chaseForClaim("storage_payment", "c11"), null);
      const flagged = db
        .prepare(`SELECT title, details FROM claim_events WHERE claim_id = 'c11' AND event_type = 'storage_start_missing_review'`)
        .get() as { title: string; details: string };
      assert.equal(flagged.title, STORAGE_START_MISSING_REVIEW);
      assert.match(flagged.details, /confirmed end was not changed/i);

      const missing = endsBefore.filter((row) => String(row.storage_billing_end_on || "").trim() && !String(row.storage_started_on || "").trim());
      assert.ok(missing.some((row) => row.id === "c11"));
      for (const row of missing) {
        const now = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = ?`).get(row.id) as { storage_billing_end_on: string | null };
        assert.equal(now.storage_billing_end_on, row.storage_billing_end_on);
        const event = db.prepare(`SELECT title FROM claim_events WHERE claim_id = ? AND event_type = 'storage_start_missing_review'`).get(row.id) as {
          title: string;
        };
        assert.equal(event.title, STORAGE_START_MISSING_REVIEW);
      }

      db.prepare(
        `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, status)
         VALUES ('auto-c11-st', 'c11', 'storage_payment_chase', 'storage_payment', '2026-10-01T00:00:00.000Z', 3, 'calendar_days', 0, 'tracking')`,
      ).run();
      const endDuringPause = String(c11.storage_billing_end_on);
      flagStorageStartMissing(db);
      const paused = db.prepare(`SELECT paused, status, reason FROM automations WHERE id = 'auto-c11-st'`).get() as {
        paused: number;
        status: string;
        reason: string;
      };
      assert.equal(paused.paused, 1);
      assert.equal(paused.status, "paused");
      assert.equal(paused.reason, STORAGE_START_MISSING_REVIEW);
      const endAfterPause = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c11'`).get() as { storage_billing_end_on: string };
      assert.equal(endAfterPause.storage_billing_end_on, endDuringPause);
      syncOutstandingPaymentChases(["c11"]);
      const still = db.prepare(`SELECT paused, status FROM automations WHERE id = 'auto-c11-st'`).get() as { paused: number; status: string };
      assert.equal(still.paused, 1);
      assert.equal(still.status, "paused");

      assert.throws(
        () => confirmStorageAuthorisationEnd({ claimId: "c4", actorId: "staff-justin", choice: "suggested" }),
        /Start date missing/,
      );
      assert.throws(() => confirmStorageEndDate({ claimId: "c4", choice: "job", actorId: "staff-justin" }), /Start date missing/);
      db.prepare(`UPDATE claims SET storage_end_review_on = '2026-09-01', storage_billing_end_on = NULL WHERE id = 'c4'`).run();
      assert.equal(getStorageEndDateReview("c4"), null);
      const c4End = db.prepare(`SELECT storage_billing_end_on, storage_started_on FROM claims WHERE id = 'c4'`).get() as {
        storage_billing_end_on: string | null;
        storage_started_on: string | null;
      };
      assert.equal(String(c4End.storage_billing_end_on || ""), "");
      assert.equal(String(c4End.storage_started_on || ""), "");
      const blocked = screenSaveFieldError("c4", "storage", { endDate: "2026-09-14", startDate: "" });
      assert.match(blocked?.message || "", /Start date missing/);

      const hire = hireChargeForClaim("c4");
      assert.equal(hire.charge.status, "not_started");
      const hireEndBefore = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c4'`).get() as { billing_end_at: string | null } | undefined;
      saveScreenData("c4", "delivery-collection", { hireEndDate: "2026-10-01", hireStartDate: "2026-09-01" }, "staff-sian");
      const hireEndAfter = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = 'c4'`).get() as { billing_end_at: string | null } | undefined;
      assert.equal(hireEndAfter?.billing_end_at ?? null, hireEndBefore?.billing_end_at ?? null);
      db.prepare(`UPDATE hire_episodes SET billing_end_at = '2026-10-01T17:00:00.000Z' WHERE claim_id = 'c4'`).run();
      db.prepare(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source)
         VALUES ('ev-c4-hire-nostart', 'c4', 'hire_payment_request_sent', 'Hire payment request marked as sent', 'head=hire', '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z', 'staff-justin', 'file', 'staff')`,
      ).run();
      syncOutstandingPaymentChases(["c4"]);
      assert.equal(chaseForClaim("hire_payment", "c4"), null);

      const c5 = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as { storage_billing_end_on: string | null };
      assert.equal(String(c5.storage_billing_end_on || ""), "");
      const c6After = db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c6' ORDER BY id`).all() as Array<{
        claimed_pence: number;
        agreed_pence: number;
        received_pence: number;
      }>;
      assert.equal(c6After.length, c6.length);
      for (let i = 0; i < c6.length; i += 1) {
        assert.equal(c6After[i].claimed_pence, c6[i].claimed_pence);
        assert.equal(c6After[i].agreed_pence, c6[i].agreed_pence);
        assert.equal(c6After[i].received_pence, c6[i].received_pence);
      }
      const c7After = db.prepare(`SELECT agreed_pence, received_pence FROM financial_lines WHERE id = 'f-c7-hire'`).get() as {
        agreed_pence: number;
        received_pence: number;
      };
      assert.equal(c7After.agreed_pence, c7Hire.agreed_pence);
      assert.equal(c7After.received_pence, c7Hire.received_pence);
      assert.equal(c7After.agreed_pence, 90000);
      const c9After = db.prepare(`SELECT id, amount_pence, status FROM insurer_offers WHERE claim_id = 'c9' ORDER BY id`).all() as Array<{
        id: string;
        amount_pence: number;
        status: string;
      }>;
      assert.equal(c9After.length, c9Offers.length);
      for (let i = 0; i < c9Offers.length; i += 1) {
        assert.equal(c9After[i].id, c9Offers[i].id);
        assert.equal(c9After[i].amount_pence, c9Offers[i].amount_pence);
        assert.equal(c9After[i].status, c9Offers[i].status);
      }
      const c3 = db.prepare(`SELECT claimed_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'storage'`).get() as {
        claimed_pence: number;
      };
      assert.equal(c3.claimed_pence, 23400);
    });
    db.close();
  });
});

describe("offer comparison while a figure is under review", () => {
  it("notes that the comparison may change, and TEST-0008 has no agreed figure while the offer awaits a decision", () => {
    const db = seeded();
    withDatabase(db, () => {
      hireChargeForClaim("c8");
      const hire = db.prepare(`SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'hire'`).get() as {
        claimed_pence: number;
        agreed_pence: number;
        received_pence: number;
      };
      assert.equal(hire.claimed_pence, 189600);
      assert.equal(hire.agreed_pence, 0);
      assert.equal(hire.received_pence, 0);
      const offer = db.prepare(`SELECT amount_pence, offered_on, status FROM insurer_offers WHERE id = 'offer-c8-hire-below'`).get() as {
        amount_pence: number;
        offered_on: string;
        status: string;
      };
      assert.equal(offer.amount_pence, 150000);
      assert.equal(String(offer.offered_on).slice(0, 10), "2026-10-01");
      assert.equal(offer.status, "open");
      const calculated = hireChargeForClaim("c8").charge;
      assert.equal(calculated.status, "calculated");
      const target = calculated.status === "calculated" ? calculated.totalPence : null;
      const flag = figureFlag("c8", "hire", hire.claimed_pence, target);
      assert.equal(flag.differs, true);
      const text = offerComparisonText(offer.amount_pence, hire.claimed_pence, flag.differs);
      assert.match(text, new RegExp(CLAIMED_UNDER_REVIEW_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(offerComparisonText(offer.amount_pence, hire.claimed_pence, false).includes(CLAIMED_UNDER_REVIEW_NOTE), false);
    });
    db.close();
  });
});

describe("insurer payment terms", () => {
  it("prints Due on receipt unless that insurer has its own term, and never says 0 days", () => {
    assert.equal(paymentTermLabel(null), PAYMENT_DUE_ON_RECEIPT);
    assert.equal(paymentTermLine(null), PAYMENT_DUE_ON_RECEIPT_SENTENCE);
    assert.equal(paymentTermLabel("0 days"), PAYMENT_DUE_ON_RECEIPT);
    assert.equal(paymentTermLine("0"), PAYMENT_DUE_ON_RECEIPT_SENTENCE);
    assert.equal(paymentTermLabel("0"), PAYMENT_DUE_ON_RECEIPT);
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims LIMIT 1`).get();
      assert.equal(paymentTermForClaim("c2"), null);
      const plain = paymentRequestCopy({
        stage: "first",
        fileReference: "TEST-0002",
        theirRef: "AV-1",
        head: "hire",
        agreedPence: 0,
        claimedPence: 10000,
        receivedPence: 0,
        outstandingPence: 10000,
        bank: { accountName: "Fictional", sortCode: "00-00-00", accountNumber: "00000000" },
        paymentTerm: paymentTermForClaim("c2"),
        asAt: "2026-10-14T12:00:00.000Z",
        hirePackSentOn: null,
        firstChaseOn: null,
        handlerName: "Justin Roberts",
      });
      assert.match(plain.body, /Payment is due immediately upon receipt of this invoice/);
      assert.doesNotMatch(plain.body, /0 days/i);
      assert.doesNotMatch(plain.body, /not set/i);
      assert.throws(() => setInsurerPaymentTerm("Aviva", "0 days"), /0 days/);
      assert.throws(() => setInsurerPaymentTerm("Aviva", "0"), /0 days/);
      setInsurerPaymentTerm("Aviva", "Payable on their own stated terms");
      assert.equal(paymentTermForClaim("c2"), "Payable on their own stated terms");
      const own = paymentRequestCopy({
        stage: "first",
        fileReference: "TEST-0002",
        theirRef: "AV-1",
        head: "hire",
        agreedPence: 0,
        claimedPence: 10000,
        receivedPence: 0,
        outstandingPence: 10000,
        bank: { accountName: "Fictional", sortCode: "00-00-00", accountNumber: "00000000" },
        paymentTerm: paymentTermForClaim("c2"),
        asAt: "2026-10-14T12:00:00.000Z",
        hirePackSentOn: null,
        firstChaseOn: null,
        handlerName: "Justin Roberts",
      });
      assert.match(own.body, /Payable on their own stated terms/);
      assert.doesNotMatch(own.body, /Payment is due immediately upon receipt of this invoice/);
      assert.equal(paymentTermLabel(paymentTermForClaim("c3")), PAYMENT_DUE_ON_RECEIPT);
    });
    db.close();
  });
});

describe("bank detail protection", () => {
  it("refuses anyone except Justin, audits a masked change, checks the format, and refreshes a queued chaser", async () => {
    const db = seeded();
    const savedMode = process.env[EMAIL_SEND_MODE_ENV];
    process.env[EMAIL_SEND_MODE_ENV] = "simulate";
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        db.prepare(`SELECT id FROM claims LIMIT 1`).get();
        const holders = db.prepare(`SELECT staff_id FROM staff_permissions WHERE permission = 'manageBankDetails'`).all() as Array<{
          staff_id: string;
        }>;
        assert.deepEqual(
          holders.map((row) => row.staff_id),
          ["staff-justin"],
        );
        assert.throws(
          () => saveInsurerPaymentDetails({ accountName: "Fictional", sortCode: "000000", accountNumber: "00000000" }, { staffId: "staff-sian", role: "staff" }),
          /cannot change the bank details/,
        );
        db.prepare(`INSERT INTO staff(id, name, email, username, password_hash, role, active) VALUES ('staff-other-admin', 'Alex Morgan', 'alex@example.test', 'alex.morgan', 'not-a-real-hash', 'administrator', 1)`).run();
        assert.throws(
          () =>
            saveInsurerPaymentDetails(
              { accountName: "Fictional", sortCode: "000000", accountNumber: "00000000" },
              { staffId: "staff-other-admin", role: "administrator" },
            ),
          /cannot change the bank details/,
        );
        db.prepare(`INSERT INTO staff(id, name, email, username, password_hash, role, active) VALUES ('staff-name-justin', 'Justin Roberts', 'not-justin@example.test', 'not.justin', 'not-a-real-hash', 'administrator', 1)`).run();
        assert.throws(
          () =>
            saveInsurerPaymentDetails(
              { accountName: "Fictional", sortCode: "112233", accountNumber: "12345678" },
              { staffId: "staff-name-justin", role: "administrator" },
            ),
          /cannot change the bank details/,
        );
        assert.throws(
          () => saveInsurerPaymentDetails({ accountName: "Fictional", sortCode: "12345", accountNumber: "12345678" }, { staffId: "staff-justin", role: "administrator" }),
          /6-digit sort code/,
        );
        assert.throws(
          () => saveInsurerPaymentDetails({ accountName: "Fictional", sortCode: "112233", accountNumber: "1234567" }, { staffId: "staff-justin", role: "administrator" }),
          /8-digit account number/,
        );
        saveInsurerPaymentDetails(
          { accountName: "Fictional CAS account", sortCode: "000000", accountNumber: "00000000" },
          { staffId: "staff-justin", role: "administrator" },
        );
        saveInsurerPaymentDetails(
          { accountName: "Fictional CAS account", sortCode: "112233", accountNumber: "12345678" },
          { staffId: "staff-justin", role: "administrator" },
        );
        const audit = db.prepare(`SELECT actor_id, action, details FROM audit_log WHERE action = 'bank_details_changed' ORDER BY rowid DESC LIMIT 1`).get() as {
          actor_id: string;
          action: string;
          details: string;
        };
        assert.equal(audit.actor_id, "staff-justin");
        assert.equal(audit.action, "bank_details_changed");
        assert.match(audit.details, /2233/);
        assert.match(audit.details, /5678/);
        assert.equal(audit.details.includes("112233"), false);
        assert.equal(audit.details.includes("12345678"), false);
        assert.equal(audit.details.includes("11-22-33"), false);
        const notice = latestBankDetailsChange();
        assert.ok(notice);
        assert.equal(notice.actorName, "Justin Roberts");
        assert.match(`Bank details changed on ${formatUkDate(notice.at)} by ${notice.actorName}`, /Bank details changed on \d{2}\/\d{2}\/\d{4} by Justin Roberts/);

        db.prepare(`UPDATE claims SET storage_started_on = '2026-08-01', storage_billing_end_on = '2026-08-10' WHERE id = 'c4'`).run();
        db.prepare(
          `INSERT INTO financial_lines(id, claim_id, head_of_loss, description, claimed_pence, offered_pence, agreed_pence, received_pence)
           VALUES ('f-c4-bank', 'c4', 'storage', 'Storage', 8000, 0, 0, 0)`,
        ).run();
        db.prepare(
          `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source)
           VALUES ('ev-c4-bank', 'c4', 'storage_payment_request_sent', 'Storage payment request marked as sent', 'head=storage', '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z', 'staff-justin', 'file', 'staff')`,
        ).run();
        syncOutstandingPaymentChases(["c4"]);
        assert.equal(chaseForClaim("storage_payment", "c4")?.due, true);
        db.prepare(
          `INSERT INTO correspondence(id, claim_id, direction, channel, subject, body, to_address, from_address, unread, sent_status, template_key, created_at)
           VALUES ('corr-c4-bank', 'c4', 'outgoing', 'email', 'Storage payment', ?, 'insurer@example.test', ?, 0, 'prepared_not_sent', 'storage_payment_chase', '2026-09-01T12:00:00.000Z')`,
        ).run("Please pay the storage charge.\nPlease send payment to Old name, sort code 00-00-00, account number 00000000.", CAS_CLAIMS_MAILBOX);
        const outcome = await sendPreparedCorrespondence({ claimId: "c4", correspondenceId: "corr-c4-bank", actorId: "staff-justin" });
        assert.equal(outcome.simulated, true);
        assert.equal(calls, 0);
        const sent = db.prepare(`SELECT body FROM correspondence WHERE id = 'corr-c4-bank'`).get() as { body: string };
        assert.match(sent.body, /11-22-33/);
        assert.match(sent.body, /12345678/);
        assert.equal(sent.body.includes("00000000"), false);
        assert.equal(sent.body.includes("Old name"), false);

        const beforePaths = bankSettings(db);
        logIncomingEmail({
          claimId: "c4",
          actorId: "staff-justin",
          from: "insurer@example.test",
          subject: "Our account",
          body: "Please change the account to sort code 112233 and account 12345678.",
        });
        storeClaimDocument({
          claimId: "c4",
          actorId: "staff-justin",
          actorRole: "administrator",
          documentType: "other",
          file: {
            buffer: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              "base64",
            ),
            filename: "note.png",
            mimeType: "image/png",
          },
        });
        await createClaimFromIntake({
          handlerId: "staff-sian",
          clientRole: "owner_driver",
          client: { forename: "Nia", surname: "Edwards", dob: "1990-01-02" },
          vehicle: {},
          thirdParties: [],
          accidentDate: "2026-09-01",
          circumstances: "Client asked for sort code 112233 account 12345678 to be saved.",
        });
        ensureRealFleet(db);
        assert.equal(bankSettings(db), beforePaths);
        const details = getInsurerPaymentDetails();
        assert.equal(details.sortCode, "11-22-33");
        assert.equal(details.accountNumber, "12345678");
      });
    } finally {
      setMailboxFetchForTests(null);
      if (savedMode == null) delete process.env[EMAIL_SEND_MODE_ENV];
      else process.env[EMAIL_SEND_MODE_ENV] = savedMode;
      db.close();
    }
  });
});

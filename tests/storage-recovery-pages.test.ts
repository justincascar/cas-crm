import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { letterPreview } from "../src/lib/db/chronology.ts";
import { withDatabase, get, run } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordAgreedHeadFigure, recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { confirmStorageAuthorisationEnd, storageAuthorisationEndForClaim } from "../src/lib/db/storage-authorisation-end.ts";
import {
  effectiveStorageRatePence,
  officeFinancialError,
  setClaimStorageRate,
  setStorageDailyRatePence,
  syncRecoveryClaimed,
  syncStorageClaimed,
} from "../src/lib/db/storage-charge.ts";
import { DEFAULT_VEHICLE_LOCATION } from "../src/lib/constants.ts";
import { headScreenPath } from "../src/lib/domain/head-screen.ts";
import {
  inclusiveStorageDays,
  paymentComparisonLabel,
  prefillBlankStorageLocation,
  recoveryClaimDecision,
  storageCharge,
  storageLocationFromSetting,
} from "../src/lib/domain/storage-charge.ts";
import { PAYMENT_CHASE_HEADS, STORAGE_PAYMENT_REQUEST_BLOCK, isPaymentChaseHead } from "../src/lib/domain/payment-chase.ts";
import { summariseLossesClaimed } from "../src/lib/documents/correspondence.ts";
import { FieldValidationError } from "../src/lib/form-validation.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

describe("storage and recovery pages", () => {
  it("counts both the first and the last day, and prices net, VAT and the total in pence", () => {
    assert.equal(inclusiveStorageDays("2026-09-22", "2026-09-22"), 1);
    assert.equal(inclusiveStorageDays("2026-09-22", "2026-10-14"), 23);
    const one = storageCharge({
      startDay: "2026-09-22",
      confirmedEndDay: "2026-09-22",
      today: "2026-10-14",
      ratePence: 3900,
    });
    assert.equal(one.status, "calculated");
    if (one.status !== "calculated") return;
    assert.equal(one.days, 1);
    assert.equal(one.provisional, false);
    assert.equal(one.netPence, 3900);
    assert.equal(one.vatPence, 780);
    assert.equal(one.totalPence, 4680);

    const span = storageCharge({
      startDay: "2026-09-22",
      confirmedEndDay: "2026-10-14",
      today: "2026-12-01",
      ratePence: 3900,
    });
    assert.equal(span.status, "calculated");
    if (span.status !== "calculated") return;
    assert.equal(span.days, 23);
    assert.equal(span.netPence, 89700);
    assert.equal(span.vatPence, 17940);
    assert.equal(span.totalPence, 107640);
  });

  it("counts a proposed end to that date, counts to today only when there is no end, and treats a confirmed end as final", () => {
    const proposed = storageCharge({
      startDay: "2026-09-22",
      confirmedEndDay: null,
      proposedEndDay: "2026-10-01",
      today: "2026-10-14",
      ratePence: 3900,
    });
    assert.equal(proposed.status, "calculated");
    if (proposed.status === "calculated") {
      assert.equal(proposed.provisional, true);
      assert.equal(proposed.basis, "proposed");
      assert.equal(proposed.countedTo, "2026-10-01");
      assert.equal(proposed.days, 10);
      assert.equal(proposed.netPence, 39000);
      assert.equal(proposed.vatPence, 7800);
      assert.equal(proposed.totalPence, 46800);
      assert.equal(proposed.label, "Provisional, to proposed end 01/10/2026, awaiting confirmation");
    }
    const open = storageCharge({
      startDay: "2026-09-22",
      confirmedEndDay: null,
      today: "2026-10-14",
      ratePence: 3900,
    });
    assert.equal(open.status, "calculated");
    if (open.status === "calculated") {
      assert.equal(open.basis, "today");
      assert.equal(open.countedTo, "2026-10-14");
      assert.equal(open.days, 23);
      assert.equal(open.label, "Provisional to today");
    }
    const finalCharge = storageCharge({
      startDay: "2026-09-22",
      confirmedEndDay: "2026-10-01",
      proposedEndDay: "2026-10-14",
      today: "2026-12-01",
      ratePence: 3900,
    });
    assert.equal(finalCharge.status, "calculated");
    if (finalCharge.status === "calculated") {
      assert.equal(finalCharge.provisional, false);
      assert.equal(finalCharge.basis, "confirmed");
      assert.equal(finalCharge.label, null);
      assert.equal(finalCharge.countedTo, "2026-10-01");
      assert.equal(finalCharge.days, 10);
    }
  });

  it("shows no figure without a start date, and refuses a storage end", () => {
    const missing = storageCharge({
      startDay: null,
      confirmedEndDay: "2026-10-01",
      today: "2026-10-14",
      ratePence: 3900,
    });
    assert.equal(missing.status, "missing_start");
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE claims SET storage_started_on = NULL, storage_billing_end_on = NULL WHERE id = 'c1'`);
      assert.equal(syncStorageClaimed("c1")?.status, "missing_start");
      assert.throws(
        () => confirmStorageAuthorisationEnd({ claimId: "c1", actorId: "staff-sian", choice: "suggested" }),
        /Start date missing/,
      );
      assert.throws(
        () => saveScreenData("c1", "storage", { endDate: "2026-10-01" }, "staff-sian"),
        (error: unknown) => error instanceof FieldValidationError && /Start date missing/.test(error.message),
      );
      const end = get<{ storage_billing_end_on: string | null }>(
        `SELECT storage_billing_end_on FROM claims WHERE id = 'c1'`,
      );
      assert.equal(end?.storage_billing_end_on, null);
    });
    db.close();
  });

  it("keeps a rate already stored on a claim when the default setting changes", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE claims SET storage_rate_pence = 4100 WHERE id = 'c2'`);
      run(`UPDATE claims SET storage_rate_pence = NULL WHERE id = 'c4'`);
      setStorageDailyRatePence(5000);
      assert.equal(effectiveStorageRatePence(4100).pence, 4100);
      assert.equal(effectiveStorageRatePence(null).pence, 5000);
      const stored = get<{ storage_rate_pence: number | null }>(`SELECT storage_rate_pence FROM claims WHERE id = 'c2'`);
      assert.equal(stored?.storage_rate_pence, 4100);
    });
    db.close();
  });

  it("requires a reason to change the rate on a claim, and does not change payments or dates", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(
        `UPDATE claims SET storage_started_on = '2026-09-01', storage_billing_end_on = '2026-09-03', storage_rate_pence = 3900 WHERE id = 'c4'`,
      );
      syncStorageClaimed("c4", "2026-10-14");
      recordHeadPayment({
        submitKey: "storage-recovery-pages-recordHeadPayment-1", claimId: "c4", actorId: "staff-justin", head: "storage", amountPence: 1000, correction: false });
      assert.throws(() => setClaimStorageRate({ claimId: "c4", actorId: "staff-justin", ratePence: 4500, reason: "  " }), /reason/);
      const before = get<{ storage_started_on: string; storage_billing_end_on: string; received_pence: number }>(
        `SELECT c.storage_started_on, c.storage_billing_end_on, f.received_pence
         FROM claims c JOIN financial_lines f ON f.claim_id = c.id AND f.head_of_loss = 'storage'
         WHERE c.id = 'c4'`,
      );
      setClaimStorageRate({ claimId: "c4", actorId: "staff-justin", ratePence: 4500, reason: "Insurer agreed a different daily rate." });
      const after = get<{
        storage_started_on: string;
        storage_billing_end_on: string;
        storage_rate_pence: number;
        received_pence: number;
        claimed_pence: number;
        agreed_pence: number;
      }>(
        `SELECT c.storage_started_on, c.storage_billing_end_on, c.storage_rate_pence, f.received_pence, f.claimed_pence, f.agreed_pence
         FROM claims c JOIN financial_lines f ON f.claim_id = c.id AND f.head_of_loss = 'storage'
         WHERE c.id = 'c4'`,
      );
      assert.equal(after?.storage_rate_pence, 4500);
      assert.equal(after?.storage_started_on, before?.storage_started_on);
      assert.equal(after?.storage_billing_end_on, before?.storage_billing_end_on);
      assert.equal(after?.received_pence, 1000);
      assert.equal(after?.agreed_pence, 0);
      assert.equal(after?.claimed_pence, 16200);
    });
    db.close();
  });

  it("uses the recovery screen total, including VAT, and does not add a second standard charge", () => {
    const decision = recoveryClaimDecision({
      screen: { standardCharge: "39500" },
      jobNetPence: 39500,
      existingClaimedPence: 0,
    });
    assert.equal(decision.source, "screen");
    assert.equal(decision.netPence, 39500);
    assert.equal(decision.vatPence, 7900);
    assert.equal(decision.totalPence, 47400);
    assert.notEqual(decision.totalPence, 39500 + 47400);
    const kept = recoveryClaimDecision({ screen: {}, jobNetPence: 0, existingClaimedPence: 39500 });
    assert.equal(kept.write, false);
    assert.equal(kept.source, "kept");
    const db = prepared();
    withDatabase(db, () => {
      const synced = syncRecoveryClaimed("c5");
      assert.equal(synced.source, "screen");
      assert.equal(synced.totalPence, 47400);
      const line = get<{ claimed_pence: number; received_pence: number }>(
        `SELECT claimed_pence, received_pence FROM financial_lines WHERE claim_id = 'c5' AND head_of_loss = 'recovery'`,
      );
      assert.equal(line?.claimed_pence, 47400);
      assert.equal(line?.received_pence, 0);
    });
    db.close();
  });

  it("labels a payment against the agreed figure, otherwise the claimed figure, otherwise neither", () => {
    assert.equal(
      paymentComparisonLabel({ receivedPence: 1000, agreedPence: 5000, claimedPence: 9000 }),
      "£10.00 received against £50.00 agreed",
    );
    assert.equal(
      paymentComparisonLabel({ receivedPence: 0, agreedPence: 0, claimedPence: 47400 }),
      "£0.00 received against £474.00 claimed",
    );
    assert.equal(paymentComparisonLabel({ receivedPence: 0, agreedPence: 0, claimedPence: 0 }), "No figure to compare against yet");
  });

  it("fills a blank storage location from the CAS default and leaves a saved location alone", () => {
    const defaults = storageLocationFromSetting(DEFAULT_VEHICLE_LOCATION);
    assert.equal(defaults.name, "Complete Accident Solutions Ltd");
    assert.equal(defaults.postcode, "SA18 1DG");
    assert.match(defaults.address, /171 Cwmgarw Road/);
    const filled = prefillBlankStorageLocation({}, defaults);
    assert.equal(filled.name, defaults.name);
    assert.equal(filled.telMain, defaults.telMain);
    const kept = prefillBlankStorageLocation({ name: "Other yard", address: "1 High Street" }, defaults);
    assert.equal(kept.name, "Other yard");
    assert.equal(kept.address, "1 High Street");
    assert.equal(kept.postcode, defaults.postcode);
  });

  it("sends recovery and storage to their own pages, and redirects the old combined address", () => {
    assert.equal(headScreenPath("c5", "recovery"), "/claims/c5/heads/recovery");
    assert.equal(headScreenPath("c5", "storage"), "/claims/c5/heads/storage");
    const oldPage = fs.readFileSync(
      path.join(process.cwd(), "src/app/claims/[id]/heads/recovery-storage/page.tsx"),
      "utf8",
    );
    assert.match(oldPage, /redirect\(headScreenPath/);
    assert.match(oldPage, /query\.head === "recovery" \? "recovery" : "storage"/);
    const work = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/work/[screen]/page.tsx"), "utf8");
    assert.match(work, /screen === "storage" \|\| screen === "recovery"/);
    assert.match(work, /redirect\(headScreenPath/);
  });

  it("refuses driver and mechanic the money on the server, and money saves do not change dates", () => {
    assert.match(officeFinancialError("driver") || "", /cannot open the money/);
    assert.match(officeFinancialError("mechanic") || "", /cannot open the money/);
    assert.equal(officeFinancialError("staff"), null);
    assert.equal(officeFinancialError("administrator"), null);
    const rateRoute = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/storage-rate/route.ts"), "utf8");
    const detailsRoute = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/storage-details/route.ts"), "utf8");
    assert.match(rateRoute, /isOfficeRole/);
    assert.match(detailsRoute, /isOfficeRole/);
    assert.match(rateRoute, /\/jobs/);
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE claims SET storage_started_on = '2026-09-22', storage_billing_end_on = '2026-10-01' WHERE id = 'c4'`);
      syncStorageClaimed("c4", "2026-10-14");
      recordAgreedHeadFigure({
        submitKey: "storage-recovery-pages-recordAgreedHeadFigure-2", claimId: "c4", actorId: "staff-justin", head: "storage", agreedPence: 5000 });
      recordHeadPayment({
        submitKey: "storage-recovery-pages-recordHeadPayment-3", claimId: "c4", actorId: "staff-justin", head: "storage", amountPence: 2000, correction: false });
      const after = get<{ storage_started_on: string; storage_billing_end_on: string; received_pence: number; agreed_pence: number }>(
        `SELECT c.storage_started_on, c.storage_billing_end_on, f.received_pence, f.agreed_pence
         FROM claims c JOIN financial_lines f ON f.claim_id = c.id AND f.head_of_loss = 'storage'
         WHERE c.id = 'c4'`,
      );
      assert.equal(after?.storage_started_on, "2026-09-22");
      assert.equal(after?.storage_billing_end_on, "2026-10-01");
      assert.equal(after?.agreed_pence, 5000);
      assert.equal(after?.received_pence, 2000);
    });
    db.close();
  });

  it("keeps TEST-0005's proposed storage end unconfirmed and gives it a start and a recovery", () => {
    const db = prepared();
    withDatabase(db, () => {
      const claim = get<{ storage_started_on: string | null; storage_billing_end_on: string | null }>(
        `SELECT storage_started_on, storage_billing_end_on FROM claims WHERE id = 'c5'`,
      );
      assert.equal(claim?.storage_started_on, "2026-09-22");
      assert.equal(claim?.storage_billing_end_on, null);
      const proposal = storageAuthorisationEndForClaim("c5");
      assert.equal(proposal.kind, "suggest");
      if (proposal.kind === "suggest") assert.equal(proposal.date, "2026-10-01");
      const charge = syncStorageClaimed("c5", "2026-10-14");
      assert.equal(charge?.status, "calculated");
      if (charge?.status === "calculated") {
        assert.equal(charge.days, 10);
        assert.equal(charge.netPence, 39000);
        assert.equal(charge.vatPence, 7800);
        assert.equal(charge.totalPence, 46800);
        assert.equal(charge.label, "Provisional, to proposed end 01/10/2026, awaiting confirmation");
      }
      assert.equal(
        get<{ storage_billing_end_on: string | null }>(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`)
          ?.storage_billing_end_on,
        null,
      );
      const stored = get<{ description: string; claimed_pence: number }>(
        `SELECT description, claimed_pence FROM financial_lines WHERE claim_id = 'c5' AND head_of_loss = 'storage'`,
      );
      assert.equal(stored?.claimed_pence, 46800);
      assert.match(String(stored?.description), /provisional, to proposed end 01\/10\/2026, awaiting confirmation/);
      syncRecoveryClaimed("c5");
      const cessation = letterPreview("c5", "total_loss_cessation");
      const pack = letterPreview("c5", "hire_pack_cover");
      assert.equal(cessation.text.includes("£468.00"), false);
      assert.equal(pack.text.includes("£468.00"), false);
      assert.match(cessation.text, /£474\.00/);
      assert.equal(isPaymentChaseHead("storage"), false);
      assert.equal(PAYMENT_CHASE_HEADS.includes("storage" as never), false);
      assert.match(STORAGE_PAYMENT_REQUEST_BLOCK, /not chased/);
      assert.match(
        summariseLossesClaimed([{ head_of_loss: "storage", claimed_pence: 46800 }], false, { storageProvisional: true }),
        /provisional/,
      );
      const job = get<{ location: string; recovered_at: string }>(
        `SELECT location, recovered_at FROM recovery_jobs WHERE claim_id = 'c5'`,
      );
      assert.equal(job?.location, "Caerleon Road, Newport");
      assert.equal(String(job?.recovered_at).slice(0, 10), "2026-09-22");
      const three = get<{ storage_billing_end_on: string | null }>(
        `SELECT storage_billing_end_on FROM claims WHERE id = 'c3'`,
      );
      assert.equal(three?.storage_billing_end_on, null);
    });
    db.close();
  });
});

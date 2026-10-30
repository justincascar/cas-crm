import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { listCardFees, netOfPayment, noteKeptRecoveryCardFees, quoteCardFee } from "../src/lib/db/card-fees.ts";
import { get, run, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { produceDraftInvoice } from "../src/lib/db/draft-invoice.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  canOverrideUnsignedStorageRecovery,
  guardStorageRecoveryClaim,
  recordStorageRecoveryOverride,
  storageRecoveryState,
} from "../src/lib/db/storage-recovery-signing.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { justificationEventTypes } from "../src/lib/domain/justification-chronology.ts";
import { GTA_STATEMENT_APPROVED, withGtaStatement } from "../src/lib/documents/gta-statement.ts";
import { DRAFT_WORDING_NOT_APPROVED } from "../src/lib/documents/template-approval.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r19-"));
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

async function recoveredClaim() {
  const form = new FormData();
  form.set("client_forename", "Ffion");
  form.set("client_surname", "Cardpay");
  form.set("client_mobile", "07700900876");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-5));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  form.set("veh_registration", "CP21 CRD");
  const claim = await createClaimFromIntake(intakeFromFormData(form));
  const recovery = new FormData();
  recovery.set("arrivedDate", isoDateFromNow(-4));
  recovery.set("arrivedTime", "11:00");
  recovery.set("recoveryLocation", "A48, Bridgend");
  recovery.set("carCondition", "Rear crushed.");
  recovery.set("notDriveable", "unsafe");
  recovery.set("recoveryTick_standard", "yes");
  recovery.set("recoveryAmount_standard", "395");
  recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recovery });
  return claim;
}

describe("Review notes R19–R21", () => {
  it("R19: the card fee is the Settings percentage of the net amount being paid, plus VAT, on any head", () => {
    assert.equal(netOfPayment("recovery", 47400), 39500);
    assert.equal(netOfPayment("vehicle_damage", 500000), 500000, "a total-loss settlement carries no VAT");
    const quote = quoteCardFee("recovery", 47400, 4.5);
    assert.equal(quote.basisNetPence, 39500);
    assert.equal(quote.netPence, 1778);
    assert.equal(quote.vatPence, 356);
    assert.equal(quote.grossPence, 2134);
    assert.equal(quoteCardFee("hire", 12000, 4.5).basisNetPence, 10000);
  });

  it("R19: Paying by card records a separate card fee with the payment; the charge and received are not changed by it", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveredClaim();
      const before = loadHeadSection(claim.id, "recovery");
      recordHeadPayment({ claimId: claim.id, actorId: "staff-sian", head: "recovery", amountPence: 47400, correction: false, submitKey: "card-1", payingByCard: true });
      const fees = listCardFees(claim.id, "recovery");
      assert.equal(fees.length, 1);
      assert.equal(fees[0].netPence, 1778);
      assert.equal(fees[0].grossPence, 2134);
      const after = loadHeadSection(claim.id, "recovery");
      assert.equal(after.claimedPence, before.claimedPence, "the card fee is not added to the recovery charge");
      assert.equal(after.receivedPence, 47400, "received is the payment only");
      assert.deepEqual(after.cardFees, { netPence: 1778, vatPence: 356, grossPence: 2134, count: 1 });
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'card_fee_recorded'`, [claim.id]);
      assert.match(String(event?.details), /Kept separate from the Recovery charge/);

      const invoice = produceDraftInvoice({ claimId: claim.id, head: "recovery", actorId: "staff-sian" });
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [invoice.documentId])?.body_html);
      assert.match(html, /Card fee on the card payment of £474\.00/);
      assert.match(html, /Balance: £0\.00/, "the card fee already paid by card is shown as received");

      const other = await recoveredClaim();
      recordHeadPayment({ claimId: other.id, actorId: "staff-sian", head: "recovery", amountPence: 47400, correction: false, submitKey: "card-2" });
      assert.equal(listCardFees(other.id).length, 0, "no card fee unless Paying by card is ticked");
    });
    db.close();
    assert.match(read("src/components/claims/PaymentReviewPanel.tsx"), /name="payingByCard"/);
  });

  it("R19: a draft invoice prepared for a card payment adds a separate card-fee line on the net amount due", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveredClaim();
      const plain = produceDraftInvoice({ claimId: claim.id, head: "recovery", actorId: "staff-sian" });
      const plainHtml = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [plain.documentId])?.body_html);
      assert.doesNotMatch(plainHtml, /Card fee/);
      const card = produceDraftInvoice({ claimId: claim.id, head: "recovery", actorId: "staff-sian", payingByCard: true });
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [card.documentId])?.body_html);
      assert.match(html, /Card fee, paying by card \(4\.5% of £395\.00 net\)/);
      assert.match(html, /<td>£17\.78<\/td><td>£3\.56<\/td><td>£21\.34<\/td>/);
      assert.match(html, /Balance: £495\.34/);
    });
    db.close();
  });

  it("R19: the tick is gone from the recovery forms, and a card fee saved under it is kept with a history note", async () => {
    assert.doesNotMatch(read("src/components/claims/RecoveryFeeFields.tsx"), /recoveryTick_cardFee/);
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveredClaim();
      const saved = JSON.stringify([
        { key: "standard", label: "Standard recovery", netPence: 39500, vatPence: 7900, grossPence: 47400, reason: "" },
        { key: "cardFee", label: "Card fee (4.5%)", netPence: 1778, vatPence: 356, grossPence: 2134, reason: "" },
      ]);
      run(`UPDATE recovery_jobs SET charge_lines_json = ? WHERE claim_id = ?`, [saved, claim.id]);
      noteKeptRecoveryCardFees(db);
      noteKeptRecoveryCardFees(db);
      const notes = db.prepare(`SELECT details FROM claim_events WHERE claim_id = ? AND details LIKE '%old tick%'`).all(claim.id) as Array<{ details: string }>;
      assert.equal(notes.length, 1, "noted once");
      assert.match(notes[0].details, /is kept as it was/);

      const again = new FormData();
      again.set("arrivedDate", isoDateFromNow(-4));
      again.set("arrivedTime", "11:00");
      again.set("recoveryLocation", "A48, Bridgend");
      again.set("carCondition", "Rear crushed.");
      again.set("notDriveable", "unsafe");
      again.set("recoveryTick_standard", "yes");
      again.set("recoveryAmount_standard", "395");
      recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: again });
      const lines = JSON.parse(String(get<{ charge_lines_json: string }>(`SELECT charge_lines_json FROM recovery_jobs WHERE claim_id = ?`, [claim.id])?.charge_lines_json));
      assert.ok(lines.some((line: { key: string }) => line.key === "cardFee"), "saving the recovery again keeps the saved card fee");
    });
    db.close();
  });

  it("R20: the GTA paragraph wording is approved and carries no draft mark", () => {
    assert.equal(GTA_STATEMENT_APPROVED, true);
    assert.ok(!withGtaStatement("Dear Sirs,\n\nYours faithfully,").includes(DRAFT_WORDING_NOT_APPROVED));
  });

  it("R21: only Justin can override a missing Storage & Recovery Agreement, with a reason kept in the history and chronology", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveredClaim();
      assert.equal(canOverrideUnsignedStorageRecovery("staff-justin"), true);
      assert.equal(canOverrideUnsignedStorageRecovery("staff-sian"), false);
      assert.throws(() => guardStorageRecoveryClaim(claim.id, "storage_payment_request_sent"), /Only Justin can authorise an override/);
      assert.throws(
        () => recordStorageRecoveryOverride({ claimId: claim.id, actorId: "staff-sian", reason: "Client abroad, cannot sign yet." }),
        /Only Justin can authorise/,
      );
      assert.throws(() => recordStorageRecoveryOverride({ claimId: claim.id, actorId: "staff-justin", reason: " " }), /Write the reason/);
      recordStorageRecoveryOverride({ claimId: claim.id, actorId: "staff-justin", reason: "Client abroad, cannot sign yet." });
      const state = storageRecoveryState(claim.id);
      assert.equal(state.status, "override");
      if (state.status === "override") assert.equal(state.reason, "Client abroad, cannot sign yet.");
      guardStorageRecoveryClaim(claim.id, "storage_payment_request_sent");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'storage_recovery_agreement_override'`, [claim.id]);
      assert.match(String(event?.details), /Reason: Client abroad, cannot sign yet\./);
      assert.ok(justificationEventTypes().includes("storage_recovery_agreement_override"), "shown in the chronology");
      assert.throws(() => recordStorageRecoveryOverride({ claimId: claim.id, actorId: "staff-justin", reason: "Again" }), /No override is needed/);

      const invoice = produceDraftInvoice({ claimId: claim.id, head: "customer", actorId: "staff-sian" });
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [invoice.documentId])?.body_html);
      assert.doesNotMatch(html, /<p data-sr-reference>/, "the override reason is not printed for the customer");
      assert.match(html, /class="internal-note"[^]*authorised override/);
    });
    db.close();
  });
});

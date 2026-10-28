import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { STORAGE_INCLUSIVE_DAY_NOTE } from "../src/lib/domain/storage-charge.ts";
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

async function newRecoveryClaim(withDate = false) {
  const form = new FormData();
  form.set("client_forename", "Rhys");
  form.set("client_surname", "Recovery");
  form.set("client_mobile", "07700900123");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-2));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  form.set("recoveryFormVersion", "fees");
  form.set("recoveryLocation", "A470, Pontypridd");
  form.set("recoveryTick_standard", "yes");
  form.set("recoveryAmount_standard", "395");
  if (withDate) {
    form.set("recoveryDate", isoDateFromNow(-2));
    form.set("recoveryTime", "10:00");
  }
  return createClaimFromIntake(intakeFromFormData(form));
}

function recordForm(fields: Record<string, string>) {
  const form = new FormData();
  form.set("arrivedDate", isoDateFromNow(-1));
  form.set("arrivedTime", "11:15");
  form.set("recoveryLocation", "A470, Pontypridd");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

function recoveryLine(claimId: string) {
  return get<{ net_pence: number; vat_pence: number; gross_pence: number; claimed_pence: number }>(
    `SELECT net_pence, vat_pence, gross_pence, claimed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'recovery'`,
    [claimId],
  );
}

describe("recording the recovery (step 2)", () => {
  it("puts nothing on the file at intake until the recovery date and time are recorded", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await newRecoveryClaim(false);
      assert.equal(recoveryLine(created.id), undefined);
      assert.equal(loadClaimSteps(created.id)?.find((step) => step.key === "recovery")?.state, "to_do");
      const withDate = await newRecoveryClaim(true);
      assert.equal(recoveryLine(withDate.id)?.claimed_pence, 47400);
    });
    db.close();
  });

  it("charges the confirmed standard fee plus VAT, starts storage on arrival at the yard, and marks step 2 done", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await newRecoveryClaim(false);
      recordRecoveryDone({
        claimId: created.id,
        actorId: "staff-sian",
        form: recordForm({ recoveryTick_standard: "yes", recoveryAmount_standard: "395" }),
      });
      const line = recoveryLine(created.id);
      assert.equal(line?.net_pence, 39500);
      assert.equal(line?.vat_pence, 7900);
      assert.equal(line?.claimed_pence, 47400);
      const claim = get<{ storage_started_on: string; storage_status: string; recovery_status: string }>(
        `SELECT storage_started_on, storage_status, recovery_status FROM claims WHERE id = ?`,
        [created.id],
      );
      assert.equal(claim?.storage_started_on, isoDateFromNow(-1));
      assert.equal(claim?.storage_status, "active");
      assert.equal(claim?.recovery_status, "completed");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'recovery_completed'`, [created.id]);
      assert.match(String(event?.details), /arrived at the yard/);
      assert.match(String(event?.details), /Standard recovery £395\.00/);
      assert.equal(loadClaimSteps(created.id)?.find((step) => step.key === "recovery")?.state, "done");
    });
    db.close();
  });

  it("adds ticked extras at their default fees, and asks for a reason when a fee is changed or typed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await newRecoveryClaim(false);
      const base = { recoveryTick_standard: "yes", recoveryAmount_standard: "395" };
      assert.throws(
        () => recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ ...base, recoveryTick_forklift: "yes", recoveryAmount_forklift: "100" }) }),
        (error: unknown) => error instanceof FieldValidationError && error.field === "recoveryReason_forklift",
      );
      assert.throws(
        () => recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ ...base, recoveryTick_waiting: "yes", recoveryAmount_waiting: "" }) }),
        (error: unknown) => error instanceof FieldValidationError && error.field === "recoveryAmount_waiting",
      );
      assert.throws(
        () => recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ ...base, recoveryTick_manual: "yes", recoveryAmount_manual: "20" }) }),
        (error: unknown) => error instanceof FieldValidationError && error.field === "recoveryManualDescription",
      );
      recordRecoveryDone({
        claimId: created.id,
        actorId: "staff-sian",
        form: recordForm({
          ...base,
          recoveryTick_environmental: "yes",
          recoveryAmount_environmental: "150",
          recoveryTick_winching: "yes",
          recoveryAmount_winching: "95",
          recoveryTick_forklift: "yes",
          recoveryAmount_forklift: "100",
          recoveryReason_forklift: "Two forklifts needed in the car park",
          recoveryTick_outOfHours: "yes",
          recoveryAmount_outOfHours: "100",
          recoveryTick_waiting: "yes",
          recoveryAmount_waiting: "30",
          recoveryReason_waiting: "Waited 45 minutes for the police",
        }),
      });
      // 395 + 150 + 95 + 100 + 100 + 30 = 870 net, VAT 174
      assert.equal(recoveryLine(created.id)?.net_pence, 87000);
      assert.equal(recoveryLine(created.id)?.gross_pence, 104400);
    });
    db.close();
  });

  it("refuses an arrival in the future or before the accident, and leaves a different storage start for a person to choose", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await newRecoveryClaim(false);
      assert.throws(
        () => recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ arrivedDate: isoDateFromNow(2), recoveryTick_standard: "yes", recoveryAmount_standard: "395" }) }),
        /future/,
      );
      assert.throws(
        () => recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ arrivedDate: isoDateFromNow(-5), recoveryTick_standard: "yes", recoveryAmount_standard: "395" }) }),
        /before the accident/,
      );
      db.prepare(`UPDATE claims SET storage_started_on = ?, storage_status = 'active' WHERE id = ?`).run(isoDateFromNow(-2), created.id);
      recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ recoveryTick_standard: "yes", recoveryAmount_standard: "395" }) });
      const claim = get<{ storage_started_on: string; storage_date_review_on: string }>(
        `SELECT storage_started_on, storage_date_review_on FROM claims WHERE id = ?`,
        [created.id],
      );
      assert.equal(claim?.storage_started_on, isoDateFromNow(-2));
      assert.equal(claim?.storage_date_review_on, isoDateFromNow(-1));
    });
    db.close();
  });

  it("does not change the charges once an agreed figure or a payment is on the recovery head", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await newRecoveryClaim(false);
      recordRecoveryDone({ claimId: created.id, actorId: "staff-sian", form: recordForm({ recoveryTick_standard: "yes", recoveryAmount_standard: "395" }) });
      db.prepare(`UPDATE financial_lines SET received_pence = 47400 WHERE claim_id = ? AND head_of_loss = 'recovery'`).run(created.id);
      assert.throws(
        () =>
          recordRecoveryDone({
            claimId: created.id,
            actorId: "staff-sian",
            form: recordForm({ recoveryTick_standard: "yes", recoveryAmount_standard: "395", recoveryTick_winching: "yes", recoveryAmount_winching: "95" }),
          }),
        /agreed figure or a payment/,
      );
    });
    db.close();
  });
});

describe("recovery and storage wording", () => {
  it("labels the agreed box by its own charge, and the day-count note is not read as a confirmed end", () => {
    const offers = fs.readFileSync(path.join(process.cwd(), "src/components/claims/VehicleOffers.tsx"), "utf8");
    assert.match(offers, /Agreed recovery figure/);
    assert.match(offers, /Agreed storage figure/);
    assert.doesNotMatch(STORAGE_INCLUSIVE_DAY_NOTE, /Confirmed/);
    const db = prepared();
    withDatabase(db, () => {
      assert.ok(get<{ id: string }>(`SELECT id FROM claims WHERE file_reference = 'TEST-0005'`));
    });
    db.close();
  });
});

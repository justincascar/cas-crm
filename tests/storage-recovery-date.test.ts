import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { assignDayJob } from "../src/lib/db/jobs.ts";
import { getHirePack, renderStorageRecovery } from "../src/lib/db/hire-pack.ts";
import { recordVehicleHandover } from "../src/lib/db/handover.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { saveScreenData, getScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { createStaffAccount } from "../src/lib/db/staff-admin.ts";
import {
  applyClientRecoveryActualDate,
  applyClientReturnActualDate,
  confirmStorageEndDate,
  confirmStorageRecoveryDate,
  getStorageDateReview,
  getStorageEndDateReview,
} from "../src/lib/db/storage-recovery-date.ts";
import { requireLondonDateTime } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function money(db: DatabaseSync) {
  const claim = db.prepare(`SELECT storage_started_on, storage_rate_pence, storage_billing_end_on, storage_date_review_on FROM claims WHERE id = 'c3'`).get() as {
    storage_started_on: string | null;
    storage_rate_pence: number | null;
    storage_billing_end_on: string | null;
    storage_date_review_on: string | null;
  };
  const recovery = db.prepare(`SELECT recovered_at, charge_pence FROM recovery_jobs WHERE claim_id = 'c3' ORDER BY id LIMIT 1`).get() as {
    recovered_at: string | null;
    charge_pence: number;
  };
  const lines = db.prepare(`SELECT id, rate_pence, net_pence, vat_pence, gross_pence FROM financial_lines WHERE claim_id = 'c3' ORDER BY id`).all();
  return { claim, recovery, lines };
}

function clearDates(db: DatabaseSync) {
  db.prepare(`UPDATE claims SET storage_started_on = NULL, storage_billing_end_on = NULL, storage_status = 'none', storage_date_review_on = NULL, storage_end_review_on = NULL, storage_rate_pence = 1500 WHERE id = 'c3'`).run();
  db.prepare(`DELETE FROM recovery_jobs WHERE claim_id = 'c3'`).run();
  db.prepare(
    `INSERT INTO recovery_jobs(
      id, claim_id, recovered_at, charge_pence, winch_pence, ooh_pence, environmental_pence,
      forklift_pence, mileage_pence, manual_pence, inherited
    ) VALUES ('rec-c3-test', 'c3', NULL, 4000, 0, 0, 0, 0, 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at)
     VALUES ('c3', 'storage', ?, '2026-09-22T12:00:00.000Z')
     ON CONFLICT(claim_id, screen_key) DO UPDATE SET data_json = excluded.data_json`,
  ).run(JSON.stringify({ vat: "12.50", netAmount: "62.50", days: "5", dailyRate: "1500" }));
}

describe("storage charged from the actual recovery date", () => {
  it("uses the recovery job date when the file has no recovery or storage start date, and leaves rate and VAT alone", () => {
    const db = prepared();
    const beforeLines = withDatabase(db, () => {
      clearDates(db);
      return money(db).lines;
    });
    withDatabase(db, () => {
      const occurred = requireLondonDateTime("2026-09-20T23:40");
      const result = applyClientRecoveryActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      assert.equal(result.status, "applied");
      const after = money(db);
      assert.equal(after.claim.storage_started_on, "2026-09-20");
      assert.equal(String(after.recovery.recovered_at).slice(0, 10), "2026-09-20");
      assert.equal(after.claim.storage_rate_pence, 1500);
      assert.equal(after.recovery.charge_pence, 4000);
      assert.equal(after.claim.storage_date_review_on, null);
      assert.deepEqual(after.lines, beforeLines);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      const pack = getHirePack("c3");
      assert.ok(pack);
      assert.match(renderStorageRecovery(pack), /Recovered on: 20\/09\/2026/);
      assert.equal(getStorageDateReview("c3"), null);
    });
    db.close();
  });

  it("flags a manually entered date instead of overwriting it, until staff confirm", () => {
    const db = prepared();
    withDatabase(db, () => {
      clearDates(db);
      saveScreenData(
        "c3",
        "storage",
        { startDate: "2026-09-22", dailyRate: "1500", vat: "12.50", netAmount: "62.50", days: "5" },
        "staff-justin",
      );
      assert.equal(money(db).claim.storage_started_on, "2026-09-22");
      const before = money(db);
      const occurred = requireLondonDateTime("2026-09-20T23:40");
      const result = applyClientRecoveryActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      assert.equal(result.status, "review");
      const flagged = money(db);
      assert.equal(flagged.claim.storage_started_on, "2026-09-22");
      assert.equal(flagged.claim.storage_rate_pence, before.claim.storage_rate_pence);
      assert.equal(flagged.recovery.charge_pence, before.recovery.charge_pence);
      assert.deepEqual(flagged.lines, before.lines);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      assert.equal(getStorageDateReview("c3")?.jobDate, "2026-09-20");
      const pack = getHirePack("c3");
      assert.ok(pack);
      assert.match(renderStorageRecovery(pack), /Recovered on: 22\/09\/2026/);
      assert.doesNotMatch(renderStorageRecovery(pack), /Recovered on: 20\/09\/2026/);

      confirmStorageRecoveryDate({ claimId: "c3", choice: "file", actorId: "staff-justin" });
      assert.equal(money(db).claim.storage_started_on, "2026-09-22");
      assert.equal(money(db).claim.storage_rate_pence, 1500);
      assert.equal(getStorageDateReview("c3"), null);

      applyClientRecoveryActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      confirmStorageRecoveryDate({ claimId: "c3", choice: "job", actorId: "staff-justin" });
      assert.equal(money(db).claim.storage_started_on, "2026-09-20");
      assert.equal(money(db).claim.storage_rate_pence, 1500);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      const confirmed = getHirePack("c3");
      assert.ok(confirmed);
      assert.match(renderStorageRecovery(confirmed), /Recovered on: 20\/09\/2026/);
    });
    db.close();
  });

  it("sets the start date from a recovery job or handover, and a return sets the storage end", () => {
    const db = prepared();
    withDatabase(db, () => {
      clearDates(db);
      const created = createStaffAccount({
        name: "Night Driver",
        username: "nightdriver",
        email: "night.driver@example.test",
        password: "password1",
        role: "driver",
        actorId: "staff-justin",
      });
      if (!created.ok) throw new Error(created.error);
      const assigned = assignDayJob({
        assigneeId: created.id,
        jobKind: "client_recovery",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: "2026-09-20",
        completed: true,
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-20T23:40",
      });
      assert.equal(assigned.storageDateReview, false);
      assert.equal(money(db).claim.storage_started_on, "2026-09-20");
      assert.equal(money(db).claim.storage_rate_pence, 1500);

      clearDates(db);
      recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_returned",
        hireEpisodeId: "",
        mileage: "100",
        fuelLevel: "half",
        conditionNote: "",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-21T10:00",
      });
      assert.equal(money(db).claim.storage_started_on, null);
      assert.equal(
        (db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c3'`).get() as { storage_billing_end_on: string | null }).storage_billing_end_on,
        "2026-09-21",
      );

      recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_recovered",
        hireEpisodeId: "",
        mileage: "54000",
        fuelLevel: "half",
        conditionNote: "Written up later.",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-20T02:15",
      });
      assert.equal(money(db).claim.storage_started_on, "2026-09-20");
      assert.equal(money(db).claim.storage_rate_pence, 1500);
      assert.equal(
        (db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c3'`).get() as { storage_billing_end_on: string | null }).storage_billing_end_on,
        "2026-09-21",
      );
    });
    db.close();
  });
});

function endState(db: DatabaseSync) {
  const claim = db.prepare(
    `SELECT storage_started_on, storage_billing_end_on, storage_rate_pence, storage_end_review_on, storage_status, off_hire_scheduled_on
     FROM claims WHERE id = 'c3'`,
  ).get() as {
    storage_started_on: string | null;
    storage_billing_end_on: string | null;
    storage_rate_pence: number | null;
    storage_end_review_on: string | null;
    storage_status: string | null;
    off_hire_scheduled_on: string | null;
  };
  const recovery = db.prepare(`SELECT charge_pence FROM recovery_jobs WHERE claim_id = 'c3' ORDER BY id LIMIT 1`).get() as { charge_pence: number };
  const lines = db.prepare(`SELECT id, rate_pence, net_pence, vat_pence, gross_pence FROM financial_lines WHERE claim_id = 'c3' ORDER BY id`).all();
  return { claim, recovery, lines };
}

describe("storage ends on the day the client's vehicle is returned after repair", () => {
  it("uses the return job date when the file has no storage end date, and leaves rate, VAT and hire end alone", () => {
    const db = prepared();
    const before = withDatabase(db, () => {
      clearDates(db);
      return endState(db);
    });
    withDatabase(db, () => {
      const occurred = requireLondonDateTime("2026-09-18T16:30");
      const result = applyClientReturnActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      assert.equal(result.status, "applied");
      const after = endState(db);
      assert.equal(after.claim.storage_billing_end_on, "2026-09-18");
      assert.equal(after.claim.storage_started_on, null);
      assert.equal(after.claim.storage_rate_pence, 1500);
      assert.equal(after.claim.storage_status, before.claim.storage_status);
      assert.equal(after.claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.equal(after.claim.storage_end_review_on, null);
      assert.equal(after.recovery.charge_pence, 4000);
      assert.deepEqual(after.lines, before.lines);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      assert.equal(getStorageEndDateReview("c3"), null);
    });
    db.close();
  });

  it("flags a manually entered end date instead of overwriting it, until staff confirm", () => {
    const db = prepared();
    withDatabase(db, () => {
      clearDates(db);
      saveScreenData(
        "c3",
        "storage",
        { endDate: "2026-09-22", dailyRate: "1500", vat: "12.50", netAmount: "62.50", days: "5" },
        "staff-justin",
      );
      assert.equal(endState(db).claim.storage_billing_end_on, "2026-09-22");
      assert.equal(getStorageEndDateReview("c3"), null);
      const before = endState(db);
      const occurred = requireLondonDateTime("2026-09-18T16:30");
      const result = applyClientReturnActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      assert.equal(result.status, "review");
      const flagged = endState(db);
      assert.equal(flagged.claim.storage_billing_end_on, "2026-09-22");
      assert.equal(flagged.claim.storage_rate_pence, before.claim.storage_rate_pence);
      assert.equal(flagged.claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.equal(flagged.recovery.charge_pence, before.recovery.charge_pence);
      assert.deepEqual(flagged.lines, before.lines);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      assert.equal(getStorageEndDateReview("c3")?.jobDate, "2026-09-18");
      assert.equal(getStorageEndDateReview("c3")?.storageEndDay, "2026-09-22");

      confirmStorageEndDate({ claimId: "c3", choice: "file", actorId: "staff-justin" });
      assert.equal(endState(db).claim.storage_billing_end_on, "2026-09-22");
      assert.equal(endState(db).claim.storage_rate_pence, 1500);
      assert.equal(getStorageEndDateReview("c3"), null);

      applyClientReturnActualDate({ claimId: "c3", actualOccurredAt: occurred, actorId: "staff-sian" });
      confirmStorageEndDate({ claimId: "c3", choice: "job", actorId: "staff-justin" });
      assert.equal(endState(db).claim.storage_billing_end_on, "2026-09-18");
      assert.equal(endState(db).claim.storage_rate_pence, 1500);
      assert.equal(endState(db).claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
      assert.equal(getStorageEndDateReview("c3"), null);
    });
    db.close();
  });

  it("sets the end date from a completed return job and from a handover, and a recovery job does not set it", () => {
    const db = prepared();
    withDatabase(db, () => {
      clearDates(db);
      const created = createStaffAccount({
        name: "Return Driver",
        username: "returndriver",
        email: "return.driver@example.test",
        password: "password1",
        role: "driver",
        actorId: "staff-justin",
      });
      if (!created.ok) throw new Error(created.error);
      const assigned = assignDayJob({
        assigneeId: created.id,
        jobKind: "client_return",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: "2026-09-18",
        completed: true,
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-18T16:30",
      });
      assert.equal(assigned.storageEndReview, false);
      assert.equal(assigned.storageDateReview, false);
      assert.equal(endState(db).claim.storage_billing_end_on, "2026-09-18");
      assert.equal(endState(db).claim.storage_started_on, null);
      assert.equal(endState(db).claim.storage_rate_pence, 1500);
      assert.equal(endState(db).claim.off_hire_scheduled_on, null);

      clearDates(db);
      recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_recovered",
        hireEpisodeId: "",
        mileage: "54000",
        fuelLevel: "half",
        conditionNote: "",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-20T02:15",
      });
      assert.equal(endState(db).claim.storage_billing_end_on, null);
      assert.equal(endState(db).claim.storage_started_on, "2026-09-20");

      clearDates(db);
      recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_returned",
        hireEpisodeId: "",
        mileage: "100",
        fuelLevel: "half",
        conditionNote: "Written up later.",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: created.id,
        actualOccurredAt: "2026-09-18T16:30",
      });
      assert.equal(endState(db).claim.storage_billing_end_on, "2026-09-18");
      assert.equal(endState(db).claim.storage_started_on, null);
      assert.equal(endState(db).claim.storage_rate_pence, 1500);
      assert.equal(getScreenData("c3", "storage").vat, "12.50");
    });
    db.close();
  });
});

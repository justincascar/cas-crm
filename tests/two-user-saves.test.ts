import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { saveClaimOverview } from "../src/lib/db/claim-facts.ts";
import { logChaseOutcome } from "../src/lib/db/chronology.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { FleetRemoveBlockedError, removeFleetVehicle, updateFleetVehicle } from "../src/lib/db/fleet.ts";
import { confirmHireEndDate } from "../src/lib/db/hire-collection-date.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordHeadPayment, secondPaymentWarning } from "../src/lib/db/payment-ledger.ts";
import { createReservation } from "../src/lib/db/queries.ts";
import { screenVersion, sectionVersion, VersionConflictError, withSectionSave } from "../src/lib/db/record-version.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { confirmStorageEndDate, confirmStorageRecoveryDate } from "../src/lib/db/storage-recovery-date.ts";
import { seed } from "../src/lib/db/seed.ts";
import { MissingSubmitKeyError, SubmitNeedsConfirm } from "../src/lib/db/submit-key.ts";
import { recordVehicleOffer } from "../src/lib/db/vehicle-offers.ts";
import { formatGbp } from "../src/lib/money.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function column(db: DatabaseSync, sql: string, ...params: string[]) {
  return db.prepare(sql).get(...params) as Record<string, string | number | null>;
}

describe("two-user saves", () => {
  const screens = [
    "general", "client", "driver", "owner", "insurer", "vehicle", "accident", "damage", "witnesses",
    "tp1", "tp2", "hire-mitigation", "delivery-collection", "hire-details", "extra-charges",
    "additional-drivers", "hire-cars", "assessed-damage", "loss-of-use", "storage", "recovery", "financial-summary",
  ];

  for (const screen of screens) {
    it(`refuses a second save of the ${screen} screen and keeps the first person's change`, () => {
      const db = seeded();
      withDatabase(db, () => {
        db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
        const opened = screenVersion("c5", screen);
        const marker = `Justin ${screen}`;
        const field = screen === "general" ? "notes" : screen === "accident" ? "details" : screen === "insurer" ? "companyName" : "forename";
        saveScreenData("c5", screen, { [field]: marker }, "staff-justin", opened, {});
        assert.throws(
          () => saveScreenData("c5", screen, { [field]: `Sian ${screen}` }, "staff-sian", opened, {}),
          (error: unknown) => error instanceof VersionConflictError,
        );
        const row = column(db, `SELECT data_json FROM claim_screen_data WHERE claim_id = 'c5' AND screen_key = ?`, screen);
        const saved = JSON.parse(String(row.data_json)) as Record<string, string>;
        assert.equal(saved[field], marker);
      });
      db.close();
    });
  }

  it("lets two people save different information on the same claim", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const client = screenVersion("c5", "client");
      const storage = screenVersion("c5", "storage");
      saveScreenData("c5", "client", { forename: "Justin client" }, "staff-justin", client, {});
      saveScreenData("c5", "storage", { name: "Sian storage" }, "staff-sian", storage, {});
      const clientRow = column(db, `SELECT data_json FROM claim_screen_data WHERE claim_id = 'c5' AND screen_key = 'client'`);
      const storageRow = column(db, `SELECT data_json FROM claim_screen_data WHERE claim_id = 'c5' AND screen_key = 'storage'`);
      assert.equal((JSON.parse(String(clientRow.data_json)) as { forename?: string }).forename, "Justin client");
      assert.equal((JSON.parse(String(storageRow.data_json)) as { name?: string }).name, "Sian storage");
    });
    db.close();
  });

  it("refuses claim facts after the accident screen changed the same circumstances", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const opened = screenVersion("c5", "accident");
      const shared = sectionVersion("shared-circumstances", "c5");
      saveScreenData("c5", "accident", { details: "Justin circumstances", location: "Bridgend" }, "staff-justin", opened, {}, {
        circumstancesVersion: shared,
      });
      const kept = column(db, `SELECT circumstances FROM claims WHERE id = 'c5'`).circumstances;
      assert.equal(kept, "Justin circumstances");
      const facts = column(
        db,
        `SELECT circumstances, accident_location, current_position, insurer_liability_position, own_insurer_name, own_policy_ref, own_claim_ref, own_insurer_address, own_insurer_postcode, cas_liability_assessment, roadworthiness_reasons, next_action, next_action_due, handler_id FROM claims WHERE id = 'c5'`,
      );
      assert.throws(
        () =>
          saveClaimOverview({
            claimId: "c5",
            actorId: "staff-sian",
            submitted: {
              circumstances: "Sian circumstances",
              accident_location: String(facts.accident_location || ""),
              current_position: String(facts.current_position || ""),
              insurer_liability_position: String(facts.insurer_liability_position || ""),
              own_insurer_name: String(facts.own_insurer_name || ""),
              own_policy_ref: String(facts.own_policy_ref || ""),
              own_claim_ref: String(facts.own_claim_ref || ""),
              own_insurer_address: String(facts.own_insurer_address || ""),
              own_insurer_postcode: String(facts.own_insurer_postcode || ""),
              cas_liability_assessment: String(facts.cas_liability_assessment || ""),
              roadworthiness_reasons: String(facts.roadworthiness_reasons || ""),
              next_action: String(facts.next_action || ""),
              next_action_due: String(facts.next_action_due || ""),
              handler_id: String(facts.handler_id || ""),
            },
            overviewVersion: sectionVersion("claim-overview", "c5"),
            circumstancesVersion: shared,
            ownInsurerVersion: sectionVersion("shared-own-insurer", "c5"),
            insurerPositionVersion: sectionVersion("shared-insurer-position", "c5"),
          }),
        (error: unknown) => error instanceof VersionConflictError && /Justin Roberts/.test(error.message),
      );
      assert.equal(column(db, `SELECT circumstances FROM claims WHERE id = 'c5'`).circumstances, "Justin circumstances");
    });
    db.close();
  });

  it("refuses the accident screen after claim facts changed the same circumstances", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c4'`).get();
      const facts = column(
        db,
        `SELECT circumstances, accident_location, current_position, insurer_liability_position, own_insurer_name, own_policy_ref, own_claim_ref, own_insurer_address, own_insurer_postcode, cas_liability_assessment, roadworthiness_reasons, next_action, next_action_due, handler_id FROM claims WHERE id = 'c4'`,
      );
      const shared = sectionVersion("shared-circumstances", "c4");
      const accident = screenVersion("c4", "accident");
      saveClaimOverview({
        claimId: "c4",
        actorId: "staff-justin",
        submitted: {
          ...Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, value == null ? "" : String(value)])),
          circumstances: "Facts circumstances",
        },
        overviewVersion: sectionVersion("claim-overview", "c4"),
        circumstancesVersion: shared,
        ownInsurerVersion: sectionVersion("shared-own-insurer", "c4"),
        insurerPositionVersion: sectionVersion("shared-insurer-position", "c4"),
      });
      assert.throws(
        () =>
          saveScreenData("c4", "accident", { details: "Accident later", location: "Cardiff" }, "staff-sian", accident, {}, {
            circumstancesVersion: shared,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(column(db, `SELECT circumstances FROM claims WHERE id = 'c4'`).circumstances, "Facts circumstances");
    });
    db.close();
  });

  it("refuses the insurer screen after claim facts changed the own insurer", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c4'`).get();
      const opened = screenVersion("c4", "insurer");
      const shared = sectionVersion("shared-own-insurer", "c4");
      const facts = column(
        db,
        `SELECT circumstances, accident_location, current_position, insurer_liability_position, own_insurer_name, own_policy_ref, own_claim_ref, own_insurer_address, own_insurer_postcode, cas_liability_assessment, roadworthiness_reasons, next_action, next_action_due, handler_id FROM claims WHERE id = 'c4'`,
      );
      saveClaimOverview({
        claimId: "c4",
        actorId: "staff-justin",
        submitted: {
          ...Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, value == null ? "" : String(value)])),
          own_insurer_name: "Justin insurer",
        },
        overviewVersion: sectionVersion("claim-overview", "c4"),
        circumstancesVersion: sectionVersion("shared-circumstances", "c4"),
        ownInsurerVersion: shared,
        insurerPositionVersion: sectionVersion("shared-insurer-position", "c4"),
      });
      assert.throws(
        () =>
          saveScreenData("c4", "insurer", { companyName: "Sian insurer" }, "staff-sian", opened, {}, {
            ownInsurerVersion: shared,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(column(db, `SELECT own_insurer_name FROM claims WHERE id = 'c4'`).own_insurer_name, "Justin insurer");
    });
    db.close();
  });

  it("refuses a liability chase after claim facts changed the insurer position", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const facts = column(
        db,
        `SELECT circumstances, accident_location, current_position, insurer_liability_position, own_insurer_name, own_policy_ref, own_claim_ref, own_insurer_address, own_insurer_postcode, cas_liability_assessment, roadworthiness_reasons, next_action, next_action_due, handler_id FROM claims WHERE id = 'c5'`,
      );
      const shared = sectionVersion("shared-insurer-position", "c5");
      saveClaimOverview({
        claimId: "c5",
        actorId: "staff-justin",
        submitted: {
          ...Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, value == null ? "" : String(value)])),
          insurer_liability_position: "admitted",
        },
        overviewVersion: sectionVersion("claim-overview", "c5"),
        circumstancesVersion: sectionVersion("shared-circumstances", "c5"),
        ownInsurerVersion: sectionVersion("shared-own-insurer", "c5"),
        insurerPositionVersion: shared,
      });
      assert.throws(
        () =>
          logChaseOutcome({
            claimId: "c5",
            actorId: "staff-sian",
            kind: "liability_response",
            liabilityDecision: "denied",
            insurerPositionVersion: shared,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(column(db, `SELECT insurer_liability_position FROM claims WHERE id = 'c5'`).insurer_liability_position, "admitted");
    });
    db.close();
  });

  it("refuses a stale fleet removal and does not remove the vehicle", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM fleet_vehicles WHERE id = 'fv-4'`).get();
      const opened = sectionVersion("fleet", "fv-4");
      createReservation({
        fleetVehicleId: "fv-4",
        startAt: "2027-01-01T09:00:00.000Z",
        endAt: "2027-01-02T09:00:00.000Z",
        kind: "staff",
        createdBy: "staff-justin",
        expectedVersion: opened,
      });
      assert.throws(
        () => removeFleetVehicle("fv-4", { expectedVersion: opened, actorId: "staff-sian" }),
        (error: unknown) =>
          error instanceof FleetRemoveBlockedError &&
          /active or future reservation/.test(error.message),
      );
      const vehicle = column(db, `SELECT removed_at, status FROM fleet_vehicles WHERE id = 'fv-4'`);
      assert.equal(vehicle.removed_at, null);
      const booking = column(db, `SELECT id FROM reservations WHERE fleet_vehicle_id = 'fv-4' AND start_at = '2027-01-01T09:00:00.000Z'`);
      assert.ok(booking.id);
    });
    db.close();
  });

  it("refuses a booking made from a stale fleet version after the vehicle was removed", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM fleet_vehicles WHERE id = 'fv-10'`).get();
      const opened = sectionVersion("fleet", "fv-10");
      removeFleetVehicle("fv-10", { expectedVersion: opened, actorId: "staff-justin" });
      assert.throws(
        () =>
          createReservation({
            fleetVehicleId: "fv-10",
            startAt: "2027-02-01T09:00:00.000Z",
            endAt: "2027-02-02T09:00:00.000Z",
            kind: "hire",
            createdBy: "staff-sian",
            expectedVersion: opened,
          }),
        (error: unknown) => error instanceof Error && /removed|changed this/i.test(error.message),
      );
      const booking = db.prepare(`SELECT id FROM reservations WHERE fleet_vehicle_id = 'fv-10' AND start_at = '2027-02-01T09:00:00.000Z'`).get();
      assert.equal(booking, undefined);
      assert.ok(column(db, `SELECT removed_at FROM fleet_vehicles WHERE id = 'fv-10'`).removed_at);
    });
    db.close();
  });

  it("refuses a payment with no key, records one double-click, records two genuine payments, and warns before the second", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c3'`).get();
      assert.throws(
        () => recordHeadPayment({ claimId: "c3", actorId: "staff-justin", head: "hire", amountPence: 4321, correction: false, submitKey: "" }),
        (error: unknown) => error instanceof MissingSubmitKeyError,
      );
      const before = Number(column(db, `SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).received_pence);
      const first = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 4321,
        correction: false,
        submitKey: "pence-4321",
      });
      const replay = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 4321,
        correction: false,
        submitKey: "pence-4321",
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.receivedPence, first.receivedPence);
      assert.equal(Number(column(db, `SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).received_pence), before + 4321);
      const warned = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-sian",
        head: "hire",
        amountPence: 4321,
        correction: false,
        submitKey: "pence-4321-b",
      });
      assert.equal(warned.needsConfirm, true);
      assert.match(String(warned.warning), /Is this a second, separate payment\?/);
      assert.match(String(warned.warning), new RegExp(formatGbp(4321).replace("£", "£")));
      assert.equal(Number(column(db, `SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).received_pence), before + 4321);
      const event = column(
        db,
        `SELECT occurred_at, actor_id FROM claim_events WHERE claim_id = 'c3' AND event_type = 'head_payment_logged' ORDER BY occurred_at DESC LIMIT 1`,
      );
      assert.equal(
        warned.warning,
        secondPaymentWarning({ amountPence: 4321, headLabel: "Hire", at: String(event.occurred_at), by: "Justin Roberts" }),
      );
      const yes = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-sian",
        head: "hire",
        amountPence: 4321,
        correction: false,
        submitKey: "pence-4321-yes",
        confirmSeparate: true,
      });
      assert.equal(yes.allocated, true);
      assert.equal(Number(column(db, `SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).received_pence), before + 8642);
    });
    db.close();
  });

  it("records one offer for a repeated key, warns on a second offer, and keeps the confirmed one", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c6'`).get();
      const first = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 222200,
        offeredOn: "2026-10-01",
        note: "pair",
        submitKey: "offer-pair",
      });
      assert.equal(
        recordVehicleOffer({
          claimId: "c6",
          actorId: "staff-justin",
          head: "repairs",
          amountPence: 222200,
          offeredOn: "2026-10-01",
          note: "pair",
          submitKey: "offer-pair",
        }),
        first,
      );
      assert.throws(
        () =>
          recordVehicleOffer({
            claimId: "c6",
            actorId: "staff-sian",
            head: "repairs",
            amountPence: 222200,
            offeredOn: "2026-10-01",
            note: "pair",
            submitKey: "offer-pair-2",
          }),
        (error: unknown) => error instanceof SubmitNeedsConfirm,
      );
      const second = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-sian",
        head: "repairs",
        amountPence: 222200,
        offeredOn: "2026-10-01",
        note: "pair",
        submitKey: "offer-pair-yes",
        confirmDuplicate: true,
      });
      assert.notEqual(second, first);
      const count = column(db, `SELECT COUNT(*) AS n FROM insurer_offers WHERE claim_id = 'c6' AND amount_pence = 222200 AND note = 'pair'`);
      assert.equal(Number(count.n), 2);
    });
    db.close();
  });

  it("refuses client details after the same person fields were saved, and keeps the first telephone", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c2'`).get();
      const opened = screenVersion("c2", "client");
      const shared = sectionVersion("shared-client-person", "c2");
      saveScreenData("c2", "client", { telMain: "07700900111" }, "staff-justin", opened, {}, { clientPersonVersion: shared });
      const kept = column(
        db,
        `SELECT telephone FROM people WHERE id = (SELECT client_person_id FROM claims WHERE id = 'c2')`,
      ).telephone;
      assert.equal(kept, "07700900111");
      assert.throws(
        () =>
          saveScreenData("c2", "client", { telMain: "07700900222" }, "staff-sian", screenVersion("c2", "client"), {}, {
            clientPersonVersion: shared,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(
        column(db, `SELECT telephone FROM people WHERE id = (SELECT client_person_id FROM claims WHERE id = 'c2')`).telephone,
        "07700900111",
      );
    });
    db.close();
  });

  it("refuses the vehicle screen after the GTA group was saved, and the third-party screen after the vehicle screen changed the same vehicle", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c2'`).get();
      const vehicleOpened = screenVersion("c2", "vehicle");
      const gta = sectionVersion("shared-client-gta", "c2");
      const tp = sectionVersion("shared-tp-vehicle", "c2");
      saveScreenData(
        "c2",
        "vehicle",
        { clientGtaGroup: "S2", tpMake: "", tpModel: "", tpReg: "WN99 NEW", tpColour: "" },
        "staff-justin",
        vehicleOpened,
        {},
        { clientGtaVersion: gta, tpVehicleVersion: tp },
      );
      assert.equal(
        column(db, `SELECT gta_group FROM vehicles WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c2')`).gta_group,
        "S2",
      );
      assert.throws(
        () =>
          saveScreenData("c2", "vehicle", { clientGtaGroup: "S3" }, "staff-sian", screenVersion("c2", "vehicle"), {}, {
            clientGtaVersion: gta,
            tpVehicleVersion: sectionVersion("shared-tp-vehicle", "c2"),
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(
        column(db, `SELECT gta_group FROM vehicles WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c2')`).gta_group,
        "S2",
      );
      const tpOpened = screenVersion("c2", "tp1");
      assert.throws(
        () =>
          saveScreenData("c2", "tp1", { registration: "AB12 SIAN" }, "staff-sian", tpOpened, {}, {
            tpVehicleVersion: tp,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      const reg = column(
        db,
        `SELECT registration FROM vehicles WHERE id = (SELECT vehicle_id FROM claim_third_parties WHERE claim_id = 'c2' AND sequence = 1)`,
      ).registration;
      assert.equal(reg, "WN99 NEW");
    });
    db.close();
  });

  it("refuses a storage-start confirmation after the storage screen changed the start, without confirming an end", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c9'`).get();
      const opened = screenVersion("c9", "storage");
      const start = sectionVersion("shared-storage-start", "c9");
      saveScreenData("c9", "storage", { startDate: "2026-01-10" }, "staff-justin", opened, {}, { storageStartVersion: start });
      assert.equal(column(db, `SELECT storage_started_on, storage_billing_end_on FROM claims WHERE id = 'c9'`).storage_started_on, "2026-01-10");
      const endBefore = column(db, `SELECT storage_billing_end_on FROM claims WHERE id = 'c9'`).storage_billing_end_on;
      db.prepare(`UPDATE claims SET storage_date_review_on = '2026-02-02' WHERE id = 'c9'`).run();
      assert.throws(
        () =>
          confirmStorageRecoveryDate({
            claimId: "c9",
            choice: "job",
            actorId: "staff-sian",
            storageStartVersion: start,
            recoveryAtVersion: sectionVersion("shared-recovery-at", "c9"),
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      const after = column(db, `SELECT storage_started_on, storage_billing_end_on FROM claims WHERE id = 'c9'`);
      assert.equal(after.storage_started_on, "2026-01-10");
      assert.equal(after.storage_billing_end_on, endBefore);
    });
    db.close();
  });

  it("refuses a storage-end confirmation after the storage screen changed the end", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c9'`).get();
      const opened = screenVersion("c9", "storage");
      const start = sectionVersion("shared-storage-start", "c9");
      const end = sectionVersion("shared-storage-end", "c9");
      saveScreenData(
        "c9",
        "storage",
        { startDate: "2026-01-10", endDate: "2026-02-01" },
        "staff-justin",
        opened,
        {},
        { storageStartVersion: start, storageEndVersion: end },
      );
      db.prepare(`UPDATE claims SET storage_end_review_on = '2026-03-01' WHERE id = 'c9'`).run();
      assert.throws(
        () => confirmStorageEndDate({ claimId: "c9", choice: "job", actorId: "staff-sian", storageEndVersion: end }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(column(db, `SELECT storage_billing_end_on FROM claims WHERE id = 'c9'`).storage_billing_end_on, "2026-02-01");
    });
    db.close();
  });

  it("refuses a recovery-date confirmation after the recovery screen changed the recovered date", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const opened = screenVersion("c5", "recovery");
      const shared = sectionVersion("shared-recovery-at", "c5");
      const endBefore = column(db, `SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).storage_billing_end_on;
      saveScreenData("c5", "recovery", { recoveryDate: "2026-01-15" }, "staff-justin", opened, {}, { recoveryAtVersion: shared });
      db.prepare(`UPDATE claims SET storage_date_review_on = '2026-02-20' WHERE id = 'c5'`).run();
      assert.throws(
        () =>
          confirmStorageRecoveryDate({
            claimId: "c5",
            choice: "job",
            actorId: "staff-sian",
            storageStartVersion: sectionVersion("shared-storage-start", "c5"),
            recoveryAtVersion: shared,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      const recovered = column(db, `SELECT recovered_at FROM recovery_jobs WHERE claim_id = 'c5' ORDER BY id LIMIT 1`).recovered_at;
      assert.equal(String(recovered).slice(0, 10), "2026-01-15");
      assert.equal(column(db, `SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).storage_billing_end_on, endBefore);
    });
    db.close();
  });

  it("refuses a later hire-end confirmation after the hire end was already saved", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM hire_episodes WHERE id = 'h-c4'`).get();
      db.prepare(`UPDATE hire_episodes SET billing_end_at = '2026-02-01', hire_end_review_on = '2026-03-01' WHERE id = 'h-c4'`).run();
      const opened = sectionVersion("shared-hire-end", "h-c4");
      confirmHireEndDate({ claimId: "c4", episodeId: "h-c4", choice: "job", actorId: "staff-justin", hireEndVersion: opened });
      assert.equal(String(column(db, `SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c4'`).billing_end_at).slice(0, 10), "2026-03-01");
      db.prepare(`UPDATE hire_episodes SET hire_end_review_on = '2026-04-01' WHERE id = 'h-c4'`).run();
      assert.throws(
        () => confirmHireEndDate({ claimId: "c4", episodeId: "h-c4", choice: "job", actorId: "staff-sian", hireEndVersion: opened }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(String(column(db, `SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c4'`).billing_end_at).slice(0, 10), "2026-03-01");
    });
    db.close();
  });

  it("refuses a stale fleet edit, a stale removal, and a booking opened before that edit", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM fleet_vehicles WHERE id = 'fv-4'`).get();
      const opened = sectionVersion("fleet", "fv-4");
      const vehicle = column(
        db,
        `SELECT v.registration, v.make, v.model, v.transmission, v.fuel, v.colour, fv.location FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.id = 'fv-4'`,
      );
      const input = {
        registration: String(vehicle.registration),
        make: String(vehicle.make),
        model: "Edited Focus",
        colour: String(vehicle.colour || ""),
        fuel: String(vehicle.fuel || ""),
        firstRegisteredOn: "",
        vehicleClass: "car",
        transmission: String(vehicle.transmission || ""),
        location: String(vehicle.location || "CAS yard, Bridgend"),
        notes: "",
      };
      withSectionSave({
        scope: "fleet",
        recordKey: "fv-4",
        expected: opened,
        actorId: "staff-justin",
        submitted: { registration: input.registration, make: input.make, model: input.model },
        fields: { registration: input.registration, make: input.make, model: input.model },
        write: () => updateFleetVehicle("fv-4", input),
      });
      assert.equal(
        column(db, `SELECT model FROM vehicles WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = 'fv-4')`).model,
        "Edited Focus",
      );
      assert.throws(
        () =>
          withSectionSave({
            scope: "fleet",
            recordKey: "fv-4",
            expected: opened,
            actorId: "staff-sian",
            submitted: { registration: input.registration, make: input.make, model: "Sian Focus" },
            fields: { registration: input.registration, make: input.make, model: "Sian Focus" },
            write: () => updateFleetVehicle("fv-4", { ...input, model: "Sian Focus" }),
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.throws(
        () => removeFleetVehicle("fv-4", { expectedVersion: opened, actorId: "staff-sian" }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(column(db, `SELECT removed_at FROM fleet_vehicles WHERE id = 'fv-4'`).removed_at, null);
      assert.throws(
        () =>
          createReservation({
            fleetVehicleId: "fv-4",
            startAt: "2027-03-01T09:00:00.000Z",
            endAt: "2027-03-02T09:00:00.000Z",
            kind: "staff",
            createdBy: "staff-sian",
            expectedVersion: opened,
          }),
        (error: unknown) => error instanceof VersionConflictError,
      );
      assert.equal(
        db.prepare(`SELECT id FROM reservations WHERE fleet_vehicle_id = 'fv-4' AND start_at = '2027-03-01T09:00:00.000Z'`).get(),
        undefined,
      );
      assert.equal(
        column(db, `SELECT model FROM vehicles WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = 'fv-4')`).model,
        "Edited Focus",
      );
    });
    db.close();
  });
});

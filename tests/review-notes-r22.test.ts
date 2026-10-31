import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, run, withDatabase } from "../src/lib/db/connection.ts";
import { ensureRealFleet } from "../src/lib/db/fleet.ts";
import {
  fleetCarDetails,
  listFleetDetailsToComplete,
  saveFleetGtaRule,
  saveMissingFleetDetails,
  suggestFleetGtaGroup,
} from "../src/lib/db/fleet-details.ts";
import { generateHireAgreementDocument } from "../src/lib/db/hire-agreement.ts";
import { chooseHireCar, loadHireArea, saveHireNeed } from "../src/lib/db/hire-choice.ts";
import { getHirePack, renderHirePack } from "../src/lib/db/hire-pack.ts";
import { saveHireCarDetails } from "../src/lib/db/hire-out-readings.ts";
import { agreementMandatoryGaps } from "../src/lib/db/hire-readiness.ts";
import { listDriverJobs } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { londonTodayIso } from "../src/lib/dates.ts";
import { prepareAgreementItems, recordPassingPrehireChecks } from "./prehire-setup.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-r22-"));
process.env.CAS_V5C_SOURCE_DIR = path.join(os.tmpdir(), "cas-r22-no-v5c-folder");
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  // Fictional files: the client's own car group was never looked up, which the group check (R27) accepts with a reason.
  db.exec(`UPDATE vehicles SET gta_unclassified_reason = 'Fictional test car: group not looked up' WHERE gta_group IS NULL AND id IN (SELECT client_vehicle_id FROM claims)`);
  return db;
}

const FLEET_ID = "fv-10";
const vehicleOf = (fleetId: string) => String(get<{ vehicle_id: string }>(`SELECT vehicle_id FROM fleet_vehicles WHERE id = ?`, [fleetId])?.vehicle_id);

function readyForAgreement(claimId = "c1") {
  saveHireNeed({ claimId, choice: "yes", reason: "Car cannot be driven.", actorId: "staff-sian", submitKey: `need-${claimId}` });
  chooseHireCar({
    claimId,
    fleetVehicleId: FLEET_ID,
    method: "deliver",
    date: londonTodayIso(),
    time: "10:00",
    address: "1 Test Street, Cardiff",
    actorId: "staff-sian",
    submitKey: `choose-${claimId}`,
    driverId: "staff-driver",
  });
  recordPassingPrehireChecks(claimId);
  prepareAgreementItems(claimId);
}

function agreementHtml(documentId: string) {
  return String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [documentId])?.body_html);
}

describe("R22 — a chosen hire car shows and carries all of its details", () => {
  it("shows a complete car's details on the hire screen, the agreement, the hire pack and the driver job", () => {
    const db = prepared();
    withDatabase(db, () => {
      readyForAgreement();
      run(`UPDATE vehicles SET transmission = 'Manual', fuel = 'Petrol', seats = 5, colour = 'Red', gta_group = 'S3' WHERE id = ?`, [vehicleOf(FLEET_ID)]);
      run(`UPDATE fleet_vehicles SET location = 'CAS yard, Brynamman', current_mileage = 41234, current_mileage_on = '2026-10-20T09:00:00.000Z' WHERE id = ?`, [FLEET_ID]);

      const area = loadHireArea("c1");
      const car = area?.chosen?.details;
      assert.ok(car);
      assert.deepEqual(car.missing, []);
      assert.equal(car.transmission, "Manual");
      assert.equal(car.fuel, "Petrol");
      assert.equal(car.seats, 5);
      assert.equal(car.colour, "Red");
      assert.equal(car.gtaGroup, "S3");
      assert.equal(car.mileage, 41234);
      assert.equal(car.location, "CAS yard, Brynamman");

      assert.deepEqual(agreementMandatoryGaps("c1"), []);
      const made = generateHireAgreementDocument("c1", "staff-sian");
      const html = agreementHtml(made.documentId);
      assert.match(html, /Make: Peugeot/);
      assert.match(html, /Model: 208/);
      assert.match(html, /Transmission: Manual/);
      assert.match(html, /Fuel: Petrol/);
      assert.match(html, /Colour: Red/);
      assert.match(html, /Seats: 5/);
      assert.match(html, /Group of vehicle supplied \(not used for the rate\): S3/);
      assert.doesNotMatch(html, /Group of vehicle supplied \(not used for the rate\): not classified/);

      const pack = renderHirePack(getHirePack("c1")!);
      assert.match(pack, /Collect the car from: CAS yard, Brynamman/);
      assert.match(pack, /Colour: Red/);
      assert.match(pack, /Vehicle group: S3/);

      const job = listDriverJobs().find((row) => row.claimId === "c1" && row.jobKind === "hire_delivery");
      assert.ok(job);
      assert.match(job.vehicleDetails, /Manual · Petrol · 5 seats · Red · GTA group S3 · 41,234 miles/);
      assert.equal(job.pickUpFrom, "CAS yard, Brynamman");
    });
    db.close();
  });

  it("asks for missing details on the hire screen, saves them to the fleet record once, and puts them on the agreement", () => {
    const db = prepared();
    withDatabase(db, () => {
      readyForAgreement();
      run(`UPDATE vehicles SET transmission = NULL, seats = NULL, colour = NULL, gta_group = NULL WHERE id = ?`, [vehicleOf(FLEET_ID)]);

      const before = loadHireArea("c1")?.chosen?.details;
      assert.ok(before);
      for (const field of ["transmission", "seats", "colour", "gtaGroup"] as const) assert.ok(before.missing.includes(field), field);
      assert.equal(before.suggestedGroup, null, "no Settings rule, so no group is suggested");
      const keys = agreementMandatoryGaps("c1").map((gap) => gap.key);
      assert.ok(keys.includes("transmission"));
      assert.ok(keys.includes("car-details"));
      assert.throws(() => generateHireAgreementDocument("c1", "staff-sian"), /hire car seats, colour, GTA group/);

      const result = saveHireCarDetails({
        claimId: "c1",
        actorId: "staff-sian",
        actorRole: "staff",
        values: { transmission: "Automatic", seats: "5", colour: "Blue", gtaGroup: "M2", fuel: "Diesel" },
        expectedVersion: before.version,
      });
      assert.deepEqual([...result.saved].sort(), ["colour", "gtaGroup", "seats", "transmission"]);
      const saved = get<{ transmission: string; seats: number; colour: string; gta_group: string; fuel: string }>(
        `SELECT transmission, seats, colour, gta_group, fuel FROM vehicles WHERE id = ?`,
        [vehicleOf(FLEET_ID)],
      );
      assert.equal(saved?.transmission, "Automatic");
      assert.equal(saved?.seats, 5);
      assert.equal(saved?.colour, "Blue");
      assert.equal(saved?.gta_group, "M2");
      assert.equal(saved?.fuel, "petrol", "a detail already on the record is not changed from the hire screen");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c1' AND event_type = 'hire_car_details_saved'`);
      assert.match(String(event?.details), /Saved to the fleet record for CAS 10: gearbox automatic, 5 seats, colour Blue, GTA group M2/);

      assert.deepEqual(agreementMandatoryGaps("c1"), []);
      const html = agreementHtml(generateHireAgreementDocument("c1", "staff-sian").documentId);
      assert.match(html, /Transmission: Automatic/);
      assert.match(html, /Colour: Blue/);
      assert.match(html, /Seats: 5/);
      assert.match(html, /Group of vehicle supplied \(not used for the rate\): M2/);

      // The next hire of this car has them: nothing is asked again.
      assert.deepEqual(fleetCarDetails(FLEET_ID)?.missing.filter((field) => field !== "mileage"), []);
    });
    db.close();
  });

  it("produces the unsigned agreement again when details are saved after it was produced", () => {
    const db = prepared();
    withDatabase(db, () => {
      readyForAgreement();
      generateHireAgreementDocument("c1", "staff-sian");
      run(`UPDATE fleet_vehicles SET location = NULL WHERE id = ?`, [FLEET_ID]);
      const out = saveHireCarDetails({ claimId: "c1", actorId: "staff-sian", actorRole: "staff", values: { location: "Brynamman yard" } });
      assert.equal(out.reproduced, true);
      const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c1' AND template_key = 'hire_agreement'`);
      assert.equal(Number(count?.n), 2);
    });
    db.close();
  });

  it("refuses a gearbox, seats or GTA group that is not a real choice", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE vehicles SET transmission = NULL, seats = NULL, gta_group = NULL WHERE id = ?`, [vehicleOf(FLEET_ID)]);
      assert.throws(() => saveMissingFleetDetails({ fleetVehicleId: FLEET_ID, actorId: "staff-sian", values: { transmission: "semi-auto" } }), /manual or automatic/);
      assert.throws(() => saveMissingFleetDetails({ fleetVehicleId: FLEET_ID, actorId: "staff-sian", values: { seats: "0" } }), /seats/);
      assert.throws(() => saveMissingFleetDetails({ fleetVehicleId: FLEET_ID, actorId: "staff-sian", values: { gtaGroup: "Z9" } }), /GTA group/);
      assert.throws(() => saveMissingFleetDetails({ fleetVehicleId: FLEET_ID, actorId: "staff-sian", values: {} }), /at least one/);
    });
    db.close();
  });

  it("suggests a GTA group only where Settings has a clear make-and-model rule", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.equal(suggestFleetGtaGroup("TOYOTA", "YARIS ICON D-4D"), null);
      saveFleetGtaRule({ make: "toyota", model: "yaris", group: "s2", actorId: "staff-sian" });
      assert.deepEqual(suggestFleetGtaGroup("TOYOTA", "YARIS ICON D-4D"), { group: "S2", rule: "TOYOTA YARIS → S2" });
      assert.equal(suggestFleetGtaGroup("TOYOTA", "YARISX"), null, "the rule matches whole words only");
      assert.equal(suggestFleetGtaGroup("PEUGEOT", "YARIS"), null, "the make must match");
      saveFleetGtaRule({ make: "TOYOTA", model: "YARIS ICON", group: "S3", actorId: "staff-sian" });
      assert.equal(suggestFleetGtaGroup("TOYOTA", "YARIS ICON D-4D"), null, "two rules that disagree are not a clear rule");
      assert.throws(() => saveFleetGtaRule({ make: "TOYOTA", model: "YARIS", group: "S4", actorId: "staff-sian" }), /already a rule/);
      assert.throws(() => saveFleetGtaRule({ make: "TOYOTA", model: "AYGO", group: "Q1", actorId: "staff-sian" }), /GTA group/);
      // The suggestion is shown, never saved by itself.
      run(`UPDATE vehicles SET make = 'TOYOTA', model = 'AYGO X-PLAY', gta_group = NULL WHERE id = ?`, [vehicleOf(FLEET_ID)]);
      saveFleetGtaRule({ make: "TOYOTA", model: "AYGO", group: "S1", actorId: "staff-sian" });
      assert.equal(fleetCarDetails(FLEET_ID)?.suggestedGroup?.group, "S1");
      assert.equal(fleetCarDetails(FLEET_ID)?.gtaGroup, null);
    });
    db.close();
  });

  it("lists real fleet cars with missing details, uses V5C fuel and colour, and never guesses gearbox, seats or group", () => {
    const db = prepared();
    withDatabase(db, () => {
      ensureRealFleet(db);
      const yaris = get<{ fleet_id: string; vehicle_id: string }>(
        `SELECT fv.id AS fleet_id, v.id AS vehicle_id FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE v.registration = 'CN16 AYS'`,
      );
      assert.ok(yaris);
      run(`UPDATE vehicles SET colour = NULL, fuel = NULL WHERE id = ?`, [yaris.vehicle_id]);
      ensureRealFleet(db);
      const car = fleetCarDetails(yaris.fleet_id);
      assert.equal(car?.colour, "RED", "colour read from the V5C fills the blank");
      assert.equal(car?.fuel, "Diesel", "fuel read from the V5C fills the blank");
      assert.equal(car?.transmission, "");
      assert.equal(car?.seats, null);
      assert.equal(car?.gtaGroup, null);

      const list = listFleetDetailsToComplete();
      assert.ok(list.length > 0);
      assert.ok(list.every((row) => row.missing.length > 0));
      assert.ok(!list.some((row) => row.fleetVehicleId === FLEET_ID), "TEST fleet cars are not on the real fleet list");
      const listed = list.find((row) => row.fleetVehicleId === yaris.fleet_id);
      assert.deepEqual(listed?.missing, ["transmission", "seats", "gtaGroup", "mileage"]);

      saveMissingFleetDetails({ fleetVehicleId: yaris.fleet_id, actorId: "staff-sian", values: { transmission: "Manual", seats: "5", gtaGroup: "S3", mileage: "88,100" } });
      assert.ok(!listFleetDetailsToComplete().some((row) => row.fleetVehicleId === yaris.fleet_id));
      assert.equal(fleetCarDetails(yaris.fleet_id)?.mileage, 88100);
    });
    db.close();
  });
});

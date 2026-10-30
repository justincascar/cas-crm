import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { all, get, run, withDatabase } from "../src/lib/db/connection.ts";
import { fleetAvailability } from "../src/lib/db/fleet-availability.ts";
import { chooseHireCar } from "../src/lib/db/hire-choice.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  cancelVehicleSwap,
  completeSwapAfterSigning,
  openSwap,
  overrideUnsignedSwap,
  startVehicleSwap,
  storeSignedSwapAgreement,
  swapView,
} from "../src/lib/db/vehicle-swap.ts";
import { londonTodayIso } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-r26-"));
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const readings = {
  oldMileageIn: "23,410",
  oldFuelIn: "half",
  oldCondition: "No new damage.",
  newMileageOut: "11200",
  newFuelOut: "full",
  newCondition: "Small scuff on the rear bumper, photographed.",
};
const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), filename: "signed-swap.jpg", mimeType: "image/jpeg" };

function freeCar(claimId: string): string {
  const today = londonTodayIso();
  const current = get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE claim_id = ?`, [claimId])?.fleet_vehicle_id;
  const car = fleetAvailability({ startAt: `${today}T10:00:00.000Z`, endAt: `${today}T23:00:00.000Z`, ignoreClaimId: claimId }).find(
    (row) => row.free && row.state !== "removed" && row.carId !== current,
  );
  assert.ok(car, "a free car to swap to");
  return car.carId;
}

function swapInput(claimId: string, fleetVehicleId: string) {
  return { claimId, actorId: "staff-sian", newFleetVehicleId: fleetVehicleId, date: londonTodayIso(), time: "10:30", ...readings };
}

describe("Review note R26 — a vehicle swap needs a new signed hire agreement", () => {
  it("produces a new agreement from the Hire Pack for the replacement car and keeps the old car on the hire until it is signed", () => {
    const db = prepared();
    withDatabase(db, () => {
      const car = freeCar("c3");
      const before = get<{ fleet_vehicle_id: string; started_at: string }>(`SELECT fleet_vehicle_id, started_at FROM hire_episodes WHERE id = 'h-c3'`)!;
      assert.throws(() => startVehicleSwap({ ...swapInput("c3", car), newCondition: "" }), /Describe the new car's condition/);
      const result = startVehicleSwap(swapInput("c3", car));
      assert.equal(result.completed, false);
      const doc = get<{ body_html: string; template_key: string; signed: number }>(`SELECT body_html, template_key, signed FROM documents WHERE id = ?`, [result.agreementDocumentId]);
      const newReg = get<{ registration: string }>(`SELECT v.registration FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.id = ?`, [car])!.registration;
      assert.equal(doc?.template_key, "hire_agreement");
      assert.equal(doc?.signed, 0);
      assert.match(String(doc?.body_html), new RegExp(newReg));
      assert.match(String(doc?.body_html), /Mileage at delivery: 11,200 miles/);
      assert.match(String(doc?.body_html), /Fuel level at delivery: Full/);
      assert.match(String(doc?.body_html), /or any vehicle with which We replace it during the Rental Period/, "the supplied terms, unchanged");
      const during = get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE id = 'h-c3'`)!;
      assert.equal(during.fleet_vehicle_id, before.fleet_vehicle_id, "the old car stays on the hire until the agreement is signed");
      assert.ok(openSwap("c3"));
      assert.throws(() => startVehicleSwap(swapInput("c3", car)), /already waiting/);
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'hire_swap_started'`);
      assert.match(String(event?.details), /returned: 23,410 miles, fuel ½, condition: No new damage\. /, "one full stop, not two");
    });
    db.close();
  });

  it("completes on the signed paper copy: one continuous hire, the earlier agreement superseded, the alerts following the new one", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(
        `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, created_at) VALUES ('doc-first-signed', 'c3', 'Signed hire agreement', 'file', 'signed_hire_agreement', 1, 1, 0, '2026-10-01T10:00:00.000Z')`,
      );
      const car = freeCar("c3");
      const oldCar = get<{ fleet_vehicle_id: string; started_at: string }>(`SELECT fleet_vehicle_id, started_at FROM hire_episodes WHERE id = 'h-c3'`)!;
      startVehicleSwap(swapInput("c3", car));
      const { documentId } = storeSignedSwapAgreement({ claimId: "c3", actorId: "staff-sian", file: photo });
      const after = get<{ id: string; fleet_vehicle_id: string; started_at: string }>(`SELECT id, fleet_vehicle_id, started_at FROM hire_episodes WHERE claim_id = 'c3'`)!;
      assert.equal(after.id, "h-c3");
      assert.equal(after.fleet_vehicle_id, car);
      assert.equal(after.started_at, oldCar.started_at, "the hire start date and day count do not change");
      assert.equal(all(`SELECT id FROM hire_episodes WHERE claim_id = 'c3'`).length, 1);
      assert.equal(get<{ status: string }>(`SELECT status FROM fleet_vehicles WHERE id = ?`, [oldCar.fleet_vehicle_id])?.status, "available");
      assert.equal(get<{ status: string; current_mileage: number }>(`SELECT status, current_mileage FROM fleet_vehicles WHERE id = ?`, [car])?.status, "on_hire");
      assert.equal(get<{ current_mileage: number }>(`SELECT current_mileage FROM fleet_vehicles WHERE id = ?`, [oldCar.fleet_vehicle_id])?.current_mileage, 23410);
      assert.equal(get<{ superseded_by_document_id: string }>(`SELECT superseded_by_document_id FROM documents WHERE id = 'doc-first-signed'`)?.superseded_by_document_id, documentId);
      const latest = get<{ sequence: number; start_on: string; signed: number }>(`SELECT sequence, start_on, signed FROM agreements WHERE hire_episode_id = 'h-c3' ORDER BY sequence DESC LIMIT 1`)!;
      assert.deepEqual({ ...latest }, { sequence: 2, start_on: londonTodayIso(), signed: 1 }, "the renewal alerts follow the latest signed agreement");
      const view = swapView("c3", londonTodayIso());
      assert.match(String(view.agreementClock), /^Hire day 7 · current agreement day 1 \(signed \d{2}\/\d{2}\/\d{4}\)$/);
      assert.equal(view.open, null);
      assert.equal(view.history[0].how, "new agreement signed");
      const changed = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'hire_vehicle_changed'`);
      assert.match(String(changed?.details), /One continuous hire/);
      assert.match(String(changed?.details), /earlier agreement is kept on the file, marked superseded/);
    });
    db.close();
  });

  it("completes when the swap agreement is signed on screen, and not for any other signature", () => {
    const db = prepared();
    withDatabase(db, () => {
      const car = freeCar("c3");
      const { agreementDocumentId } = startVehicleSwap(swapInput("c3", car));
      assert.equal(completeSwapAfterSigning({ claimId: "c3", agreementDocumentId: "some-other-doc", signedDocumentId: "x", actorId: "staff-sian" }), false);
      run(`INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, created_at) VALUES ('doc-screen', 'c3', 'Signed hire agreement', 'file', 'signed_hire_agreement', 2, 1, 0, ?)`, [new Date().toISOString()]);
      assert.equal(completeSwapAfterSigning({ claimId: "c3", agreementDocumentId: String(agreementDocumentId), signedDocumentId: "doc-screen", actorId: "staff-sian" }), true);
      assert.equal(get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM documents WHERE id = 'doc-screen'`)?.fleet_vehicle_id, car);
      assert.equal(get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE id = 'h-c3'`)?.fleet_vehicle_id, car);
    });
    db.close();
  });

  it("can only be completed without the signed agreement by Justin, with a reason; a cancelled swap releases the new car", () => {
    const db = prepared();
    withDatabase(db, () => {
      const car = freeCar("c3");
      startVehicleSwap(swapInput("c3", car));
      assert.throws(() => overrideUnsignedSwap({ claimId: "c3", actorId: "staff-sian", reason: "Client away" }), /Only Justin/);
      assert.throws(() => overrideUnsignedSwap({ claimId: "c3", actorId: "staff-justin", reason: " " }), /Enter the reason/);
      cancelVehicleSwap({ claimId: "c3", actorId: "staff-sian" });
      assert.equal(openSwap("c3"), null);
      assert.equal(get<{ status: string }>(`SELECT status FROM fleet_vehicles WHERE id = ?`, [car])?.status, "available");
      startVehicleSwap(swapInput("c3", car));
      overrideUnsignedSwap({ claimId: "c3", actorId: "staff-justin", reason: "Client in hospital; signs on discharge." });
      assert.equal(get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE id = 'h-c3'`)?.fleet_vehicle_id, car);
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM agreements WHERE hire_episode_id = 'h-c3'`)?.n, 1, "no signed agreement is invented");
      assert.match(swapView("c3", londonTodayIso()).history[0].how, /Justin's override: Client in hospital/);
    });
    db.close();
  });

  it("refuses Choose a car on a running hire, and swaps a courtesy car straight away with its readings", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, source) VALUES ('ev-need-c3', 'c3', 'hire_decision', 'Hire', 'Replacement vehicle: yes', ?, ?, 'staff')`, [new Date().toISOString(), new Date().toISOString()]);
      assert.throws(
        () => chooseHireCar({ claimId: "c3", fleetVehicleId: freeCar("c3"), method: "collect", date: londonTodayIso(), time: "12:00", address: "", actorId: "staff-sian", submitKey: "r26-choose" }),
        /This hire is running\. Use Swap the car/,
      );
      const car = freeCar("c4");
      const result = startVehicleSwap(swapInput("c4", car));
      assert.equal(result.completed, true);
      assert.equal(result.agreementDocumentId, null);
      assert.equal(get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE id = 'h-c4'`)?.fleet_vehicle_id, car);
    });
    db.close();
  });
});

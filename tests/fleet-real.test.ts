import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  attachV5cBuffer,
  createFleetVehicle,
  DEFAULT_V5C_SOURCE_DIR,
  ensureRealFleet,
  FleetRemoveBlockedError,
  getFleetVehicle,
  listBlockingReservations,
  listFleetVehicleDocuments,
  loadRealFleetCatalog,
  removeFleetVehicle,
  updateFleetVehicle,
} from "../src/lib/db/fleet.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { createReservation, listFleet } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { storedFileExists } from "../src/lib/storage/files.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const fixturePdf = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/minimal.pdf"));
const previousFilesDir = process.env.CAS_FILES_DIR;
const previousSourceDir = process.env.CAS_V5C_SOURCE_DIR;

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function testRegs(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT fv.id, v.registration, fv.status, fv.is_real, fv.notes
       FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id
       WHERE fv.is_real = 0
       ORDER BY v.registration`,
    )
    .all() as Array<{ id: string; registration: string; status: string; is_real: number; notes: string | null }>;
}

describe("real CAS fleet", () => {
  before(() => {
    process.env.CAS_FILES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cas-files-"));
    process.env.CAS_V5C_SOURCE_DIR = path.join(os.tmpdir(), `cas-v5c-absent-${Date.now()}`);
  });

  after(() => {
    if (previousFilesDir === undefined) delete process.env.CAS_FILES_DIR;
    else process.env.CAS_FILES_DIR = previousFilesDir;
    if (previousSourceDir === undefined) delete process.env.CAS_V5C_SOURCE_DIR;
    else process.env.CAS_V5C_SOURCE_DIR = previousSourceDir;
  });

  it("keeps the fictional CAS 1-10 TEST fleet untouched and tags the 45 real vehicles separately", () => {
    const db = prepared();
    const before = testRegs(db);
    assert.equal(before.length, 10);
    assert.deepEqual(
      before.map((row) => row.registration),
      ["CAS 1", "CAS 10", "CAS 2", "CAS 3", "CAS 4", "CAS 5", "CAS 6", "CAS 7", "CAS 8", "CAS 9"],
    );

    withDatabase(db, () => {
      ensureRealFleet(db);
      ensureRealFleet(db);
      const after = testRegs(db);
      assert.deepEqual(after, before);

      const real = db
        .prepare(
          `SELECT v.registration, v.make, v.model, v.vehicle_class, v.transmission, v.seats, fv.is_real
           FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id
           WHERE fv.is_real = 1
           ORDER BY v.registration`,
        )
        .all() as Array<{
        registration: string | null;
        make: string | null;
        model: string | null;
        vehicle_class: string | null;
        transmission: string | null;
        seats: number | null;
        is_real: number;
      }>;
      assert.equal(loadRealFleetCatalog().length, 45);
      assert.equal(real.length, 45);
      assert.ok(real.every((row) => Number(row.is_real) === 1));
      assert.ok(real.every((row) => row.transmission == null || row.transmission === ""));
      assert.ok(real.every((row) => row.seats == null));

      const s1 = real.find((row) => row.registration === "S1 EOH");
      assert.ok(s1);
      assert.equal(s1.make, "BMW");

      const premiers = real.filter((row) => (row.model || "").includes("PREMIER"));
      assert.ok(premiers.length >= 3);
      const premierRegs = new Set(premiers.map((row) => row.registration));
      assert.equal(premierRegs.size, premiers.length);

      const classes = new Set(real.map((row) => row.vehicle_class));
      assert.ok(classes.has("car"));
      assert.ok(classes.has("van"));
      assert.ok(classes.has("motorcycle"));
      assert.ok(classes.has("campervan"));
      assert.ok(classes.has("wheelchair_accessible_taxi"));

      const listed = listFleet();
      assert.equal(listed.filter((row) => Number(row.is_real) === 1).length, 45);
      assert.equal(listed.filter((row) => Number(row.is_real) !== 1).length, 10);

      db.prepare(`DELETE FROM reservations WHERE fleet_vehicle_id IN (SELECT id FROM fleet_vehicles WHERE is_real = 0)`).run();
      db.prepare(`DELETE FROM hire_episodes WHERE fleet_vehicle_id IN (SELECT id FROM fleet_vehicles WHERE is_real = 0)`).run();
      db.prepare(`DELETE FROM fleet_vehicles WHERE is_real = 0`).run();
      const remainingReal = db.prepare(`SELECT COUNT(*) AS c FROM fleet_vehicles WHERE is_real = 1`).get() as { c: number };
      assert.equal(Number(remainingReal.c), 45);
    });
    db.close();
  });

  it("adds, edits and soft-removes a vehicle without deleting booking history", () => {
    const db = prepared();
    withDatabase(db, () => {
      const id = createFleetVehicle({
        registration: "S7 EOH",
        make: "TESTMAKE",
        model: "TESTMODEL",
        colour: "BLUE",
        fuel: "petrol",
        firstRegisteredOn: "2020-01-15",
        vehicleClass: "car",
        transmission: "manual",
        seats: 5,
        location: "CAS yard",
        notes: "Added in test",
      });
      const created = getFleetVehicle(id);
      assert.equal(created?.registration, "S7 EOH");
      assert.equal(Number(created?.is_real), 1);
      assert.equal(created?.transmission, "manual");

      updateFleetVehicle(id, {
        registration: "S7 EOH",
        make: "TESTMAKE",
        model: "TESTMODEL",
        colour: "RED",
        fuel: "petrol",
        firstRegisteredOn: "2020-01-15",
        vehicleClass: "car",
        transmission: "automatic",
        seats: 5,
        location: "CAS yard",
        notes: "Colour corrected",
      });
      assert.equal(getFleetVehicle(id)?.colour, "RED");
      assert.equal(getFleetVehicle(id)?.transmission, "automatic");

      createReservation({
        fleetVehicleId: id,
        startAt: "2024-01-01T09:00:00.000Z",
        endAt: "2024-01-05T18:00:00.000Z",
        kind: "staff",
        createdBy: "staff-justin",
      });
      const pastBooking = db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE fleet_vehicle_id = ?`).get(id) as { c: number };
      assert.equal(Number(pastBooking.c), 1);

      removeFleetVehicle(id, { reason: "Sold" });
      const removed = getFleetVehicle(id);
      assert.ok(removed?.removed_at);
      assert.equal(removed?.status, "removed");
      assert.equal(listFleet().some((row) => row.id === id), false);
      assert.equal(listFleet({ includeRemoved: true }).some((row) => row.id === id), true);
      const history = db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE fleet_vehicle_id = ?`).get(id) as { c: number };
      assert.equal(Number(history.c), 1);

      assert.throws(
        () =>
          createReservation({
            fleetVehicleId: id,
            startAt: "2027-01-01T09:00:00.000Z",
            endAt: "2027-01-05T18:00:00.000Z",
            kind: "staff",
            createdBy: "staff-justin",
          }),
        /removed from the fleet/,
      );
    });
    db.close();
  });

  it("keeps a stored V5C document after the vehicle details are edited", () => {
    const db = prepared();
    withDatabase(db, () => {
      const id = createFleetVehicle({
        registration: "AB12 CDE",
        make: "FORD",
        model: "FOCUS",
        colour: "WHITE",
        fuel: "petrol",
        firstRegisteredOn: "2018-03-01",
        vehicleClass: "car",
        transmission: "",
        location: "CAS yard",
        notes: "",
      });
      const vehicle = getFleetVehicle(id)!;
      const docId = attachV5cBuffer({
        fleetVehicleId: id,
        vehicleId: String(vehicle.vehicle_id),
        originalFilename: "AB12CDE-V5C.pdf",
        buffer: fixturePdf,
      });
      const before = listFleetVehicleDocuments(id);
      assert.equal(before.length, 1);
      assert.equal(before[0].id, docId);
      assert.ok(before[0].stored_relpath);
      assert.equal(storedFileExists(String(before[0].stored_relpath)), true);

      updateFleetVehicle(id, {
        registration: "AB12 CDE",
        make: "FORD",
        model: "FOCUS TITANIUM",
        colour: "WHITE",
        fuel: "petrol",
        firstRegisteredOn: "2018-03-01",
        vehicleClass: "car",
        transmission: "manual",
        seats: 5,
        location: "CAS yard",
        notes: "Model expanded",
      });

      const after = listFleetVehicleDocuments(id);
      assert.equal(after.length, 1);
      assert.equal(after[0].id, docId);
      assert.equal(after[0].stored_relpath, before[0].stored_relpath);
      assert.equal(storedFileExists(String(after[0].stored_relpath)), true);
      assert.equal(getFleetVehicle(id)?.model, "FOCUS TITANIUM");
    });
    db.close();
  });

  it("warns and blocks removing a vehicle with an active reservation unless confirmed", () => {
    const db = prepared();
    withDatabase(db, () => {
      const id = createFleetVehicle({
        registration: "CD34 FGH",
        make: "VAUXHALL",
        model: "ASTRA",
        colour: "GREY",
        fuel: "petrol",
        firstRegisteredOn: "2019-06-01",
        vehicleClass: "car",
        transmission: "",
        location: "CAS yard",
        notes: "",
      });
      createReservation({
        fleetVehicleId: id,
        startAt: "2027-03-01T09:00:00.000Z",
        endAt: "2027-03-10T18:00:00.000Z",
        kind: "hire",
        createdBy: "staff-justin",
      });
      assert.equal(listBlockingReservations(id).length, 1);
      assert.throws(() => removeFleetVehicle(id), FleetRemoveBlockedError);
      assert.equal(getFleetVehicle(id)?.removed_at, null);

      removeFleetVehicle(id, { confirmDespiteReservations: true });
      assert.ok(getFleetVehicle(id)?.removed_at);
      const kept = db.prepare(`SELECT status, end_at FROM reservations WHERE fleet_vehicle_id = ?`).get(id) as {
        status: string;
        end_at: string;
      };
      assert.equal(kept.status, "reserved");
      assert.equal(kept.end_at, "2027-03-10T18:00:00.000Z");
    });
    db.close();
  });

  it("stores the original V5C PDFs when the source folder is present", () => {
    if (!fs.existsSync(DEFAULT_V5C_SOURCE_DIR)) {
      assert.fail(`V5C source folder is not readable: ${DEFAULT_V5C_SOURCE_DIR}`);
    }
    const db = prepared();
    const previous = process.env.CAS_V5C_SOURCE_DIR;
    process.env.CAS_V5C_SOURCE_DIR = DEFAULT_V5C_SOURCE_DIR;
    try {
      withDatabase(db, () => {
        ensureRealFleet(db);
        const docs = db
          .prepare(
            `SELECT d.original_filename, d.stored_relpath, d.document_type
             FROM documents d
             JOIN fleet_vehicles fv ON fv.id = d.fleet_vehicle_id
             WHERE fv.is_real = 1 AND d.document_type = 'V5C'`,
          )
          .all() as Array<{ original_filename: string; stored_relpath: string; document_type: string }>;
        assert.equal(docs.length, 45);
        assert.ok(docs.every((doc) => storedFileExists(doc.stored_relpath)));
        assert.ok(docs.every((doc) => doc.original_filename.toLowerCase().endsWith(".pdf")));
      });
    } finally {
      process.env.CAS_V5C_SOURCE_DIR = previous;
      db.close();
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { withDatabase, get } from "../src/lib/db/connection.ts";
import { logHireAgreementRenewal } from "../src/lib/db/chronology.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  cancelHireCar,
  chooseHireCar,
  completeHireHandover,
  loadHireArea,
  saveHireNeed,
  setHireDailyRate,
} from "../src/lib/db/hire-choice.ts";
import { recordPrehireOverride } from "../src/lib/db/prehire-checks.ts";
import { hireDaysOverlap } from "../src/lib/domain/hire-availability.ts";
import { agreementDayNumber } from "../src/lib/domain/rules.ts";
import { londonDateIso } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-hire-flow-"));

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function count(db: DatabaseSync, sql: string, args: string[] = []) {
  const row = db.prepare(sql).get(...args) as { n: number } | undefined;
  return Number(row?.n || 0);
}

describe("hire availability", () => {
  it("treats the same London day as an overlap and the next day as free", () => {
    assert.equal(
      hireDaysOverlap("2026-10-20T09:00:00.000Z", "2026-10-27T17:00:00.000Z", "2026-10-27T18:00:00.000Z", "2026-10-28T09:00:00.000Z"),
      true,
    );
    assert.equal(
      hireDaysOverlap("2026-10-20T09:00:00.000Z", "2026-10-27T17:00:00.000Z", "2026-10-28T08:00:00.000Z", "2026-10-30T09:00:00.000Z"),
      false,
    );
  });
});

describe("joined-up hire", () => {
  it("reserves once, rejects a clash, starts hire on handover, and keeps one history through a swap and a renewal", () => {
    const db = prepared();
    withDatabase(db, () => {
      const claims = db
        .prepare(
          `SELECT id, file_reference FROM claims
           WHERE claim_type = 'non_fault'
             AND file_reference NOT IN ('TEST-0005', 'TEST-0006', 'TEST-0007', 'TEST-0009')
           ORDER BY file_reference
           LIMIT 2`,
        )
        .all() as Array<{ id: string; file_reference: string }>;
      assert.equal(claims.length, 2);
      const firstId = String(claims[0]?.id || "");
      const secondId = String(claims[1]?.id || "");
      if (!firstId || !secondId) throw new Error("No non-fault test claims.");
      const car = db
        .prepare(`SELECT fv.id, v.registration FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.status = 'available' AND fv.removed_at IS NULL ORDER BY v.registration LIMIT 1`)
        .get() as { id: string; registration: string } | undefined;
      if (!car) throw new Error("No free car.");
      const other = db
        .prepare(
          `SELECT fv.id FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id
           WHERE fv.status = 'available' AND fv.removed_at IS NULL AND fv.id != ? ORDER BY v.registration LIMIT 1`,
        )
        .get(car.id) as { id: string } | undefined;
      if (!other) throw new Error("No second free car.");

      for (const claim of claims) {
        saveHireNeed({ claimId: claim.id, choice: "yes", reason: "", actorId: "staff-sian", submitKey: `need-${claim.id}` });
        recordPrehireOverride({ claimId: claim.id, actorId: "staff-justin", checkKind: "licence", reason: "Journey test override." });
        recordPrehireOverride({ claimId: claim.id, actorId: "staff-justin", checkKind: "bank", reason: "Journey test override." });
      }

      const beforeEvents = count(db, `SELECT COUNT(*) AS n FROM claim_events`);
      const opened = loadHireArea(firstId, { date: "2026-11-02", transmission: "", seats: "" });
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM claim_events`), beforeEvents);
      assert.equal(opened?.cars.some((item) => item.id === car.id), true);

      const chosen = chooseHireCar({
        claimId: firstId,
        fleetVehicleId: car.id,
        method: "deliver",
        date: "2026-11-02",
        time: "09:30",
        address: "1 Test Street, Cardiff",
        actorId: "staff-sian",
        submitKey: "choose-once",
        driverId: "staff-driver",
      });
      chooseHireCar({
        claimId: firstId,
        fleetVehicleId: car.id,
        method: "deliver",
        date: "2026-11-02",
        time: "09:30",
        address: "1 Test Street, Cardiff",
        actorId: "staff-sian",
        submitKey: "choose-once",
        driverId: "staff-driver",
      });
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM reservations WHERE claim_id = ? AND status = 'reserved'`, [firstId]), 1);
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM day_assignments WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL`, [firstId]), 1);
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND event_type = 'hire_vehicle_reserved'`, [firstId]), 1);
      const held = db.prepare(`SELECT charges_started FROM reservations WHERE id = ?`).get(chosen.reservationId) as { charges_started: number };
      assert.equal(Number(held.charges_started), 0);
      const job = db
        .prepare(`SELECT assignee_id, place_text, planned_at FROM day_assignments WHERE id = ?`)
        .get(chosen.jobId) as { assignee_id: string; place_text: string; planned_at: string };
      assert.equal(job.assignee_id, "staff-driver");
      assert.equal(job.place_text, "1 Test Street, Cardiff");
      assert.ok(job.planned_at);

      const offered = loadHireArea(secondId, { date: "2026-11-02", transmission: "", seats: "" });
      assert.equal(offered?.cars.some((item) => item.id === car.id), false);
      assert.throws(
        () =>
          chooseHireCar({
            claimId: secondId,
            fleetVehicleId: car.id,
            method: "collect",
            date: "2026-11-02",
            time: "10:00",
            address: "",
            actorId: "staff-sian",
            submitKey: "clash",
          }),
        /This car has just been booked on/,
      );

      const bare = db
        .prepare(
          `SELECT c.id FROM claims c
           WHERE c.file_reference NOT IN ('TEST-0005', 'TEST-0006', 'TEST-0007', 'TEST-0009')
             AND NOT EXISTS (
               SELECT 1 FROM hire_episodes he WHERE he.claim_id = c.id AND he.started_at IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM reservations r WHERE r.claim_id = c.id AND r.status IN ('reserved', 'active')
             )
           LIMIT 1`,
        )
        .get() as { id: string } | undefined;
      if (!bare) throw new Error("No claim without a hire.");
      assert.throws(
        () =>
          completeHireHandover({
            claimId: bare.id,
            mileage: 10,
            fuelLevel: "full",
            driverId: "staff-driver",
            date: "2026-11-02",
            time: "10:00",
            actorId: "staff-sian",
            submitKey: "handover-empty",
          }),
        /Choose a car/,
      );

      setHireDailyRate({ claimId: firstId, group: "S3", actorId: "staff-sian", submitKey: "rate-first" });
      const started = completeHireHandover({
        signedCopy: { buffer: Buffer.from("%PDF-1.4"), filename: "signed.pdf", mimeType: "application/pdf" },
        claimId: firstId,
        mileage: 1200,
        fuelLevel: "full",
        driverId: "staff-driver",
        date: "2026-10-01",
        time: "09:00",
        actorId: "staff-sian",
        submitKey: "handover-first",
      });
      const episode = db.prepare(`SELECT started_at, fleet_vehicle_id, rate_pence_per_day FROM hire_episodes WHERE id = ?`).get(chosen.episodeId) as {
        started_at: string;
        fleet_vehicle_id: string;
        rate_pence_per_day: number | null;
      };
      assert.equal(episode.started_at, started.startedAt);
      assert.equal(londonDateIso(new Date(episode.started_at)), "2026-10-01");
      const fleet = db.prepare(`SELECT status FROM fleet_vehicles WHERE id = ?`).get(car.id) as { status: string };
      assert.equal(fleet.status, "on_hire");
      const steps = loadClaimSteps(firstId);
      if (!steps) throw new Error("Steps were not on the file.");
      const hire = steps.find((step) => step.key === "hire");
      if (!hire) throw new Error("Step 3 was missing.");
      assert.equal(hire.state, "done");
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND event_type = 'hire_started'`, [firstId]), 1);

      const rateBefore = episode.rate_pence_per_day;
      chooseHireCar({
        claimId: firstId,
        fleetVehicleId: other.id,
        method: "deliver",
        date: "2026-11-03",
        time: "11:00",
        address: "1 Test Street, Cardiff",
        actorId: "staff-sian",
        submitKey: "swap",
      });
      const afterSwap = db.prepare(`SELECT started_at, fleet_vehicle_id, rate_pence_per_day FROM hire_episodes WHERE id = ?`).get(chosen.episodeId) as {
        started_at: string;
        fleet_vehicle_id: string;
        rate_pence_per_day: number | null;
      };
      assert.equal(afterSwap.started_at, episode.started_at);
      assert.equal(afterSwap.fleet_vehicle_id, other.id);
      assert.equal(afterSwap.rate_pence_per_day, rateBefore);
      const freed = db.prepare(`SELECT status FROM fleet_vehicles WHERE id = ?`).get(car.id) as { status: string };
      assert.equal(freed.status, "available");
      const day = agreementDayNumber("2026-10-01", "2026-10-27");
      logHireAgreementRenewal({ claimId: firstId, actorId: "staff-sian", occurredAt: "2026-10-27T10:00" });
      const still = get<{ started_at: string }>(`SELECT started_at FROM hire_episodes WHERE id = ?`, [chosen.episodeId]);
      assert.equal(still?.started_at, episode.started_at);
      assert.equal(agreementDayNumber(londonDateIso(new Date(String(still?.started_at))), "2026-10-27"), day);
      assert.ok(day > 1);
    });
    db.close();
  });

  it("leaves step 3 open for not yet, and closes it when hire is not needed", () => {
    const db = prepared();
    withDatabase(db, () => {
      const claimId = String((db
        .prepare(
          `SELECT id FROM claims WHERE claim_type = 'non_fault' AND file_reference NOT IN ('TEST-0005', 'TEST-0006', 'TEST-0007', 'TEST-0009') ORDER BY file_reference LIMIT 1`,
        )
        .get() as { id?: string } | undefined)?.id || "");
      if (!claimId) throw new Error("No non-fault test claim.");
      saveHireNeed({ claimId, choice: "not_yet", reason: "", actorId: "staff-sian", submitKey: "not-yet" });
      const openSteps = loadClaimSteps(claimId);
      if (!openSteps) throw new Error("Steps were not on the file.");
      const open = openSteps.find((step) => step.key === "hire");
      if (!open) throw new Error("Step 3 was missing.");
      assert.equal(open.state, "to_do");
      assert.match(open.detail || "", /Not yet – client keeps own car/);
      saveHireNeed({ claimId, choice: "not_needed", reason: "Client has another car.", actorId: "staff-sian", submitKey: "not-needed" });
      const closedSteps = loadClaimSteps(claimId);
      if (!closedSteps) throw new Error("Steps were not on the file.");
      const closed = closedSteps.find((step) => step.key === "hire");
      if (!closed) throw new Error("Step 3 was missing.");
      assert.equal(closed.state, "not_needed");
      cancelHireCar({ claimId, actorId: "staff-sian", submitKey: "cancel-none" });
    });
    db.close();
  });
});

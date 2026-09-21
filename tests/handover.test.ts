import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { generateHireAgreementDocument } from "../src/lib/db/hire-agreement.ts";
import {
  addHandoverPhotographs,
  handoverIncomplete,
  listVehicleHandovers,
  recordVehicleHandover,
} from "../src/lib/db/handover.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function handover(overrides: Record<string, string> = {}) {
  return {
    claimId: "c3",
    eventKind: "hire_delivered",
    hireEpisodeId: "h-c3",
    mileage: "12345",
    fuelLevel: "half",
    spareWheel: "yes",
    toolsPresent: "yes",
    warningLightsOff: "yes",
    tyresLegal: "yes",
    conditionNote: "Scuff on the rear bumper.",
    actorId: "staff-sian",
    photos: [],
    ...overrides,
  };
}

describe("vehicle handover records", () => {
  it("saves a handover without photographs and marks it incomplete", () => {
    const db = prepared();
    withDatabase(db, () => {
      const saved = recordVehicleHandover(handover());
      assert.equal(saved.incomplete, true);
      assert.equal(handoverIncomplete(0), true);
      const rows = listVehicleHandovers("c3");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].mileage, 12345);
      assert.equal(rows[0].fuelLabel, "½");
      assert.equal(rows[0].incomplete, true);
      assert.equal(rows[0].recordedByName.length > 0, true);
    });
    db.close();
  });

  it("keeps the original handover when a correction is recorded as a new entry", () => {
    const db = prepared();
    withDatabase(db, () => {
      const first = recordVehicleHandover(handover({ mileage: "1000", conditionNote: "First reading." }));
      recordVehicleHandover(handover({ mileage: "1004", conditionNote: "Correction: the first mileage was misread." }));
      const rows = listVehicleHandovers("c3");
      assert.equal(rows.length, 2);
      const original = rows.find((row) => row.id === first.id);
      assert.equal(original?.mileage, 1000);
      assert.match(original?.conditionNote || "", /First reading/);
    });
    db.close();
  });

  it("adds photographs later without changing the locked mileage", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const saved = recordVehicleHandover(handover({ mileage: "5555" }));
        const added = addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-tom",
          photos: [{ buffer: Buffer.from("not-a-real-image"), filename: "bumper.png", mimeType: "image/png" }],
        });
        assert.equal(added.incomplete, false);
        const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.mileage, 5555);
        assert.equal(row?.photos.length, 1);
        assert.equal(row?.incomplete, false);
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the latest handover mileage and fuel on the hire agreement and storage page", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(
        `INSERT INTO hire_episodes(id, claim_id, fleet_vehicle_id, started_at, like_for_like, credit_hire)
         VALUES ('h-c3-swap', 'c3', 'fv-1', '2026-09-20T10:00:00.000Z', 1, 1)`,
      ).run();
      recordVehicleHandover(handover({ hireEpisodeId: "h-c3", mileage: "11111", fuelLevel: "empty" }));
      recordVehicleHandover(handover({ hireEpisodeId: "h-c3-swap", mileage: "22222", fuelLevel: "half" }));
      recordVehicleHandover(
        handover({
          eventKind: "client_recovered",
          hireEpisodeId: "",
          mileage: "88000",
          fuelLevel: "quarter",
          conditionNote: "Recovered from the scene.",
        }),
      );
      const result = generateHireAgreementDocument("c3", "staff-sian", 6653);
      const html = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(result.documentId) as { body_html: string }).body_html);
      assert.match(html, /Mileage at delivery: 22,222/);
      assert.match(html, /Fuel level at delivery: ½/);
      assert.equal(html.includes("11,111"), false);
      assert.match(html, /Mileage: 88,000/);
      assert.match(html, /Fuel: ¼/);
    });
    db.close();
  });

  it("does not put the retired paper-form fields on the handover screen", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/handover/page.tsx"), "utf8");
    const pack = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/hire-pack/page.tsx"), "utf8");
    for (const source of [page, pack]) {
      assert.doesNotMatch(source, /tyre depth/i);
      assert.doesNotMatch(source, /tax disc/i);
      assert.doesNotMatch(source, /cd magazine/i);
      assert.doesNotMatch(source, /sat nav disc/i);
      assert.doesNotMatch(source, /<canvas/i);
    }
    assert.match(page, /Mileage/);
    assert.match(page, /Fuel level/);
    assert.match(page, /Tyres visibly legal/);
  });
});

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
  attachHandoverScan,
  handoverIncomplete,
  listVehicleHandovers,
  missingStandardShots,
  recordVehicleHandover,
  STANDARD_SHOTS,
} from "../src/lib/db/handover.ts";
import { readStoredFile } from "../src/lib/storage/files.ts";
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

function shot(slot: string, name = slot) {
  return { buffer: Buffer.from(slot), filename: `${name}.jpg`, mimeType: "image/jpeg", slot };
}

function fiveShots() {
  return STANDARD_SHOTS.map((item) => shot(item.slot));
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
      assert.equal(handoverIncomplete([]), true);
      assert.equal(missingStandardShots(["front", "rear"]).map((item) => item.slot).join(","), "driver_side,passenger_side,interior");
      assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "damage"]), false);
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
        const partial = addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-tom",
          photos: [shot("front"), shot("damage", "bumper")],
        });
        assert.equal(partial.incomplete, true);
        const added = addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-tom",
          photos: fiveShots().filter((photo) => photo.slot !== "front"),
        });
        assert.equal(added.incomplete, false);
        const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.mileage, 5555);
        assert.equal(row?.photos.some((photo) => photo.slot === "damage"), true);
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

  it("stays incomplete until the five standard shots are present, and treats damage photographs as optional", () => {
    assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side"]), true);
    assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior"]), false);
    assert.equal(handoverIncomplete(["damage", "damage"]), true);
    assert.deepEqual(
      missingStandardShots(["damage"]).map((shot) => shot.label),
      ["Front", "Rear", "Driver's side", "Passenger's side", "Interior"],
    );
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
    assert.doesNotMatch(page, /Spare wheel present/);
    assert.doesNotMatch(page, /Tools present/);
    assert.doesNotMatch(page, /Warning lights off/);
    assert.doesNotMatch(page, /Tyres visibly legal/);
    assert.match(page, /Pre-diagnostic scan/);
    assert.match(page, /Post-diagnostic scan/);
    assert.match(page, /capture="environment"/);
    assert.match(page, /Open camera/);
    assert.match(page, /Not taken yet/);
    assert.match(page, /Damage photos/);
    assert.match(page, /Or choose a saved photo/);
    assert.match(page, /STANDARD_SHOTS/);
    assert.doesNotMatch(page, /<label[^>]*>[\s\S]{0,120}capture="environment"/);
    const shots = fs.readFileSync(path.join(process.cwd(), "src/lib/db/handover.ts"), "utf8");
    for (const label of ["Front", "Rear", "Driver's side", "Passenger's side", "Interior"]) {
      assert.match(shots, new RegExp(label.replace("'", "\\'")));
    }
    assert.match(page, /Or choose a saved scan file/);
    const shell = fs.readFileSync(path.join(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    assert.match(shell, /md:grid md:grid-cols-\[240px_1fr\]/);
    assert.match(shell, /md:hidden/);
    const claims = fs.readFileSync(path.join(process.cwd(), "src/components/ClaimTable.tsx"), "utf8");
    assert.match(claims, /md:hidden/);
    assert.match(claims, /\/handover/);
  });

  it("leaves the incomplete flag tied to photographs when no diagnostic scan is attached", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-noscan-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const saved = recordVehicleHandover(handover({ mileage: "4242" }));
        assert.equal(saved.incomplete, true);
        let row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.scans.length, 0);
        assert.equal(row?.incomplete, true);
        assert.equal(row?.mileage, 4242);
        const added = addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-sian",
          photos: fiveShots(),
        });
        assert.equal(added.incomplete, false);
        row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.incomplete, false);
        assert.equal(row?.scans.length, 0);
        assert.equal(row?.mileage, 4242);
        assert.equal(handoverIncomplete((row?.photos || []).map((photo) => photo.slot)), false);
        const damageOnly = recordVehicleHandover({
          ...handover({ mileage: "4243" }),
          photos: [shot("damage", "scratch")],
        });
        assert.equal(damageOnly.incomplete, true);
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("attaches a diagnostic scan and retrieves the stored file without clearing incomplete", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-scan-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const body = Buffer.from("DTC P0300 stored before handover");
        const saved = recordVehicleHandover({
          ...handover({ mileage: "7777" }),
          preScan: { buffer: body, filename: "pre-scan.txt", mimeType: "text/plain" },
        });
        assert.equal(saved.incomplete, true);
        let row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.mileage, 7777);
        assert.equal(row?.incomplete, true);
        assert.equal(row?.scans.length, 1);
        const pre = row?.scans.find((scan) => scan.slot === "pre");
        assert.equal(pre?.filename, "pre-scan.txt");
        const stored = db.prepare(`SELECT document_type, mime_type, stored_relpath FROM documents WHERE id = ?`).get(pre?.documentId) as {
          document_type: string;
          mime_type: string;
          stored_relpath: string;
        };
        assert.equal(stored.document_type, "handover_scan");
        assert.equal(stored.mime_type, "text/plain");
        assert.equal(readStoredFile(stored.stored_relpath).buffer.toString("utf8"), body.toString("utf8"));

        const postBody = Buffer.from("%PDF-1.4 post scan");
        const attached = attachHandoverScan({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-tom",
          slot: "post",
          file: { buffer: postBody, filename: "post-scan.pdf", mimeType: "application/pdf" },
        });
        assert.equal(attached.incomplete, true);
        row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.mileage, 7777);
        assert.equal(row?.photos.length, 0);
        assert.equal(row?.incomplete, true);
        const post = row?.scans.find((scan) => scan.slot === "post");
        const postStored = db.prepare(`SELECT stored_relpath, mime_type FROM documents WHERE id = ?`).get(post?.documentId) as {
          stored_relpath: string;
          mime_type: string;
        };
        assert.equal(postStored.mime_type, "application/pdf");
        assert.equal(readStoredFile(postStored.stored_relpath).buffer.toString("utf8"), postBody.toString("utf8"));
        assert.throws(
          () =>
            attachHandoverScan({
              claimId: "c3",
              handoverId: saved.id,
              actorId: "staff-tom",
              slot: "pre",
              file: { buffer: Buffer.from("again"), filename: "again.txt", mimeType: "text/plain" },
            }),
          /already on this locked record/,
        );
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

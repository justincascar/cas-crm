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
  finishVehicleHandover,
  focusAfterShot,
  handoverIncomplete,
  listVehicleHandovers,
  MAX_DAMAGE_PHOTOS,
  missingStandardShots,
  ORIGINAL_SHOTS,
  requiredShotProgress,
  recordVehicleHandover,
  SHOT_SET_FIVE,
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

function requiredShots() {
  return STANDARD_SHOTS.map((item) => shot(item.slot));
}

function originalShots() {
  return ORIGINAL_SHOTS.map((item) => shot(item.slot));
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
      assert.equal(
        missingStandardShots(["front", "rear"]).map((item) => item.slot).join(","),
        "driver_side,passenger_side,interior,dash,chassis",
      );
      assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "damage"]), true);
      assert.equal(
        handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "damage"], SHOT_SET_FIVE),
        false,
      );
      assert.equal(
        handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "dash", "chassis", "damage"]),
        false,
      );
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
          photos: requiredShots().filter((photo) => photo.slot !== "front"),
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

  it("stays incomplete until the seven standard shots are present, and treats damage photographs as optional", () => {
    assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior"]), true);
    assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "dash"]), true);
    assert.equal(handoverIncomplete(["front", "rear", "driver_side", "passenger_side", "interior", "dash", "chassis"]), false);
    assert.equal(handoverIncomplete(["damage", "damage"]), true);
    assert.deepEqual(
      missingStandardShots(["damage"]).map((item) => item.label),
      ["Front", "Rear", "Driver's side", "Passenger's side", "Interior", "Dash", "Chassis number"],
    );
  });

  it("moves on to the next standard shot and caps damage photographs at six", () => {
    assert.equal(focusAfterShot("front", ["front"]), "rear");
    assert.equal(focusAfterShot("rear", ["front", "rear"]), "driver_side");
    assert.equal(focusAfterShot("interior", ["front", "rear", "driver_side", "passenger_side", "interior"]), "dash");
    assert.equal(
      focusAfterShot("dash", ["front", "rear", "driver_side", "passenger_side", "interior", "dash"]),
      "chassis",
    );
    assert.equal(
      focusAfterShot("chassis", ["front", "rear", "driver_side", "passenger_side", "interior", "dash", "chassis"]),
      "finish",
    );
    assert.equal(
      focusAfterShot("interior", ["front", "rear", "driver_side", "passenger_side", "interior"], SHOT_SET_FIVE),
      "finish",
    );
    assert.equal(MAX_DAMAGE_PHOTOS, 6);
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-cap-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const own = recordVehicleHandover(
          handover({ eventKind: "client_returned", hireEpisodeId: "", mileage: "44000", fuelLevel: "full" }),
        );
        const listed = listVehicleHandovers("c3").find((row) => row.id === own.id);
        assert.equal(listed?.hireEpisodeId, null);
        assert.match(listed?.eventLabel || "", /Customer's vehicle — returned after repair/);
        assert.match(listed?.bookingLabel || "", /SA12 CWA/);
        const saved = recordVehicleHandover(handover());
        addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-sian",
          photos: [shot("front")],
        });
        assert.throws(
          () =>
            addHandoverPhotographs({
              claimId: "c3",
              handoverId: saved.id,
              actorId: "staff-sian",
              photos: [shot("front", "front-again")],
            }),
          /Front is already photographed/,
        );
        addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-sian",
          photos: Array.from({ length: 6 }, (_, index) => shot("damage", `damage-${index}`)),
        });
        assert.throws(
          () =>
            addHandoverPhotographs({
              claimId: "c3",
              handoverId: saved.id,
              actorId: "staff-sian",
              photos: [shot("damage", "damage-extra")],
            }),
          /6 damage photographs/,
        );
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finishes a hire car once the five standard shots are saved, without a damage photograph", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-finish-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const saved = recordVehicleHandover(handover());
        assert.equal(listVehicleHandovers("c3").find((row) => row.id === saved.id)?.shotSet, "five");
        assert.throws(
          () => finishVehicleHandover({ claimId: "c3", handoverId: saved.id, actorId: "staff-sian" }),
          /before finishing/,
        );
        const added = addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-sian",
          photos: originalShots(),
        });
        assert.equal(added.incomplete, false);
        assert.equal(requiredShotProgress(originalShots().map((photo) => photo.slot), "five").label, "5 of 5 done");
        const finished = finishVehicleHandover({ claimId: "c3", handoverId: saved.id, actorId: "staff-sian" });
        const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.incomplete, false);
        assert.equal(row?.photos.some((photo) => photo.slot === "dash" || photo.slot === "chassis"), false);
        assert.equal(row?.photos.some((photo) => photo.slot === "damage"), false);
        assert.equal(row?.finishedAt, finished.finishedAt);
        const again = finishVehicleHandover({ claimId: "c3", handoverId: saved.id, actorId: "staff-sian" });
        assert.equal(again.finishedAt, finished.finishedAt);
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finishes a hire car after five shots and the customer's vehicle only after seven", () => {
    const hireOrder = ["front", "rear", "driver_side", "passenger_side", "interior"];
    let hireTaken: string[] = [];
    for (const slot of hireOrder) {
      assert.equal(requiredShotProgress(hireTaken, "five").label, `${hireTaken.length} of 5 done`);
      hireTaken = [...hireTaken, slot];
      const next = focusAfterShot(slot, hireTaken, "five");
      assert.equal(next, slot === "interior" ? "finish" : hireOrder[hireOrder.indexOf(slot) + 1]);
    }
    assert.equal(requiredShotProgress(hireTaken, "five").label, "5 of 5 done");
    assert.equal(focusAfterShot("interior", hireTaken, "five"), "finish");

    const ownOrder = [...hireOrder, "dash", "chassis"];
    let ownTaken: string[] = [];
    for (const slot of ownOrder) {
      assert.equal(requiredShotProgress(ownTaken, "seven").label, `${ownTaken.length} of 7 done`);
      ownTaken = [...ownTaken, slot];
      const next = focusAfterShot(slot, ownTaken, "seven");
      assert.equal(next, slot === "chassis" ? "finish" : ownOrder[ownOrder.indexOf(slot) + 1]);
    }
    assert.equal(requiredShotProgress(ownTaken, "seven").label, "7 of 7 done");
    assert.equal(focusAfterShot("interior", hireTaken, "seven"), "dash");

    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-seven-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const hire = recordVehicleHandover(handover());
        const own = recordVehicleHandover(
          handover({ eventKind: "client_returned", hireEpisodeId: "", mileage: "88001", fuelLevel: "quarter" }),
        );
        assert.equal(listVehicleHandovers("c3").find((row) => row.id === hire.id)?.shotSet, "five");
        assert.equal(listVehicleHandovers("c3").find((row) => row.id === own.id)?.shotSet, "seven");
        const hireDone = addHandoverPhotographs({
          claimId: "c3",
          handoverId: hire.id,
          actorId: "staff-sian",
          photos: originalShots(),
        });
        assert.equal(hireDone.incomplete, false);
        finishVehicleHandover({ claimId: "c3", handoverId: hire.id, actorId: "staff-sian" });
        const fiveOnly = addHandoverPhotographs({
          claimId: "c3",
          handoverId: own.id,
          actorId: "staff-sian",
          photos: originalShots(),
        });
        assert.equal(fiveOnly.incomplete, true);
        assert.equal(requiredShotProgress(hireOrder, "seven").label, "5 of 7 done");
        assert.throws(
          () => finishVehicleHandover({ claimId: "c3", handoverId: own.id, actorId: "staff-sian" }),
          /Dash, Chassis number/,
        );
        const done = addHandoverPhotographs({
          claimId: "c3",
          handoverId: own.id,
          actorId: "staff-sian",
          photos: [shot("dash"), shot("chassis")],
        });
        assert.equal(done.incomplete, false);
        finishVehicleHandover({ claimId: "c3", handoverId: own.id, actorId: "staff-sian" });
        const rows = listVehicleHandovers("c3");
        const hireRow = rows.find((row) => row.id === hire.id);
        const ownRow = rows.find((row) => row.id === own.id);
        assert.equal(hireRow?.shotSet, "five");
        assert.equal(hireRow?.incomplete, false);
        assert.equal(hireRow?.photos.some((photo) => photo.slot === "dash" || photo.slot === "chassis"), false);
        assert.equal(ownRow?.eventKind, "client_returned");
        assert.equal(ownRow?.hireEpisodeId, null);
        assert.equal(ownRow?.shotSet, "seven");
        assert.equal(ownRow?.incomplete, false);
        assert.equal(ownRow?.photos.some((photo) => photo.slot === "chassis"), true);
        assert.equal(ownRow?.photos.some((photo) => photo.slot === "dash"), true);
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops each required shot from the outstanding list and leaves a finished handover with nothing left to take", () => {
    const order = ["front", "rear", "driver_side", "passenger_side", "interior", "dash", "chassis"];
    const labels = ["Front", "Rear", "Driver's side", "Passenger's side", "Interior", "Dash", "Chassis number"];
    let taken: string[] = [];
    assert.equal(requiredShotProgress(taken).label, "0 of 7 done");
    assert.deepEqual(requiredShotProgress(taken).outstanding.map((shot) => shot.label), labels);
    for (const slot of order) {
      taken = [...taken, slot];
      const progress = requiredShotProgress(taken);
      assert.equal(progress.done, taken.length);
      assert.equal(progress.total, 7);
      assert.equal(progress.label, `${taken.length} of 7 done`);
      assert.equal(progress.outstanding.some((shot) => shot.slot === slot), false);
      assert.deepEqual(progress.outstanding.map((shot) => shot.slot), order.slice(taken.length));
    }
    assert.equal(requiredShotProgress(taken).outstanding.length, 0);
    const five = requiredShotProgress(order.slice(0, 5), "five");
    assert.equal(five.label, "5 of 5 done");
    assert.equal(five.outstanding.length, 0);
    const finishedSeven = requiredShotProgress(order, "seven");
    assert.equal(finishedSeven.label, "7 of 7 done");
    assert.equal(finishedSeven.outstanding.length, 0);
    const withDamage = requiredShotProgress([...order.slice(0, 3), "damage", "damage"], "seven");
    assert.equal(withDamage.label, "3 of 7 done");
    assert.equal(withDamage.outstanding.some((shot) => shot.slot === "damage"), false);
  });

  it("leaves an already-completed five-shot handover complete, without asking for Dash or Chassis number", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-handover-old-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const saved = recordVehicleHandover(handover({ mileage: "33333" }));
        db.prepare(`UPDATE vehicle_handovers SET shot_set = 'five', finished_at = '2026-09-20T10:00:00.000Z' WHERE id = ?`).run(saved.id);
        addHandoverPhotographs({
          claimId: "c3",
          handoverId: saved.id,
          actorId: "staff-sian",
          photos: originalShots(),
        });
        const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
        assert.equal(row?.shotSet, "five");
        assert.equal(row?.incomplete, false);
        assert.equal(row?.finishedAt, "2026-09-20T10:00:00.000Z");
        assert.equal(missingStandardShots((row?.photos || []).map((photo) => photo.slot), row?.shotSet).length, 0);
        assert.equal(row?.photos.some((photo) => photo.slot === "dash" || photo.slot === "chassis"), false);
        const again = finishVehicleHandover({ claimId: "c3", handoverId: saved.id, actorId: "staff-sian" });
        assert.equal(again.finishedAt, "2026-09-20T10:00:00.000Z");
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not put the retired paper-form fields on the handover screen", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/handover/page.tsx"), "utf8");
    const start = fs.readFileSync(path.join(process.cwd(), "src/components/handover/HandoverStartForm.tsx"), "utf8");
    const camera = fs.readFileSync(path.join(process.cwd(), "src/components/handover/ShotCamera.tsx"), "utf8");
    const pack = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/hire-pack/page.tsx"), "utf8");
    for (const source of [page, pack, start]) {
      assert.doesNotMatch(source, /tyre depth/i);
      assert.doesNotMatch(source, /tax disc/i);
      assert.doesNotMatch(source, /cd magazine/i);
      assert.doesNotMatch(source, /sat nav disc/i);
      assert.doesNotMatch(source, /<canvas/i);
    }
    assert.match(start, /Mileage/);
    assert.match(start, /Fuel level/);
    assert.match(start, /Hire car/);
    assert.match(start, /Customer/);
    assert.doesNotMatch(page, /Spare wheel present/);
    assert.doesNotMatch(page, /Tools present/);
    assert.doesNotMatch(page, /Warning lights off/);
    assert.doesNotMatch(page, /Tyres visibly legal/);
    const shots = fs.readFileSync(path.join(process.cwd(), "src/lib/db/handover.ts"), "utf8");
    assert.match(shots, /Pre-diagnostic scan/);
    assert.match(shots, /Post-diagnostic scan/);
    assert.match(camera, /capture="environment"/);
    assert.match(page, /Open camera/);
    assert.match(page, /Add another damage photo/);
    assert.match(page, /Finish handover/);
    assert.match(page, /Damage photographs are optional/);
    assert.match(page, /progress\.label/);
    assert.doesNotMatch(page, /Not taken yet/);
    assert.match(page, /Damage photos/);
    assert.match(camera, /Or choose a saved photo/);
    assert.doesNotMatch(page, /STANDARD_SHOTS/);
    assert.doesNotMatch(camera, /<label[^>]*>[\s\S]{0,120}capture="environment"/);
    assert.doesNotMatch(page, /<label[^>]*>[\s\S]{0,120}capture="environment"/);
    for (const label of ["Front", "Rear", "Driver's side", "Passenger's side", "Interior", "Dash", "Chassis number"]) {
      assert.match(shots, new RegExp(label.replace("'", "\\'")));
    }
    assert.match(page, /shot-\$\{handoverId\}-\$\{shot\.slot\}/);
    assert.match(fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/handover/start/route.ts"), "utf8"), /shot-\$\{saved\.id\}-front/);
    assert.match(page, /shotsForSet/);
    assert.match(start, /Dash/);
    assert.match(start, /Chassis number/);
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
          photos: requiredShots(),
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

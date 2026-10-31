import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { ensureChaseSettings, ensureDemoChases } from "../src/lib/db/chase.ts";
import { generateClaimDocument, letterPreview, prepareOutstandingChase } from "../src/lib/db/chronology.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { ensureEngineers } from "../src/lib/db/engineers.ts";
import { fileSetupGapsFor, safeToDriveReasonsForClaim } from "../src/lib/db/file-setup.ts";
import { mapStoredFuelsOn } from "../src/lib/db/fuel-mapping.ts";
import { generateStorageRecoveryDocument } from "../src/lib/db/hire-pack.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { currentClaimStep } from "../src/lib/domain/claim-steps.ts";
import { damagePrintHtml } from "../src/lib/domain/damage-drawing.ts";
import {
  circumstancesSummary,
  damageZoneLabels,
  fileSetupGaps,
  parseDamageZones,
  suggestJurisdiction,
  suggestRoadworthiness,
} from "../src/lib/domain/file-setup.ts";
import { fuelChoice, fuelFromChoice, fuelLabel, normaliseFuel } from "../src/lib/domain/fuel.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-r50-"));
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  ensureEngineers(db);
  ensureChaseSettings(db);
  ensureDemoChases(db);
  return db;
}

/** A new claim in call order, as the form posts it. */
function callForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  const values: Record<string, string> = {
    client_forename: "Rhian",
    client_surname: "Callorder",
    client_postcode: "SA18 1DG",
    clientRole: "owner_driver",
    accidentDate: "2026-10-30",
    accidentTime: "16:20",
    location: "Station Road, Ammanford SA18 2DA",
    circumstances: "Client was stationary at the lights when the third party drove into the back of the car.",
    veh_registration: "CN16 AYS",
    veh_make: "Toyota",
    veh_fuel: "Diesel",
    damageZones: "rear_bumper,boot,nearside_rear_quarter",
    rqLights: "yes",
    rqSharp: "yes",
    rqLoose: "no",
    claimType: "",
    jurisdiction: "england_wales",
    roadworthiness: "unroadworthy",
    handlerId: "staff-sian",
    ...extra,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("R50 — file set-up last, from the facts", () => {
  it("suggests jurisdiction from the accident postcode, or the client's, and only England & Wales for an English or Welsh postcode", () => {
    assert.equal(suggestJurisdiction("Station Road, Ammanford SA18 2DA", "").value, "england_wales");
    assert.equal(suggestJurisdiction("Princes Street, Edinburgh EH2 2ER", "").value, "scotland");
    assert.equal(suggestJurisdiction("", "BT1 5GS").value, "northern_ireland");
    assert.match(suggestJurisdiction("", "BT1 5GS").text, /client's postcode/);
    assert.equal(suggestJurisdiction("A road near Berwick TD15 1AA", "").value, "not_known", "a border district does not settle it");
    assert.equal(suggestJurisdiction("somewhere on the M4", "").value, "not_known");
  });

  it("never decides liability, lists what is not yet known, and summarises the circumstances in one line", () => {
    assert.deepEqual(fileSetupGaps({ claimType: "", jurisdiction: "not_known", roadworthiness: "" }), ["liability status", "jurisdiction", "roadworthiness"]);
    assert.deepEqual(fileSetupGaps({ claimType: "disputed", jurisdiction: "england_wales", roadworthiness: "roadworthy" }), []);
    assert.equal(circumstancesSummary("  Rear-ended   at the lights. ".repeat(1)), "Rear-ended at the lights.");
    assert.ok(circumstancesSummary("x".repeat(400)).length <= 160);
  });

  it("saves with liability Not yet known, shows File set-up incomplete as the next step, and holds back what depends on it", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await createClaimFromIntake(intakeFromFormData(callForm()));
      const claimId = created.id;
      assert.deepEqual(fileSetupGapsFor(claimId), ["liability status"]);
      const step = currentClaimStep(loadClaimSteps(claimId) || []);
      assert.equal(step?.key, "details");
      assert.equal(step?.buttonLabel, "File set-up incomplete");
      assert.match(String(step?.statusText), /liability status not yet known/);
      assert.throws(() => generateClaimDocument({ claimId, templateKey: "initial_tp_insurer", actorId: "staff-sian" }), /File set-up incomplete: liability status/);
      assert.throws(() => letterPreview(claimId, "initial_tp_insurer"), /File set-up incomplete/);
      assert.throws(() => generateStorageRecoveryDocument(claimId, "staff-sian"), /File set-up incomplete/);
      assert.throws(() => prepareOutstandingChase({ claimId, actorId: "staff-sian", kind: "liability_response" }), /File set-up incomplete/);
      // Decided later on the File set-up screen.
      run(`UPDATE claims SET claim_type = 'non_fault' WHERE id = ?`, [claimId]);
      assert.deepEqual(fileSetupGapsFor(claimId), []);
      assert.notEqual(currentClaimStep(loadClaimSteps(claimId) || [])?.buttonLabel, "File set-up incomplete");
      assert.doesNotThrow(() => letterPreview(claimId, "initial_tp_insurer"));
    });
    db.close();
  });

  it("asks for a reason when staff choose a roadworthiness other than the one suggested", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      await assert.rejects(() => createClaimFromIntake(intakeFromFormData(callForm({ roadworthiness: "roadworthy" }))), /Say why you chose Roadworthy/);
      const created = await createClaimFromIntake(
        intakeFromFormData(callForm({ roadworthiness: "roadworthy", roadworthinessChangeReason: "Engineer saw it: cosmetic only." })),
      );
      const claimId = created.id;
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'roadworthiness_changed'`, [claimId]);
      assert.match(String(event?.details), /Changed from the suggestion \(Unroadworthy – lights smashed, sharp edges\)\. Reason: Engineer saw it: cosmetic only\./);
    });
    db.close();
  });
});

describe("R52 — damage drawing and safe-to-drive answers", () => {
  it("suggests Unroadworthy with the reasons from any Yes, and Roadworthy only when every answer is No", () => {
    assert.deepEqual(suggestRoadworthiness({ rqLights: "yes", rqSharp: "yes" }), { value: "unroadworthy", text: "Unroadworthy – lights smashed, sharp edges" });
    const allNo = Object.fromEntries(["rqLights", "rqLoose", "rqSharp", "rqGlass", "rqWheels", "rqWarning", "rqLeaking", "rqAirbags", "rqShut", "rqSteering"].map((key) => [key, "no"]));
    assert.equal(suggestRoadworthiness(allNo).value, "roadworthy");
    assert.equal(suggestRoadworthiness({ ...allNo, rqGlass: "not_known" }).value, "");
  });

  it("names the zones driver and passenger side, and keeps only real zones in drawing order", () => {
    assert.deepEqual(parseDamageZones("interior,nearside_front_door,bogus,front_bumper"), ["front_bumper", "nearside_front_door", "interior"]);
    assert.deepEqual(damageZoneLabels(["nearside_front_door", "offside_rear_wheel"]), ["Passenger side front door", "Driver side rear wheel"]);
    const print = damagePrintHtml(["bonnet"]);
    assert.match(print, /#DC002B/);
    assert.match(print, /Bonnet/);
  });

  it("stores the zones and answers as data, and carries them to the history, the engineer instruction and the recovery record", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const created = await createClaimFromIntake(intakeFromFormData(callForm({ claimType: "non_fault" })));
      const claimId = created.id;
      const screen = JSON.parse(String(get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = 'damage'`, [claimId])?.data_json));
      assert.equal(screen.clientZones, "boot,rear_bumper,nearside_rear_quarter");
      assert.equal(screen.rqLights, "yes");
      assert.equal(screen.rqLoose, "no");
      const history = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'damage_recorded'`, [claimId]);
      assert.match(String(history?.details), /Damage marked: Boot or tailgate, Rear bumper, Passenger side rear quarter\. Safe to drive – Yes to: lights smashed, sharp edges\./);
      assert.equal(get<{ r: string }>(`SELECT roadworthiness_reasons AS r FROM claims WHERE id = ?`, [claimId])?.r, "Unroadworthy – lights smashed, sharp edges");
      assert.deepEqual(safeToDriveReasonsForClaim(claimId), ["lights smashed", "sharp edges"]);
      const instruction = letterPreview(claimId, "engineer_instruction");
      assert.match(instruction.html, /Damage reported by the client/);
      assert.match(instruction.html, /<svg viewBox="0 0 320 560"/);
      assert.match(instruction.text, /Damage reported by the client: Boot or tailgate, Rear bumper, Passenger side rear quarter\./);
      assert.match(instruction.text, /Is it safe to drive – Yes to: lights smashed, sharp edges\./);
    });
    db.close();
  });
});

describe("R51 — one fuel list", () => {
  it("maps typed fuel onto the list, keeps an unclear one as Other, and treats blank as Not known", () => {
    assert.equal(normaliseFuel("petrol"), "Petrol");
    assert.equal(normaliseFuel("Diesel"), "Diesel");
    assert.equal(normaliseFuel("HEAVY OIL"), "Diesel");
    assert.equal(normaliseFuel("hybrid electric"), "Hybrid");
    assert.equal(normaliseFuel("Hydrogen"), "Other: Hydrogen");
    assert.equal(normaliseFuel(""), "");
    assert.equal(normaliseFuel("unknown"), "");
    assert.equal(fuelLabel(""), "Not known");
    assert.deepEqual(fuelChoice("Other: Hydrogen"), { choice: "Other", other: "Hydrogen" });
    assert.equal(fuelFromChoice("Other", "Bio-ethanol"), "Other: Bio-ethanol");
  });

  it("maps stored fuel once, tidies capital colours, notes each change, and leaves third-party vehicles alone", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE vehicles SET fuel = 'hybrid electric', colour = 'BLACK' WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = 'fv-10')`);
      run(`UPDATE vehicles SET fuel = 'petrol' WHERE usage = 'third_party'`);
      const thirdParties = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM vehicles WHERE usage = 'third_party'`)?.n);
      assert.ok(thirdParties > 0, "the seed has third-party vehicles");
      const changed = mapStoredFuelsOn(db);
      assert.ok(changed > 0);
      const car = get<{ fuel: string; colour: string }>(`SELECT fuel, colour FROM vehicles WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = 'fv-10')`);
      assert.equal(car?.fuel, "Hybrid");
      assert.equal(car?.colour, "Black");
      const note = get<{ details: string }>(`SELECT details FROM audit_log WHERE action = 'vehicle_details_tidied' AND details LIKE '%hybrid electric%'`);
      assert.match(String(note?.details), /fuel "hybrid electric" → "Hybrid"; colour "BLACK" → "Black"/);
      const tp = get<{ n: number }>(`SELECT COUNT(*) AS n FROM vehicles WHERE usage = 'third_party' AND fuel = 'petrol'`);
      assert.equal(Number(tp?.n), thirdParties, "third-party vehicles keep their stored fuel (R53)");
      assert.equal(mapStoredFuelsOn(db), 0, "it runs once");
    });
    db.close();
  });
});

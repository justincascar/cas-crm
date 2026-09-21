import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { DEFAULT_VEHICLE_LOCATION } from "../src/lib/constants.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { letterPreview } from "../src/lib/db/chronology.ts";
import { ensureEngineers, SEEDED_ENGINEER, setClaimEngineer } from "../src/lib/db/engineers.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  ensureDefaultVehicleLocationSetting,
  getDefaultVehicleLocation,
  recordedVehicleLocationForClaim,
  setDefaultVehicleLocation,
  vehicleLocationForClaim,
} from "../src/lib/db/vehicle-location.ts";
import { resolveVehicleLocation } from "../src/lib/domain/vehicle-location.ts";
import { generateLetter } from "../src/lib/documents/templates.ts";
import { emptyCorrespondenceFields } from "../src/lib/documents/correspondence.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
  ensureDefaultVehicleLocationSetting(db);
  return db;
}

describe("default vehicle location", () => {
  it("falls back to the CAS premises default when a claim has no location", () => {
    assert.equal(resolveVehicleLocation(""), DEFAULT_VEHICLE_LOCATION);
    assert.equal(resolveVehicleLocation("Unknown"), DEFAULT_VEHICLE_LOCATION);
    assert.equal(resolveVehicleLocation("  unknown  "), DEFAULT_VEHICLE_LOCATION);

    const db = seeded();
    withDatabase(db, () => {
      assert.equal(getDefaultVehicleLocation(), DEFAULT_VEHICLE_LOCATION);
      assert.equal(recordedVehicleLocationForClaim("c6"), "");
      assert.equal(vehicleLocationForClaim("c6"), DEFAULT_VEHICLE_LOCATION);

      setClaimEngineer("c6", SEEDED_ENGINEER.id);
      const preview = letterPreview("c6", "engineer_instruction");
      assert.match(preview.text, /171 Cwmgarw Road/);
      assert.match(preview.text, /Brynamman/);
      assert.match(preview.text, /SA18 1DG/);
      assert.doesNotMatch(preview.text, /Vehicle location: Unknown/);
      assert.equal(preview.missing.includes("Vehicle location"), false);
    });
    db.close();
  });

  it("keeps a recorded location on a claim even if the default later changes", () => {
    const db = seeded();
    withDatabase(db, () => {
      saveScreenData(
        "c6",
        "vehicle",
        { clientLocation1: "Jones Body Shop, Neath", clientLocationPostcode: "SA11 1AA" },
        "staff-sian",
      );
      assert.equal(recordedVehicleLocationForClaim("c6"), "Jones Body Shop, Neath, SA11 1AA");
      assert.equal(vehicleLocationForClaim("c6"), "Jones Body Shop, Neath, SA11 1AA");

      setDefaultVehicleLocation("A different CAS yard, Cardiff CF10 1AA");
      assert.equal(getDefaultVehicleLocation(), "A different CAS yard, Cardiff CF10 1AA");
      assert.equal(vehicleLocationForClaim("c6"), "Jones Body Shop, Neath, SA11 1AA");

      setClaimEngineer("c6", SEEDED_ENGINEER.id);
      const preview = letterPreview("c6", "engineer_instruction");
      assert.match(preview.text, /Jones Body Shop, Neath/);
      assert.doesNotMatch(preview.text, /A different CAS yard/);
      assert.doesNotMatch(preview.text, /171 Cwmgarw Road/);
    });
    db.close();
  });

  it("fills an empty engineer letter from the default without inventing a recorded location", () => {
    const letter = generateLetter("engineer_instruction", {
      fileReference: "TEST-0006",
      clientName: "Ffion Rees",
      handlerName: "Tom Hughes",
      accidentAt: "2026-09-03T08:00:00.000Z",
      accidentLocation: "Taff Street, Pontypridd",
      circumstances: "Engineer report awaited.",
      registration: "CF37 FRE",
      make: "Nissan",
      model: "Qashqai",
      tpInsurer: "Unknown",
      tpPolicyOrClaimRef: "Unknown",
      ownInsurer: "Unknown",
      ownPolicyRef: "Unknown",
      dates: {},
      letterDate: "2026-09-21T08:00:00.000Z",
      ...emptyCorrespondenceFields(),
      engineerName: SEEDED_ENGINEER.name,
      engineerAddress: SEEDED_ENGINEER.address,
      vehicleLocation: "",
    });
    assert.match(letter.text, /Complete Accident Solutions Ltd, 171 Cwmgarw Road/);
    assert.equal(letter.missing.includes("Vehicle location"), false);
  });
});

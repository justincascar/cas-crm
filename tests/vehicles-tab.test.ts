import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { pathAllowedForRole } from "../src/lib/auth/roles.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { getClaim } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  CLIENT_VEHICLE_EMPTY,
  THIRD_PARTY_VEHICLE_EMPTY,
  thirdPartyVehicleCards,
  vehicleIsRecorded,
  vehicleSummary,
} from "../src/lib/domain/vehicle-display.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

describe("vehicles tab", () => {
  it("shows the client's vehicle and the third-party vehicle from the stored file", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(
        `INSERT INTO claim_third_parties(id, claim_id, person_id, vehicle_id, insurer_name, sequence)
         VALUES ('tp-c2-extra', 'c2', 'p-tp1', NULL, 'Zurich', 2)`,
      ).run();
      const data = getClaim("c2");
      if (!data) throw new Error("missing c2");
      assert.equal(vehicleIsRecorded(data.claim), true);
      assert.equal(vehicleSummary(data.claim), "CF64 DLE · BMW 320i");
      const cards = thirdPartyVehicleCards(data.thirdParties);
      assert.equal(cards.length, 2);
      assert.equal(cards[0]?.recorded, true);
      assert.equal(cards[0]?.summary, "WN12 PSH · Peugeot 208");
      assert.equal(cards[0]?.title.includes("Third party 1"), true);
      assert.equal(cards[1]?.recorded, false);
      assert.equal(cards[1]?.title.includes("Third party 2"), true);
    });
  });

  it("says the third-party vehicle is not recorded when none is stored", () => {
    const db = prepared();
    withDatabase(db, () => {
      const withPerson = getClaim("c3");
      const withoutPerson = getClaim("c4");
      if (!withPerson || !withoutPerson) throw new Error("missing claim");
      assert.equal(vehicleSummary(withPerson.claim), "SA12 CWA · Volkswagen Golf");
      const personOnly = thirdPartyVehicleCards(withPerson.thirdParties);
      assert.equal(personOnly.length, 1);
      assert.equal(personOnly[0]?.recorded, false);
      const none = thirdPartyVehicleCards(withoutPerson.thirdParties);
      assert.equal(none.length, 1);
      assert.equal(none[0]?.recorded, false);
      assert.equal(THIRD_PARTY_VEHICLE_EMPTY, "Not recorded");
    });
  });

  it("loads a claim with no vehicle at all", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET client_vehicle_id = NULL WHERE id = 'c1'`).run();
      db.prepare(`DELETE FROM claim_third_parties WHERE claim_id = 'c1'`).run();
      const data = getClaim("c1");
      if (!data) throw new Error("missing c1");
      assert.equal(vehicleIsRecorded(data.claim), false);
      assert.equal(vehicleSummary(data.claim), "");
      assert.equal(CLIENT_VEHICLE_EMPTY, "Not yet recorded");
      assert.equal(thirdPartyVehicleCards(data.thirdParties)[0]?.recorded, false);
    });
  });

  it("keeps Audatex on the Vehicles tab, shortens Overview, and blocks a driver", () => {
    const overview = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
    const vehicles = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/vehicles/page.tsx"), "utf8");
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/layout.tsx"), "utf8");
    const repair = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/repair/page.tsx"), "utf8");
    assert.doesNotMatch(overview, /ClaimAudatexFields/);
    assert.match(overview, /\/vehicles/);
    assert.doesNotMatch(overview, /Gearbox:/);
    assert.match(vehicles, /ClaimAudatexFields/);
    assert.match(vehicles, /Client's own vehicle|Client&apos;s own vehicle/);
    assert.match(layout, /\/vehicles/);
    assert.match(layout, />\s*Vehicles\s*</);
    assert.match(repair, /Audatex codes are on the Vehicles tab/);
    assert.equal(pathAllowedForRole("driver", "/claims/c2/vehicles"), false);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c2/vehicles"), false);
    assert.equal(pathAllowedForRole("staff", "/claims/c2/vehicles"), true);
  });
});

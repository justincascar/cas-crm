import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ageInYearsOn, dobSaveError, inspectDob } from "../src/lib/age.ts";
import { accidentDateError, londonTodayIso } from "../src/lib/dates.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { intakeDateErrors } from "../src/lib/db/intake.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { SimulatedVehicleLookup, VEHICLE_MANUAL_HINT } from "../src/lib/lookups/vehicle.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("Europe/London accident dates", () => {
  it("allows today and yesterday, and rejects tomorrow", () => {
    const asAt = new Date("2026-09-17T23:30:00.000Z");
    const today = londonTodayIso(asAt);
    assert.equal(today, "2026-09-18");
    assert.equal(accidentDateError(today, asAt), null);
    assert.equal(accidentDateError("2026-09-17", asAt), null);
    assert.match(accidentDateError("2026-09-19", asAt) || "", /cannot be after today/i);
  });
});

describe("age from date of birth", () => {
  it("counts birthday today as that age, including across a year boundary", () => {
    assert.equal(ageInYearsOn("2009-03-01", "2026-03-01"), 17);
    assert.equal(ageInYearsOn("2009-03-02", "2026-03-01"), 16);
    assert.equal(ageInYearsOn("2009-01-01", "2026-01-01"), 17);
    assert.equal(ageInYearsOn("2009-12-31", "2026-01-01"), 16);
    assert.equal(ageInYearsOn("1992-09-17", "2026-09-17"), 34);
  });

  it("blocks drivers under 17 and future or implausible dates", () => {
    const asAt = "2026-09-17";
    assert.equal(dobSaveError("1992-09-17", "driver", false, asAt), null);
    assert.equal(dobSaveError("2009-09-17", "driver", false, asAt), null);
    assert.match(dobSaveError("2009-09-18", "driver", false, asAt) || "", /at least 17/);
    assert.match(dobSaveError("2026-09-18", "driver", false, asAt) || "", /future/);
    assert.match(dobSaveError("1915-09-17", "client", false, asAt) || "", /110/);
  });

  it("warns for a client, owner or hirer under 17 unless staff confirm", () => {
    const asAt = "2026-09-17";
    const warning = inspectDob("2012-01-01", "client", asAt);
    assert.equal(warning.ok, false);
    if (!warning.ok) assert.equal(warning.blocking, false);
    assert.match(dobSaveError("2012-01-01", "owner", false, asAt) || "", /double-check/i);
    assert.equal(dobSaveError("2012-01-01", "hirer", true, asAt), null);
    assert.match(dobSaveError("2012-01-01", "driver", true, asAt) || "", /at least 17/);
  });
});

describe("intake save rules", () => {
  it("blocks a future accident date even if the browser did not", () => {
    const err = intakeDateErrors({
      handlerId: "staff-sian",
      clientRole: "owner_driver",
      client: { forename: "Aled", surname: "Morgan", dob: "1988-04-12" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2099-01-01",
    });
    assert.match(err || "", /cannot be after today/i);
  });

  it("rejects a future accident date when saving the accident screen", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.throws(
        () => saveScreenData("c1", "accident", { accidentDate: "2099-01-01" }, "staff-sian"),
        /cannot be after today/i,
      );
    });
    db.close();
  });

  it("blocks an under-17 driver on intake", () => {
    const err = intakeDateErrors({
      handlerId: "staff-sian",
      clientRole: "owner_driver",
      client: { forename: "Aled", surname: "Morgan", dob: "2012-01-01" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2026-09-01",
    });
    assert.match(err || "", /at least 17/);
  });

  it("allows an under-17 owner after confirmation", () => {
    const err = intakeDateErrors({
      handlerId: "staff-sian",
      clientRole: "owner",
      client: { forename: "Parent", surname: "Morgan", dob: "2012-01-01", dobConfirmed: true },
      counterpart: { forename: "Aled", surname: "Morgan", dob: "1988-04-12" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2026-09-01",
    });
    assert.equal(err, null);
  });

  it("blocks a mobile number longer than 11 digits on intake", () => {
    const err = intakeDateErrors({
      handlerId: "staff-sian",
      clientRole: "owner_driver",
      client: { forename: "Aled", surname: "Morgan", mobile: "077009001234" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2026-09-01",
    });
    assert.match(err || "", /at most 11 digits/);
  });

  it("rejects a 12-digit mobile on the client screen", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.throws(
        () => saveScreenData("c1", "client", { telMobile: "077009001234" }, "staff-sian"),
        /at most 11 digits/,
      );
    });
    db.close();
  });

  it("rejects a mobile number shorter than 11 digits on intake", () => {
    const err = intakeDateErrors({
      handlerId: "staff-sian",
      clientRole: "owner_driver",
      client: { forename: "Aled", surname: "Morgan", mobile: "07700" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2026-09-01",
    });
    assert.match(err || "", /too short/);
  });
});

describe("vehicle lookup manual fallback", () => {
  it("returns a typed-entry hint for an unknown plate and does not throw", async () => {
    const result = await new SimulatedVehicleLookup().lookup("AB12 CDE");
    assert.equal(result?.incomplete, true);
    assert.ok(result?.warnings.includes(VEHICLE_MANUAL_HINT));
    assert.equal(result?.make, undefined);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HIRE_PACK_MANDATORY,
  HIRE_PACK_OPTIONAL,
  OWN_VEHICLE_DETAILS_HEADING,
  RENTAL_PERIOD_DECISION,
} from "../src/lib/documents/hire-pack-fields.ts";
import { CAS_HIRE_AGREEMENT_BANNER, CAS_COMPANY } from "../src/lib/documents/cas-hire-terms.ts";
import { renderHirePack, renderStorageRecovery, type HirePackData } from "../src/lib/db/hire-pack.ts";

function packForRender() {
  const stored: HirePackData = {
    additional_name: "Sian Evans",
    additional_dob: "1990-04-12",
    additional_licence: "EVANS901234AB9CD",
    additional_licence_issued_on: "2010-04-12",
    additional_licence_expires_on: "2030-04-12",
    group_charged: "S4",
    sat_nav_pence: 500,
    storage_daily_pence: 3900,
    recovery_pence: 39500,
    own_vehicle_mileage: 42110,
    own_vehicle_fuel: "1/2",
    own_vehicle_tyres: "6/6/5/5",
    own_vehicle_damage: "Offside rear damage",
    need_reason: "Need a car for work",
    cannot_fund_hire: 1,
    no_other_credit: 1,
    means_documents_requested: 1,
  };
  return {
    claim: { client_reg: "SA12 CWA", file_reference: "TEST-0003", storage_started_on: "2026-09-12T20:00:00.000Z", storage_rate_pence: 3900 },
    hire: { hire_make: "Volkswagen", hire_model: "Golf", hire_reg: "CF12 HIR", hire_transmission: "automatic", hire_fuel: "petrol", started_at: "2026-09-12T19:30:00.000Z", rate_pence_per_day: 8900 },
    stored,
    ctx: {
      agreementNumber: "TEST-0003",
      hirerName: "Ceri Walsh",
      hirerAddress: "12 Example Street, Swansea",
      hirerDob: "1984-03-02",
      licenceNumber: "WALSH840302AB9CD",
      licenceIssuedOn: "2012-03-02",
      licenceExpiresOn: "2032-03-02",
      hireMake: "Volkswagen",
      hireModel: "Golf",
      hireRegistration: "CF12 HIR",
      hireTransmission: "automatic",
      dateOut: "2026-09-12T19:30:00.000Z",
      dailyRatePence: 8900,
      needReason: "Need a car for work",
      clientVehicleRegistration: "SA12 CWA",
    },
    missing: [],
    srMissing: [],
    srNumber: "TEST-0003-SR",
    clientMake: "Volkswagen",
    clientModel: "Golf",
  } as unknown as Parameters<typeof renderHirePack>[0];
}

describe("CAS hire pack fields", () => {
  it("requires the agreement number, hirer, licence, hire vehicle, date out, rate and mitigation reason", () => {
    assert.ok(HIRE_PACK_MANDATORY.includes("agreementNumber"));
    assert.ok(HIRE_PACK_MANDATORY.includes("licenceNumber"));
    assert.ok(HIRE_PACK_MANDATORY.includes("hireRegistration"));
    assert.ok(HIRE_PACK_MANDATORY.includes("dateOut"));
    assert.ok(HIRE_PACK_MANDATORY.includes("dailyRatePence"));
    assert.ok(HIRE_PACK_MANDATORY.includes("needReason"));
    assert.ok(HIRE_PACK_MANDATORY.includes("clientVehicleRegistration"));
  });

  it("captures extras, group charged and additional-driver details as optional fields", () => {
    assert.ok(HIRE_PACK_OPTIONAL.includes("satNavPence"));
    assert.ok(HIRE_PACK_OPTIONAL.includes("groupCharged"));
    assert.ok(HIRE_PACK_OPTIONAL.includes("additionalDob"));
    assert.ok(HIRE_PACK_OPTIONAL.includes("additionalLicenceIssuedOn"));
    assert.equal(HIRE_PACK_MANDATORY.includes("satNavPence" as never), false);
  });

  it("does not silently pick 88 or 89 days", () => {
    assert.equal(RENTAL_PERIOD_DECISION.packDays, 89);
    assert.equal(RENTAL_PERIOD_DECISION.alertDays, 88);
    assert.equal(RENTAL_PERIOD_DECISION.status, "awaiting_justin");
  });

  it("keeps the supplied CAS pack notices", () => {
    assert.match(CAS_HIRE_AGREEMENT_BANNER, /not regulated by the Consumer Credit Act 1974/i);
    assert.match(CAS_COMPANY.address, /Cwmgarw Road/);
    assert.equal(CAS_COMPANY.email, "info@cascar.co.uk");
  });

  it("labels the client's own vehicle correctly and keeps Storage & Recovery off the hire agreement pages", () => {
    const pack = packForRender();
    const hireHtml = renderHirePack(pack);
    assert.match(hireHtml, /Hire Agreement — 1 of 3/);
    assert.match(hireHtml, /Hire Agreement — 3 of 3/);
    assert.doesNotMatch(hireHtml, /Hire Agreement — 3 of 4 — Storage/);
    assert.doesNotMatch(hireHtml, /Hire Vehicle Details/);
    assert.match(hireHtml, /Financial means/);
    assert.match(hireHtml, /statement of means and three months' bank statements/);
    const sr = renderStorageRecovery(pack);
    assert.match(sr, new RegExp(OWN_VEHICLE_DETAILS_HEADING));
    assert.doesNotMatch(sr, /Hire Vehicle Details/);
    assert.match(sr, /TEST-0003-SR/);
    assert.match(sr, /does not require a Hire Agreement/);
    assert.match(sr, /SA12 CWA/);
    assert.match(sr, /42110/);
    assert.match(sr, /solicitor-reviewed standalone legal wording is still to come/i);
  });
});

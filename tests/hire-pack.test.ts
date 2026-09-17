import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HIRE_PACK_MANDATORY } from "../src/lib/documents/hire-pack-fields.ts";
import { CAS_HIRE_AGREEMENT_BANNER, CAS_COMPANY } from "../src/lib/documents/cas-hire-terms.ts";

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

  it("keeps the supplied CAS pack notices", () => {
    assert.match(CAS_HIRE_AGREEMENT_BANNER, /not regulated by the Consumer Credit Act 1974/i);
    assert.match(CAS_COMPANY.address, /Cwmgarw Road/);
    assert.equal(CAS_COMPANY.email, "info@cascar.co.uk");
  });
});

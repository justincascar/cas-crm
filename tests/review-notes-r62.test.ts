import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  licenceFormatError,
  licenceMismatches,
  licenceMismatchSentence,
  licenceOrigin,
  surnameFromFullName,
} from "../src/lib/domain/licence-number.ts";
import { cleanLicenceNumber } from "../src/lib/db/prehire-checks.ts";

// Fictional people and numbers only.
const VALID = "PRAWF804125GP9AB"; // Prawf, born 12/04/1985 (man)

describe("R62 — driving licence number format", () => {
  it("accepts a valid fictional GB number that matches the surname and date of birth", () => {
    assert.equal(licenceFormatError(VALID, "gb"), null);
    assert.deepEqual(licenceMismatches({ number: VALID, origin: "gb", surname: "Prawf", dateOfBirth: "1985-04-12" }), []);
    // A woman's month has 5 added to its first digit.
    assert.deepEqual(licenceMismatches({ number: "PRAWF854125GP9AB", origin: "gb", surname: "Prawf", dateOfBirth: "1985-04-12" }), []);
    // Short surnames are padded with 9s; spaces are ignored.
    assert.deepEqual(licenceMismatches({ number: "LEE99 804125 GP9AB", origin: "gb", surname: "Lee", dateOfBirth: "1985-04-12" }), []);
    // DVLA writes Mac as MC.
    assert.deepEqual(licenceMismatches({ number: "MCDON804125GP9AB", origin: "gb", surname: "MacDonald", dateOfBirth: "1985-04-12" }), []);
  });

  it("refuses a wrong-length number with a clear message (TEST-0042's 11 characters)", () => {
    const message = licenceFormatError("DSSGXDCBCXB", "gb");
    assert.match(String(message), /16 letters and numbers; this one has 11/);
    assert.match(String(message), /Not a GB licence/);
    assert.throws(() => cleanLicenceNumber("DSSGXDCBCXB"), /16 letters and numbers/);
    assert.match(String(licenceFormatError("PRAWFX04125GP9AB", "gb")), /not in the GB licence number format/);
  });

  it("keeps a number that does not match the date of birth or surname, and says what to check", () => {
    assert.equal(licenceFormatError(VALID, "gb"), null, "the format is right, so it is not refused");
    const wrongDob = licenceMismatches({ number: VALID, origin: "gb", surname: "Prawf", dateOfBirth: "1986-04-12" });
    assert.equal(wrongDob.length, 1);
    assert.match(wrongDob[0]!, /date-of-birth digits \(804125\)/);
    const wrongName = licenceMismatches({ number: VALID, origin: "gb", surname: "Roberts", dateOfBirth: "1985-04-12" });
    assert.match(wrongName[0]!, /surname on the file gives ROBER/);
    assert.match(licenceMismatchSentence("Mr Gethin Prawf", wrongDob), /^Check Mr Gethin Prawf's licence number: .* It has been kept/);
    assert.equal(licenceMismatchSentence("Mr Gethin Prawf", []), "");
  });

  it("lets a Northern Ireland or foreign licence through only with the Not a GB licence tick", () => {
    assert.equal(licenceOrigin("", "Poland"), "gb", "not ticked means GB");
    assert.equal(licenceOrigin("yes", "Northern Ireland"), "ni");
    assert.equal(licenceOrigin("yes", "Poland"), "other");
    assert.equal(licenceFormatError("12345678", "ni"), null);
    assert.match(String(licenceFormatError("1234567", "ni")), /8 digits/);
    assert.match(String(licenceFormatError("AB1234567", "other", "")), /country that issued/);
    assert.equal(licenceFormatError("AB1234567", "other", "Poland"), null);
    assert.equal(cleanLicenceNumber("ab 1234567", "other", "Poland"), "AB1234567");
    assert.deepEqual(licenceMismatches({ number: "12345678", origin: "ni", surname: "Prawf", dateOfBirth: "1985-04-12" }), [], "only GB numbers are compared");
  });

  it("takes the surname from a full name typed in one box", () => {
    assert.equal(surnameFromFullName("Mrs Nia Profi"), "Profi");
    assert.equal(surnameFromFullName("Cher"), "");
  });
});

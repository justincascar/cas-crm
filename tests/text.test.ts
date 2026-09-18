import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTypedValue, formatVehicleRegistration, toStartCase } from "../src/lib/text.ts";
import { clipMobileNumber, mobileNumberError } from "../src/lib/phone-number.ts";

describe("field casing", () => {
  it("stores vehicle registration in capitals only", () => {
    assert.equal(formatVehicleRegistration("sa12  cwa"), "SA12 CWA");
    assert.equal(formatTypedValue("clientReg", "cf64dle"), "CF64DLE");
    assert.equal(formatTypedValue("veh_registration", "wn12 psh"), "WN12 PSH");
    assert.equal(formatTypedValue("dateOfRegistration", "2020-03-01", "date"), "2020-03-01");
  });

  it("starts each word with a capital and lower-cases the rest", () => {
    assert.equal(toStartCase("ALED"), "Aled");
    assert.equal(toStartCase("morgan"), "Morgan");
    assert.equal(toStartCase("14 HIGH STREET"), "14 High Street");
    assert.equal(toStartCase("O'BRIEN"), "O'Brien");
    assert.equal(formatTypedValue("client_forename", "BETHAN"), "Bethan");
    assert.equal(formatTypedValue("client_surname", "lewis"), "Lewis");
    assert.equal(formatTypedValue("veh_make", "VOLKSWAGEN"), "Volkswagen");
    assert.equal(formatTypedValue("veh_colour", "BLACK"), "Black");
  });

  it("keeps postcodes in capitals and emails in lower case", () => {
    assert.equal(formatTypedValue("client_postcode", "cf24 2da"), "CF24 2DA");
    assert.equal(formatTypedValue("client_email", "Aled.Morgan@Example.COM"), "aled.morgan@example.com");
  });
});

describe("mobile numbers", () => {
  it("keeps at most 11 digits and ignores spaces or punctuation", () => {
    assert.equal(clipMobileNumber("07700 900123"), "07700900123");
    assert.equal(clipMobileNumber("07700-900123-9"), "07700900123");
    assert.equal(mobileNumberError("07700900123"), null);
    assert.equal(mobileNumberError(""), null);
    assert.match(mobileNumberError("077009001234") || "", /at most 11 digits/);
  });

  it("warns when a mobile number is shorter than 11 digits", () => {
    assert.match(mobileNumberError("07700") || "", /too short/);
    assert.match(mobileNumberError("0770090012") || "", /too short/);
  });
});

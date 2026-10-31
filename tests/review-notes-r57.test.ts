import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTelephoneNumber, phoneFieldError, splitExtension, TELEPHONE_HINT } from "../src/lib/phone-number.ts";

describe("R57 — only a mobile box needs 07", () => {
  it("accepts a third party's landline, an insurer's 03 number and an agent's +44 number with an extension", () => {
    assert.equal(phoneFieldError("tp1_telephone", "01792 341069"), null);
    assert.equal(phoneFieldError("tp1_insurerTel", "0345 000 1234"), null);
    assert.equal(phoneFieldError("tp1_agentTel", "+44 29 2000 0000 ext 12"), null);
    assert.equal(phoneFieldError("tp1_handlerTel", "0800 123 4567"), null);
    assert.equal(phoneFieldError("recovererTel", "0800 123456"), null, "a ten-digit freephone number");
    assert.equal(phoneFieldError("telMain", "07700 900123"), null, "a mobile is a telephone too");
    assert.equal(phoneFieldError("telMain", "+33 1 23 45 67 89"), null, "an international number starting +");
  });

  it("refuses a landline in the client's mobile box with a clear message", () => {
    const message = phoneFieldError("client_mobile", "01792 341069");
    assert.ok(message);
    assert.match(message, /A mobile number starts 07 or \+447\. 01792 341069 looks like a landline: put it under Telephone instead\./);
    assert.equal(phoneFieldError("client_mobile", "07700 900123"), null);
    assert.equal(phoneFieldError("client_mobile", "+44 7700 900123"), null);
  });

  it("refuses something that is not a telephone number, and the hint never says a UK mobile starts 07", () => {
    assert.match(String(phoneFieldError("tp1_telephone", "12345")), /UK number, for example 01792 341069 or 07700 900123/);
    assert.equal(isTelephoneNumber("0412 345678"), false, "04 is not in use");
    assert.doesNotMatch(TELEPHONE_HINT, /mobile/i);
    assert.deepEqual(splitExtension("01792 341069 x214"), { number: "01792 341069", extension: "214" });
    assert.deepEqual(splitExtension("01792 341069"), { number: "01792 341069", extension: "" });
  });
});

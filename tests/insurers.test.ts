import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exactKnownInsurer,
  isUsableInsurerName,
  matchKnownInsurers,
  mergeInsurerDetails,
  type KnownInsurer,
} from "../src/lib/insurers.ts";

const insurers: KnownInsurer[] = [
  {
    name: "Admiral",
    address: "Fictional claims team",
    postcode: "CF10 1AA",
    telephone: "029 2000 4001",
    email: "motor.claims@admiral.example.test",
  },
  {
    name: "Aviva",
    address: "",
    postcode: "",
    telephone: "029 2000 4002",
    email: "motor.claims@aviva.example.test",
  },
];

describe("TP insurer autocomplete", () => {
  it("suggests Admiral as soon as Ad is typed, not Aviva", () => {
    const matches = matchKnownInsurers(insurers, "ad");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, "Admiral");
    assert.equal(exactKnownInsurer(insurers, "ADMIRAL")?.email, "motor.claims@admiral.example.test");
  });

  it("fills generic telephone and email but has no policy number or claim reference to copy", () => {
    const filled = mergeInsurerDetails(
      { name: "Ad", address: "", postcode: "", telephone: "", email: "" },
      insurers[0]!,
      "replace",
    );
    assert.equal(filled.name, "Admiral");
    assert.equal(filled.telephone, "029 2000 4001");
    assert.equal(filled.email, "motor.claims@admiral.example.test");
    assert.equal("policyNumber" in filled, false);
    assert.equal("claimReference" in filled, false);
  });

  it("does not overwrite a telephone already typed when only completing empty fields", () => {
    const filled = mergeInsurerDetails(
      { name: "Admiral", address: "", postcode: "", telephone: "029 2000 9999", email: "" },
      insurers[0]!,
      "empty-only",
    );
    assert.equal(filled.telephone, "029 2000 9999");
    assert.equal(filled.email, "motor.claims@admiral.example.test");
  });

  it("ignores Unknown as an insurer name", () => {
    assert.equal(isUsableInsurerName("Unknown"), false);
    assert.equal(matchKnownInsurers([{ ...insurers[0]!, name: "Unknown" }], "un").length, 0);
  });
});

const agents: KnownInsurer[] = [
  {
    name: "Keoghs",
    address: "",
    postcode: "",
    telephone: "029 2000 5001",
    email: "motor.claims@keoghs.example.test",
    handlerName: "Claims handler",
    handlerEmail: "handler@keoghs.example.test",
    handlerTel: "029 2000 5001",
  },
  {
    name: "DAC Beachcroft",
    address: "",
    postcode: "",
    telephone: "029 2000 5002",
    email: "motor.claims@dacbeachcroft.example.test",
  },
];

describe("TP agent autocomplete", () => {
  it("suggests Keoghs as soon as Ke is typed", () => {
    const matches = matchKnownInsurers(agents, "ke");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, "Keoghs");
    assert.equal(exactKnownInsurer(agents, "KEOGHS")?.email, "motor.claims@keoghs.example.test");
  });

  it("fills generic telephone, email and handler but has no agent reference to copy", () => {
    const filled = mergeInsurerDetails(
      { name: "Ke", address: "", postcode: "", telephone: "", email: "" },
      agents[0]!,
      "replace",
    );
    assert.equal(filled.name, "Keoghs");
    assert.equal(filled.telephone, "029 2000 5001");
    assert.equal(filled.email, "motor.claims@keoghs.example.test");
    assert.equal(filled.handlerName, "Claims handler");
    assert.equal(filled.handlerEmail, "handler@keoghs.example.test");
    assert.equal("agentReference" in filled, false);
    assert.equal("reference" in filled, false);
  });
});

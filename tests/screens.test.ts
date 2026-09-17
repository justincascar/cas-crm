import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLAIM_SCREENS, getClaimScreen } from "../src/lib/claim-screens.ts";
import { displayValue, valuesFromForm } from "../src/lib/db/screens.ts";

describe("claim file screens", () => {
  it("covers the operational screens from the current CRM", () => {
    const keys = CLAIM_SCREENS.map((s) => s.key);
    for (const key of [
      "comms",
      "general",
      "client",
      "driver",
      "owner",
      "insurer",
      "vehicle",
      "damage",
      "accident",
      "witnesses",
      "tp1",
      "hire-mitigation",
      "delivery-collection",
      "hire-details",
      "extra-charges",
      "hire-vehicle",
      "additional-drivers",
      "reserve",
      "hire-cars",
      "assessed-damage",
      "loss-of-use",
      "financial-summary",
      "storage",
      "recovery",
      "history",
      "navigation",
    ]) {
      assert.ok(keys.includes(key), `missing screen ${key}`);
    }
  });

  it("stores money as pence and empty pounds as blank", () => {
    const form = new FormData();
    form.set("dailyRate", "39.50");
    form.set("endDate", "2026-09-18");
    const values = valuesFromForm(form, "storage");
    assert.equal(values.dailyRate, "3950");
    assert.equal(values.endDate, "2026-09-18");
    assert.equal(values.startDate, "");
    assert.equal(displayValue("storage", "dailyRate", "3950"), "39.50");
  });

  it("records checkboxes without inventing a hire start", () => {
    const form = new FormData();
    form.set("tpOfferReceived", "yes");
    form.set("needReason", "Need a car for work.");
    const values = valuesFromForm(form, "hire-mitigation");
    assert.equal(values.tpOfferReceived, "yes");
    assert.equal(values.needReason, "Need A Car For Work.");
    assert.equal(getClaimScreen("hire-mitigation")?.hint?.includes("does not start charges"), true);
  });

  it("saves registration in capitals and other text with a capital to start", () => {
    const form = new FormData();
    form.set("clientReg", "sa12 cwa");
    form.set("clientMake", "VOLKSWAGEN");
    form.set("clientColour", "white");
    const values = valuesFromForm(form, "vehicle");
    assert.equal(values.clientReg, "SA12 CWA");
    assert.equal(values.clientMake, "Volkswagen");
    assert.equal(values.clientColour, "White");
  });
});

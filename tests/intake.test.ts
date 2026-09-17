import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accidentAtFromParts, intakeFromFormData, personFullName, poundsToPence } from "../src/lib/db/intake.ts";
import { SimulatedComplianceLookup } from "../src/lib/lookups/compliance.ts";
import { googleMapsSearchUrl } from "../src/lib/lookups/maps.ts";
import { SimulatedVehicleLookup } from "../src/lib/lookups/vehicle.ts";
import { SimulatedWhatsAppGateway } from "../src/lib/whatsapp/gateway.ts";

describe("intake capture", () => {
  it("builds a client name from title, forename and surname and allows a blank title", () => {
    assert.equal(personFullName({ title: "Mrs", forename: "Bethan", surname: "Lewis" }), "Mrs Bethan Lewis");
    assert.equal(personFullName({ title: "", forename: "Aled", surname: "Morgan" }), "Aled Morgan");
  });

  it("combines accident date and time as Europe/London", () => {
    const iso = accidentAtFromParts("2026-09-15", "09:30");
    assert.ok(iso);
    assert.equal(iso?.endsWith("Z"), true);
  });

  it("stores money as pence and reads the numbered intake fields", () => {
    assert.equal(poundsToPence("395.00"), 39500);
    const form = new FormData();
    form.set("client_forename", "ALED");
    form.set("client_surname", "morgan");
    form.set("client_postcode", "cf24 2da");
    form.set("client_email", "Aled@Example.COM");
    form.set("veh_registration", "sa12 cwa");
    form.set("veh_make", "VOLKSWAGEN");
    form.set("veh_colour", "white");
    form.set("clientRole", "owner_driver");
    form.set("needsRecovery", "yes");
    form.set("recoveryCharge", "395");
    form.set("recoveryWinch", "50");
    form.set("storageRate", "39");
    form.set("includeTp2", "yes");
    form.set("tp2_forename", "Priya");
    form.set("tp2_surname", "Shah");
    const intake = intakeFromFormData(form);
    assert.equal(intake.needsRecovery, true);
    assert.equal(intake.recovery?.chargePence, 39500);
    assert.equal(intake.recovery?.winchPence, 5000);
    assert.equal(intake.recovery?.storageRatePence, 3900);
    assert.equal(intake.thirdParties[1]?.included, true);
    assert.equal(intake.thirdParties[1]?.forename, "Priya");
    assert.equal(intake.thirdParties[2]?.included, false);
    assert.equal(intake.client.forename, "Aled");
    assert.equal(intake.client.surname, "Morgan");
    assert.equal(intake.client.postcode, "CF24 2DA");
    assert.equal(intake.client.email, "aled@example.com");
    assert.equal(intake.vehicle.registration, "SA12 CWA");
    assert.equal(intake.vehicle.make, "Volkswagen");
    assert.equal(intake.vehicle.colour, "White");
  });
});

describe("simulated lookups and WhatsApp", () => {
  it("does not infer gearbox or identify the keeper", async () => {
    const vehicle = await new SimulatedVehicleLookup().lookup("CF64 DLE");
    assert.equal(vehicle?.transmission, undefined);
    assert.ok(vehicle?.warnings.some((w) => /keeper/i.test(w)));
    const compliance = await new SimulatedComplianceLookup().check("CF64 DLE");
    assert.match(compliance.insuranceStatus, /AskMID|MID/i);
    assert.equal(compliance.simulated, true);
  });

  it("does not send a live WhatsApp message", async () => {
    const result = await new SimulatedWhatsAppGateway().send({
      to: "02920001001",
      body: "Recovery is on the way.",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "simulated_sent");
      assert.match(result.warning, /not sent/i);
    }
  });

  it("opens a Google Maps search for the accident location", () => {
    assert.match(googleMapsSearchUrl("Newport Road, Cardiff"), /google\.com\/maps/);
    assert.equal(googleMapsSearchUrl("  "), "");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateLetter } from "../src/lib/documents/templates.ts";
import { latestDates } from "../src/lib/domain/events.ts";
import { SimulatedEmailGateway } from "../src/lib/email/gateway.ts";
import { SimulatedPhoneGateway } from "../src/lib/phone/gateway.ts";

describe("letters from file dates", () => {
  it("builds an initial insurer letter from recorded dates and lists missing fields", () => {
    const letter = generateLetter("initial_tp_insurer", {
      fileReference: "TEST-0003",
      clientName: "Ceri Walsh",
      handlerName: "Tom Hughes",
      accidentAt: "2026-09-09T07:00:00.000Z",
      accidentLocation: "M4 Junction 42, Swansea",
      circumstances: "Undriveable after offside impact.",
      registration: "SA12 CWA",
      make: "Volkswagen",
      model: "Golf",
      tpInsurer: "Unknown",
      tpPolicyOrClaimRef: "Unknown",
      ownInsurer: "Direct Line",
      ownPolicyRef: "DL-22019",
      dates: { engineer_instructed: "2026-09-10T09:00:00.000Z" },
      letterDate: "2026-09-14T08:00:00.000Z",
    });
    assert.match(letter.subject, /Our ref: TEST-0003/);
    assert.match(letter.text, /Dear Sir \/ Madam/);
    assert.match(letter.text, /Ceri Walsh/);
    assert.ok(letter.missing.includes("Third-party insurer"));
    assert.ok(letter.missing.includes("Third-party insurer reference"));
  });

  it("puts engineer instruction and repair dates into a repair commencement letter", () => {
    const letter = generateLetter("repair_commencement", {
      fileReference: "TEST-0007",
      clientName: "Gareth Bevan",
      handlerName: "Tom Hughes",
      accidentAt: "2026-08-25T08:00:00.000Z",
      accidentLocation: "A470, Merthyr Tydfil",
      circumstances: "Repairable non-fault.",
      registration: "CF47 GBE",
      make: "Skoda",
      model: "Octavia",
      tpInsurer: "Zurich",
      tpPolicyOrClaimRef: "ZU-CL-2201",
      ownInsurer: "Zurich",
      ownPolicyRef: "ZU-19002",
      dates: {
        initial_letter_tp_insurer: "2026-08-26T09:00:00.000Z",
        engineer_instructed: "2026-08-27T09:00:00.000Z",
        repairs_started: "2026-09-01T08:00:00.000Z",
      },
      letterDate: "2026-09-01T08:00:00.000Z",
    });
    assert.match(letter.text, /commenced on 01\/09\/2026/);
    assert.match(letter.text, /Engineer instructed: 27\/08\/2026/);
    assert.equal(letter.missing.length, 0);
  });
});

describe("email gateway", () => {
  it("does not treat a simulated send as delivery", async () => {
    const gateway = new SimulatedEmailGateway();
    const result = await gateway.send({
      to: "insurer@example.test",
      subject: "Our ref: TEST-0003  Your policy: ZU-TP-4410",
      body: "Dear Sir / Madam\n\nPlease confirm liability.",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "simulated_sent");
      assert.match(result.warning, /not proof of delivery/i);
    }
  });
});

describe("telephone gateway", () => {
  it("does not place a live call", async () => {
    const gateway = new SimulatedPhoneGateway();
    const result = await gateway.place({ to: "02920001001", direction: "outgoing" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "simulated_logged");
      assert.match(result.warning, /not placed|not connected|live telephone/i);
    }
  });
});

describe("chronology dates", () => {
  it("keeps the latest date for each step", () => {
    const dates = latestDates([
      { event_type: "engineer_instructed", occurred_at: "2026-09-01T09:00:00.000Z" },
      { event_type: "engineer_instructed", occurred_at: "2026-09-03T09:00:00.000Z" },
      { event_type: "repairs_started", occurred_at: "2026-09-10T08:00:00.000Z" },
    ]);
    assert.equal(dates.engineer_instructed, "2026-09-03T09:00:00.000Z");
    assert.equal(dates.repairs_started, "2026-09-10T08:00:00.000Z");
  });
});

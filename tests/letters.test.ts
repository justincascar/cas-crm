import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateLetter } from "../src/lib/documents/templates.ts";
import { generateEmail } from "../src/lib/documents/email-templates.ts";
import { DOCUMENT_TEMPLATES } from "../src/lib/documents/catalog.ts";
import { emptyCorrespondenceFields } from "../src/lib/documents/correspondence.ts";
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
    assert.match(letter.subject, /Uninsured losses — TEST-0003/);
    assert.match(letter.text, /Our Reference: TEST-0003\/TH\/Tom Hughes/);
    assert.match(letter.text, /Dear Sir \/ Madam/);
    assert.match(letter.text, /We act on behalf of Ceri Walsh in respect of uninsured losses arising from the above road traffic accident/);
    assert.match(letter.text, /Accordingly, we place you on notice of our client's claim/);
    assert.match(letter.text, /Supporting documentation follows by covering email/);
    assert.match(letter.text, /Provide your claim reference/);
    assert.match(letter.text, /Confirm that you are the correct insurer \/ handler/);
    assert.match(letter.text, /Confirm that indemnity is in place/);
    assert.match(letter.text, /Confirm your position on liability/);
    assert.match(letter.text, /All future correspondence regarding this matter should be directed to ourselves/);
    assert.match(letter.text, /Our Insured's Vehicle: Volkswagen Golf SA12 CWA/);
    assert.doesNotMatch(letter.text, /Client's driver:/);
    assert.ok(letter.missing.includes("Third-party insurer"));
    assert.ok(letter.missing.includes("Third-party policy number"));
  });

  it("shows the client's driver only when that person is not the client", () => {
    const letter = generateLetter("initial_tp_insurer", {
      fileReference: "TEST-0003",
      clientName: "Example Logistics Ltd",
      clientDriverName: "Aled Morgan",
      handlerName: "Tom Hughes",
      accidentAt: "2026-09-09T07:00:00.000Z",
      accidentLocation: "M4 Junction 42, Swansea",
      circumstances: "Company van, employee driving.",
      registration: "SA12 CWA",
      make: "Volkswagen",
      model: "Golf",
      tpInsurer: "Zurich",
      tpPolicyOrClaimRef: "ZU-CL-2201",
      tpPolicyNumber: "ZU-POL-991",
      tpVehicleMake: "Ford",
      tpVehicleModel: "Transit",
      tpVehicleReg: "AB12 CDE",
      lossesClaimed: "vehicle repair charges and credit hire charges",
      ownInsurer: "Direct Line",
      ownPolicyRef: "DL-22019",
      dates: {},
      letterDate: "2026-09-14T08:00:00.000Z",
    });
    assert.match(letter.text, /Client's driver: Aled Morgan/);
    assert.match(letter.text, /Their Insured's Vehicle: Ford Transit AB12 CDE/);
    assert.match(letter.text, /vehicle repair charges and credit hire charges/);
    assert.equal(letter.missing.length, 0);
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

  it("copies rate-rebuttal case-law citations exactly and flags solicitor sign-off", () => {
    const letter = generateLetter("rebuttal_rate", {
      fileReference: "TEST-0003",
      clientName: "Ceri Walsh",
      handlerName: "Tom Hughes",
      accidentAt: "2026-09-09T07:00:00.000Z",
      accidentLocation: "M4 Junction 42, Swansea",
      circumstances: "Undriveable after offside impact.",
      registration: "SA12 CWA",
      make: "Volkswagen",
      model: "Golf",
      tpInsurer: "Zurich",
      tpPolicyOrClaimRef: "ZU-CL-2201",
      ownInsurer: "Direct Line",
      ownPolicyRef: "DL-22019",
      dates: {},
      letterDate: "2026-09-14T08:00:00.000Z",
    });
    assert.match(letter.text, /Stevens v Equity Syndicate Management Ltd/);
    assert.match(letter.text, /\[2015\] EWCA Civ 93/);
    assert.match(letter.text, /Dimond v Lovell/);
    assert.match(letter.text, /Neil McBride v UK Insurance Ltd; Peter Clayton v EUI Ltd/);
    assert.match(letter.text, /Bunting v Zurich/);
    assert.equal(letter.legalSignOffRequired, true);
    assert.match(letter.text, /solicitor sign-off/i);
  });
});

describe("CAS email templates", () => {
  it("builds an outgoing welcome message from file data without inventing the mailbox", () => {
    const email = generateEmail("client_welcome", {
      ...emptyCorrespondenceFields(),
      fileReference: "TEST-0001",
      clientName: "Aled Morgan",
      handlerName: "Sian Evans",
      accidentAt: "2026-09-16T08:00:00.000Z",
      accidentLocation: "Newport Road, Cardiff",
      circumstances: "Rear-end collision.",
      registration: "CF11 ALE",
      make: "Ford",
      model: "Focus",
      tpInsurer: "Unknown",
      tpPolicyOrClaimRef: "Unknown",
      ownInsurer: "Unknown",
      ownPolicyRef: "Unknown",
      dates: {},
      letterDate: "2026-09-18T08:00:00.000Z",
      clientEmail: "aled@example.test",
    });
    assert.equal(email.message.to, "aled@example.test");
    assert.match(email.message.subject, /TEST-0001/);
    assert.match(email.message.body, /Aled Morgan/);
    assert.match(email.message.body, /statement of means/);
  });

  it("exposes every supplied CAS template in the create-document list", () => {
    const keys = DOCUMENT_TEMPLATES.map((t) => t.key);
    for (const key of [
      "initial_tp_insurer",
      "engineer_instruction",
      "hire_pack_cover",
      "rebuttal_rate",
      "rebuttal_need",
      "rebuttal_duration",
      "impecuniosity_disclosure",
      "total_loss_cessation",
      "internal_chase",
      "client_welcome",
      "payment_chase_1",
      "payment_chase_2",
      "client_total_loss_update",
      "client_status_update",
      "vehicle_ready",
      "case_closed",
    ]) {
      assert.ok(keys.includes(key as never), `missing ${key}`);
    }
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

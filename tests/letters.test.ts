import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateLetter } from "../src/lib/documents/templates.ts";
import { generateEmail } from "../src/lib/documents/email-templates.ts";
import { DOCUMENT_TEMPLATES } from "../src/lib/documents/catalog.ts";
import { emptyCorrespondenceFields } from "../src/lib/documents/correspondence.ts";
import { latestDates } from "../src/lib/domain/events.ts";
import { SimulatedEmailGateway } from "../src/lib/email/gateway.ts";
import { SimulatedPhoneGateway } from "../src/lib/phone/gateway.ts";

const baseLetter = {
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
};

describe("letters from file dates", () => {
  it("builds the non-fault TPI letter from recorded facts and lists missing fields", () => {
    const letter = generateLetter("initial_tp_insurer", baseLetter);
    assert.match(letter.subject, /Uninsured losses — TEST-0003/);
    assert.match(letter.text, /Our Reference: TEST-0003\/TH\/Tom Hughes/);
    assert.match(letter.text, /Dear Sir \/ Madam,/);
    assert.match(letter.text, /We act on behalf of Ceri Walsh in respect of uninsured losses arising from the above road traffic accident/);
    assert.match(letter.text, /Accordingly, we place you on notice of our client's claim/);
    assert.match(letter.text, /vehicle repair charges and credit hire charges/);
    assert.match(letter.text, /Full supporting documentation is being provided with our covering email/);
    assert.match(letter.text, /your claim reference/);
    assert.match(letter.text, /relevant insurer\/claims handler for vehicle \[not yet on file\]/);
    assert.match(letter.text, /that indemnity is in place/);
    assert.match(letter.text, /your position on liability/);
    assert.match(letter.text, /All future correspondence regarding this matter should be directed to ourselves/);
    assert.match(letter.text, /Our Insured's Vehicle: Volkswagen Golf SA12 CWA/);
    assert.match(letter.text, /Accident Date:/);
    assert.match(letter.text, /Accident Time:/);
    assert.match(letter.text, /Accident Location: M4 Junction 42, Swansea/);
    assert.doesNotMatch(letter.text, /Our Client's Driver:/);
    assert.doesNotMatch(letter.text, /c\/o /);
    assert.ok(letter.missing.includes("Third-party insurer"));
    assert.ok(letter.missing.includes("Third-party policy number"));
    assert.ok(letter.missing.includes("Third-party registration"));
    assert.match(letter.text, /\[not yet on file\]/);
    assert.doesNotMatch(letter.text, /Policy Number -\s*$/m);
  });

  it("shows the client's driver and TPI handler only when those facts are known", () => {
    const letter = generateLetter("initial_tp_insurer", {
      ...baseLetter,
      clientName: "Example Logistics Ltd",
      clientDriverName: "Aled Morgan",
      tpInsurer: "Zurich",
      tpHandlerName: "Jane Patel",
      tpPolicyOrClaimRef: "ZU-CL-2201",
      tpPolicyNumber: "ZU-POL-991",
      tpVehicleMake: "Ford",
      tpVehicleModel: "Transit",
      tpVehicleReg: "AB12 CDE",
    });
    assert.match(letter.text, /c\/o Jane Patel/);
    assert.match(letter.text, /Our Client's Driver: Aled Morgan/);
    assert.match(letter.text, /Your Insured's Vehicle: Ford Transit AB12 CDE/);
    assert.match(letter.text, /relevant insurer\/claims handler for vehicle AB12 CDE/);
    assert.equal(letter.missing.length, 0);
  });

  it("builds the fault letter to the client's own insurer and includes courtesy wording only when allocated", () => {
    const withoutCourtesy = generateLetter("fault_own_insurer", {
      ...baseLetter,
      fileReference: "TEST-0004",
      clientName: "Dafydd Jones",
      handlerName: "Megan Price",
      ownInsurer: "Aviva",
      ownInsurerAddress: "1 Surrey Street, Norwich, NR1 3NG",
      ownPolicyRef: "AV-10028",
      registration: "CF31 DJO",
      make: "Vauxhall",
      model: "Astra",
      accidentLocation: "A48, Bridgend",
      circumstances: "Fault claim. Client needs a courtesy car while repairs are arranged.",
      courtesyAllocated: false,
    });
    assert.match(withoutCourtesy.text, /Our Reference: TEST-0004\/MP\/Megan Price/);
    assert.match(withoutCourtesy.text, /Aviva/);
    assert.match(withoutCourtesy.text, /1 Surrey Street, Norwich, NR1 3NG/);
    assert.match(withoutCourtesy.text, /Policy Number – AV-10028/);
    assert.match(withoutCourtesy.text, /We act on behalf of your policyholder, Dafydd Jones/);
    assert.match(withoutCourtesy.text, /Circumstances: Fault claim/);
    assert.match(withoutCourtesy.text, /We have been instructed to manage the repair of the insured vehicle on our client's behalf\./);
    assert.doesNotMatch(withoutCourtesy.text, /courtesy vehicle while repairs are carried out/);
    assert.match(withoutCourtesy.text, /authorisation to arrange payment of repairs\./);
    assert.doesNotMatch(withoutCourtesy.text, /and provision of a courtesy vehicle/);
    assert.equal(withoutCourtesy.missing.length, 0);

    const withCourtesy = generateLetter("fault_own_insurer", {
      ...baseLetter,
      fileReference: "TEST-0004",
      clientName: "Dafydd Jones",
      handlerName: "Megan Price",
      ownInsurer: "Aviva",
      ownInsurerAddress: "1 Surrey Street, Norwich, NR1 3NG",
      ownPolicyRef: "AV-10028",
      registration: "CF31 DJO",
      make: "Vauxhall",
      model: "Astra",
      courtesyAllocated: true,
    });
    assert.match(withCourtesy.text, /and to arrange a courtesy vehicle while repairs are carried out/);
    assert.match(withCourtesy.text, /authorisation to arrange payment of repairs, and provision of a courtesy vehicle/);
  });

  it("flags missing accident circumstances instead of leaving a blank gap", () => {
    const letter = generateLetter("fault_own_insurer", {
      ...baseLetter,
      circumstances: "",
      ownInsurer: "Aviva",
      ownInsurerAddress: "1 Surrey Street, Norwich",
      ownPolicyRef: "AV-10028",
    });
    assert.ok(letter.missing.includes("Accident circumstances"));
    assert.match(letter.text, /Circumstances: \[not yet on file\]/);
    assert.doesNotMatch(letter.text, /Circumstances:\s*$/m);
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
      "fault_own_insurer",
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

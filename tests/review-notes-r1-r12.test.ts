import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { closeDeliveriesForStartedHires } from "../src/lib/db/demo-jobs.ts";
import { signAtDoorstep } from "../src/lib/db/esign.ts";
import { generateHireAgreementDocument } from "../src/lib/db/hire-agreement.ts";
import { chooseHireCar, completeHireHandover, saveHireNeed } from "../src/lib/db/hire-choice.ts";
import { saveBeforeSigning } from "../src/lib/db/hire-out-readings.ts";
import { agreementMandatoryGaps } from "../src/lib/db/hire-readiness.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { approveLegalDocument, markLegalDocumentSent, unapprovedLegalAttachment } from "../src/lib/db/legal-approval.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { listClaimHandlers } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow, londonTodayIso } from "../src/lib/dates.ts";
import { generationMarksStep } from "../src/lib/documents/catalog.ts";
import { generateNonFaultTpInsurerLetter } from "../src/lib/documents/notification-letters.ts";
import { prepareAgreementItems, recordPassingPrehireChecks } from "./prehire-setup.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-"));
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function drawnSignature(): string {
  const canvas = createCanvas(600, 180);
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.moveTo(40, 120);
  ctx.lineTo(520, 110);
  ctx.stroke();
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

function carChosen(claimId = "c1") {
  saveHireNeed({ claimId, choice: "yes", reason: "Car cannot be driven.", actorId: "staff-sian", submitKey: `need-${claimId}` });
  chooseHireCar({
    claimId,
    fleetVehicleId: "fv-10",
    method: "deliver",
    date: londonTodayIso(),
    time: "10:00",
    address: "1 Test Street, Cardiff",
    actorId: "staff-sian",
    submitKey: `choose-${claimId}`,
    driverId: "staff-driver",
  });
  recordPassingPrehireChecks(claimId);
  prepareAgreementItems(claimId);
}

describe("R1 — what the client signs", () => {
  it("needs mileage and fuel out, transmission and licence date of issue before the agreement, and never prints a staff placeholder", () => {
    const db = prepared();
    withDatabase(db, () => {
      carChosen();
      run(`UPDATE hire_episodes SET out_mileage = NULL, out_fuel_level = NULL WHERE claim_id = 'c1'`);
      run(`UPDATE vehicles SET transmission = NULL WHERE id = (SELECT fv.vehicle_id FROM fleet_vehicles fv WHERE fv.id = 'fv-10')`);
      run(`UPDATE people SET licence_issued_on = NULL WHERE id = (SELECT client_person_id FROM claims WHERE id = 'c1')`);
      const keys = agreementMandatoryGaps("c1").map((gap) => gap.key);
      assert.ok(keys.includes("readings-out"));
      assert.ok(keys.includes("transmission"));
      assert.ok(keys.includes("licence-issued"));
      assert.throws(() => generateHireAgreementDocument("c1", "staff-sian"), /mileage and fuel out/i);
      assert.throws(() => saveBeforeSigning({ claimId: "c1", actorId: "staff-sian", mileage: "abc", fuelLevel: "half" }), /whole number/);
      saveBeforeSigning({ claimId: "c1", actorId: "staff-sian", mileage: "23,456", fuelLevel: "half", transmission: "Automatic", licenceIssuedOn: "2016-03-01" });
      assert.deepEqual(agreementMandatoryGaps("c1"), []);
      const made = generateHireAgreementDocument("c1", "staff-sian");
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [made.documentId])?.body_html);
      assert.match(html, /Mileage at delivery: 23,456/);
      assert.match(html, /Fuel level at delivery: ½/);
      assert.match(html, /Transmission: Automatic/);
      assert.match(html, /01\/03\/2016/);
      assert.doesNotMatch(html, /Missing — not guessed/);
      assert.doesNotMatch(html, /not entered/);
      assert.doesNotMatch(html, /Date out: <span class="missing">/);
    });
    db.close();
  });
});

describe("R2 and R3 — handover time and signed status", () => {
  it("refuses a handover time before the electronic signature unless a reason is given, and the record says how it was signed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      carChosen();
      generateHireAgreementDocument("c1", "staff-sian");
      await signAtDoorstep({ claimId: "c1", actorId: "staff-driver", name: "Aled Morgan", signaturePng: drawnSignature(), agreed: true, device: "test phone", ip: "" });
      const base = { claimId: "c1", mileage: 100, fuelLevel: "full", driverId: "staff-driver", date: londonTodayIso(), actorId: "staff-sian" };
      assert.throws(() => completeHireHandover({ ...base, time: "00:00", submitKey: "early" }), /before the agreement was signed/);
      completeHireHandover({ ...base, time: "00:00", submitKey: "early-reason", timingReason: "Car went out first, client signed at the yard later" });
      const record = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c1' AND event_type = 'vehicle_handover_recorded' ORDER BY recorded_at DESC LIMIT 1`);
      assert.match(String(record?.details), /Hire agreement signed electronically by Aled Morgan/);
      assert.doesNotMatch(String(record?.details), /(?<!sheet )Not signed\./);
      assert.match(String(record?.details), /Reason: Car went out first/);
      const job = get<{ completed_at: string | null }>(`SELECT completed_at FROM day_assignments WHERE claim_id = 'c1' AND job_kind = 'hire_delivery'`);
      assert.ok(job?.completed_at, "the delivery job is closed when the hire starts");
    });
    db.close();
    assert.match(read("src/components/claims/HireJourney.tsx"), /defaultValue=\{londonTimeNow\(\)\}/);
  });
});

describe("R4 — driver jobs", () => {
  it("closes a delivery job whose hire has started, with a history note", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE hire_episodes SET started_at = '2026-10-20T10:00:00.000Z' WHERE id = 'h-c3'`);
      run(
        `INSERT INTO day_assignments(id, assignee_id, job_kind, claim_id, hire_episode_id, work_date, created_at, created_by)
         VALUES ('job-r4', 'staff-driver', 'hire_delivery', 'c3', 'h-c3', '2026-10-20', '2026-10-19T09:00:00.000Z', 'staff-sian')`,
      );
      closeDeliveriesForStartedHires(db);
      assert.ok(get<{ completed_at: string | null }>(`SELECT completed_at FROM day_assignments WHERE id = 'job-r4'`)?.completed_at);
      assert.match(String(get<{ details: string }>(`SELECT details FROM claim_events WHERE id = 'ev-close-job-r4'`)?.details), /Data repair/);
    });
    db.close();
    assert.match(read("src/app/driver-jobs/page.tsx"), /Done today/);
  });
});

describe("R5 — insurer letters carry the insurer's reference", () => {
  it("shows the claim reference held, does not ask for it, and prints the date once", () => {
    const base = {
      fileReference: "TEST-0026",
      handlerName: "Sian Evans",
      letterDate: "2026-10-29T12:00:00.000Z",
      clientName: "Rhodri Reviewtest",
      tpInsurer: "Example Insurance Ltd",
      tpPolicyOrClaimRef: "EX-123456",
      tpPolicyNumber: "",
    } as unknown as Parameters<typeof generateNonFaultTpInsurerLetter>[0];
    const letter = generateNonFaultTpInsurerLetter(base);
    assert.match(letter.text, /Your Reference: EX-123456/);
    assert.doesNotMatch(letter.text, /Policy Number/);
    assert.doesNotMatch(letter.text, /your claim reference/);
    assert.equal((letter.html.match(/29\/10\/2026/g) || []).length, 1);
    const neither = generateNonFaultTpInsurerLetter({ ...base, tpPolicyOrClaimRef: "", tpPolicyNumber: "" });
    assert.match(neither.text, /Your Reference: Unknown|\[not yet on file\]/);
    assert.match(neither.text, /your claim reference/);
  });
});

describe("R6 to R11 — clutter, wording and handlers", () => {
  it("keeps code words off the Messages page, folds its sections, and shows one email status line", () => {
    const comms = read("src/components/claim-file/CommsDesk.tsx");
    assert.match(comms, /Email: simulated – nothing leaves the CRM/);
    assert.match(comms, /<Fold key="documents"/);
    assert.doesNotMatch(read("src/lib/claim-screens.ts"), /EMAIL_SEND_MODE/);
  });

  it("shows step 10 recovery as Not started until the recovery is recorded", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const form = new FormData();
      form.set("client_forename", "Rhodri");
      form.set("client_surname", "Review");
      form.set("client_mobile", "07700900777");
      form.set("handlerId", "staff-sian");
      form.set("accidentDate", isoDateFromNow(-1));
      form.set("accidentTime", "08:15");
      form.set("claimType", "non_fault");
      form.set("roadworthiness", "unroadworthy");
      form.set("needsRecovery", "yes");
      form.set("recoveryFormVersion", "fees");
      form.set("recoveryLocation", "Newport Road");
      form.set("recoveryTick_standard", "yes");
      form.set("recoveryAmount_standard", "395");
      const claim = await createClaimFromIntake(intakeFromFormData(form));
      const payments = loadClaimSteps(claim.id)?.find((step) => step.key === "payments");
      assert.equal(payments?.lines.find((line) => line.label === "Recovery")?.date, "Not started");
    });
    db.close();
  });

  it("folds the old recovery blocks, makes the dashboard counts open matching lists, names the next hire item, and offers only office handlers", async () => {
    const recovery = read("src/app/claims/[id]/heads/recovery/page.tsx");
    assert.match(recovery, /More – recoverer details/);
    assert.match(recovery, /data-recovery-money/);
    const dashboard = read("src/app/page.tsx");
    assert.match(dashboard, /Open claims by next step/);
    assert.match(dashboard, /href: workLink\("today"\)/);
    assert.match(read("src/lib/domain/claim-steps.ts"), /"Hire agreement – sign"/);
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const roles = new Set(listClaimHandlers().map((person) => person.role));
      assert.equal(roles.has("driver"), false);
      assert.equal(roles.has("mechanic"), false);
      const form = new FormData();
      form.set("client_forename", "Hywel");
      form.set("client_mobile", "07700900778");
      form.set("handlerId", "staff-driver");
      form.set("accidentDate", isoDateFromNow(-1));
      form.set("claimType", "non_fault");
      form.set("roadworthiness", "roadworthy");
      await assert.rejects(() => createClaimFromIntake(intakeFromFormData(form)), /office staff/);
    });
    db.close();
  });
});

describe("R12 — legal letters need Justin's approval", () => {
  it("lets a draft be generated, but not marked as sent or emailed until Justin approves it", () => {
    assert.equal(generationMarksStep("rebuttal_rate"), false);
    assert.equal(generationMarksStep("impecuniosity_disclosure"), false);
    const db = prepared();
    withDatabase(db, () => {
      run(
        `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, created_at)
         VALUES ('doc-reb', 'c3', 'Rebuttal — hire rate', 'letter', 1, 0, 1, '<p>Draft</p>', 'rebuttal_rate', '2026-10-29T10:00:00.000Z')`,
      );
      assert.throws(() => markLegalDocumentSent({ documentId: "doc-reb", actorId: "staff-sian" }), /Needs Justin's approval/);
      assert.match(String(unapprovedLegalAttachment("c3", ["doc-reb"])), /Needs Justin's approval/);
      assert.throws(() => approveLegalDocument({ documentId: "doc-reb", actorId: "staff-sian" }), /Only Justin/);
      approveLegalDocument({ documentId: "doc-reb", actorId: "staff-justin" });
      assert.equal(unapprovedLegalAttachment("c3", ["doc-reb"]), null);
      markLegalDocumentSent({ documentId: "doc-reb", actorId: "staff-sian" });
      const sent = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'rebuttal_sent' ORDER BY recorded_at DESC LIMIT 1`);
      assert.match(String(sent?.details), /Approved by Justin/);
    });
    db.close();
  });
});

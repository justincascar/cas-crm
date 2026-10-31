import { saveFleetDetail } from "../src/lib/db/fleet-details.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { all, get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { fleetAvailability } from "../src/lib/db/fleet-availability.ts";
import { startVehicleSwap, swapAgreementLines } from "../src/lib/db/vehicle-swap.ts";
import { hireGroupCheck, saveHireGroupCheck } from "../src/lib/db/hire-group-check.ts";
import { agreementMandatoryGaps } from "../src/lib/db/hire-readiness.ts";
import { combinedChaseEmail, runAutomaticChasers, setChaseRuleApproval, tidyLongOverdueDemoChases } from "../src/lib/db/auto-chasers.ts";
import { chaseForClaim, listDueChases } from "../src/lib/db/chase.ts";
import { readReportOutcome, saveReportOutcome } from "../src/lib/db/report-outcome.ts";
import { justificationChronology } from "../src/lib/domain/justification-chronology.ts";
import { sentStatusWords } from "../src/lib/domain/chase-status.ts";
import { correctUnprovenSentEmails } from "../src/lib/db/sent-status-repair.ts";
import { isCar } from "../src/lib/db/hire-choice.ts";
import { generateNonFaultTpInsurerLetter } from "../src/lib/documents/notification-letters.ts";
import { emptyCorrespondenceFields, wrapLetter } from "../src/lib/documents/correspondence.ts";
import { SEEDED_ENGINEER, listActiveEngineers, setClaimEngineer } from "../src/lib/db/engineers.ts";
import { companyFooterLines, getCompanyDetails } from "../src/lib/db/company-details.ts";
import { headedPaperVariant } from "../src/lib/documents/headed-paper.ts";
import { londonTodayIso } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-r27-"));
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const readings = {
  oldMileageIn: "23,410",
  oldFuelIn: "half",
  oldCondition: "No new damage.",
  newMileageOut: "11200",
  newFuelOut: "full",
  newCondition: "No damage.",
};

/** A free car with no gearbox, seats or group on its fleet record (as most of the real fleet). */
function freeCarMissingDetails(db: DatabaseSync, claimId: string): string {
  const today = londonTodayIso();
  const current = get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE claim_id = ?`, [claimId])?.fleet_vehicle_id;
  const free = fleetAvailability({ startAt: `${today}T10:00:00.000Z`, endAt: `${today}T23:00:00.000Z`, ignoreClaimId: claimId }).find(
    (row) => row.free && row.state !== "removed" && row.carId !== current,
  );
  assert.ok(free, "a free car to swap to");
  db.prepare(`UPDATE vehicles SET transmission = NULL, seats = NULL, gta_group = NULL WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = ?)`).run(free.carId);
  return free.carId;
}

describe("R27 — the group checks before an agreement", () => {
  it("needs the client's own car group or a reason, and a written reason to charge above the car supplied", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE vehicles SET gta_group = NULL, gta_unclassified_reason = NULL WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c3')`).run();
      assert.ok(agreementMandatoryGaps("c3").some((gap) => gap.key === "client-group"));
      assert.throws(() => saveHireGroupCheck({ claimId: "c3", actorId: "staff-sian", clientGroup: "", clientGroupReason: "", aboveSuppliedReason: "" }), /cannot be classified/);
      saveHireGroupCheck({ claimId: "c3", actorId: "staff-sian", clientGroup: "", clientGroupReason: "Imported car, no GTA group published", aboveSuppliedReason: "" });
      assert.ok(!agreementMandatoryGaps("c3").some((gap) => gap.key === "client-group"));

      // Charge S2 on a car supplied as S1.
      const fleet = get<{ fleet_vehicle_id: string }>(`SELECT fleet_vehicle_id FROM hire_episodes WHERE claim_id = 'c3'`)!.fleet_vehicle_id;
      db.prepare(`UPDATE vehicles SET gta_group = 'S1' WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = ?)`).run(fleet);
      db.prepare(`INSERT OR IGNORE INTO hire_pack_data(claim_id, updated_at) VALUES ('c3', '2026-10-31T10:00:00.000Z')`).run();
      db.prepare(`UPDATE hire_pack_data SET group_charged = 'S2' WHERE claim_id = 'c3'`).run();
      const check = hireGroupCheck("c3");
      assert.equal(check.chargedAboveSupplied, true);
      assert.ok(check.gaps.some((gap) => gap.key === "above-supplied" && /group S2 when the car supplied is group S1/.test(gap.label)));
      assert.throws(() => saveHireGroupCheck({ claimId: "c3", actorId: "staff-sian", clientGroup: "", clientGroupReason: "", aboveSuppliedReason: "" }), /reason for charging group S2/);
      saveHireGroupCheck({ claimId: "c3", actorId: "staff-sian", clientGroup: "", clientGroupReason: "", aboveSuppliedReason: "Only an S1 car was free on the day" });
      assert.equal(hireGroupCheck("c3").gaps.length, 0);
      const note = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'hire_group_check' ORDER BY recorded_at DESC LIMIT 1`);
      assert.match(String(note?.details), /Only an S1 car was free on the day.*rate stays on group S2/);
      // A different car needs its own reason.
      db.prepare(`UPDATE vehicles SET gta_group = 'M1' WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = ?)`).run(fleet);
      assert.equal(hireGroupCheck("c3").aboveSuppliedReason, "");
    });
    db.close();
  });
});

describe("R28 and R29 — the swap agreement", () => {
  it("R60: refuses a replacement car missing details until it is completed in Fleet, then produces a new agreement with its own number", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE vehicles SET gta_unclassified_reason = 'Fictional test car' WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c3')`).run();
      const car = freeCarMissingDetails(db, "c3");
      const base = { claimId: "c3", actorId: "staff-sian", newFleetVehicleId: car, date: londonTodayIso(), time: "10:30", ...readings };
      assert.throws(() => startVehicleSwap(base), /fleet record has no .*Complete it in Fleet/);
      // Typed details on the swap are not used: the fleet record is the only place they are entered.
      assert.throws(() => startVehicleSwap({ ...base, details: { transmission: "Automatic", seats: "5", gtaGroup: "S3" } }), /Complete it in Fleet/);
      for (const [field, value] of [["transmission", "Automatic"], ["seats", "5"], ["gtaGroup", "S3"], ["fuel", "Petrol"], ["colour", "Blue"]] as const) {
        saveFleetDetail({ fleetVehicleId: car, field, value, actorId: "staff-sian" });
      }
      const before = get<{ hire_agreement_number: string | null }>(`SELECT hire_agreement_number FROM claims WHERE id = 'c3'`)?.hire_agreement_number;
      const result = startVehicleSwap({ ...base, aboveSuppliedReason: "Test" });
      const saved = get<{ transmission: string; seats: number; gta_group: string }>(
        `SELECT v.transmission, v.seats, v.gta_group FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.id = ?`,
        [car],
      )!;
      assert.deepEqual([saved.transmission, saved.seats, saved.gta_group], ["Automatic", 5, "S3"]);
      const doc = get<{ title: string; version: number; body_html: string }>(`SELECT title, version, body_html FROM documents WHERE id = ?`, [result.agreementDocumentId]);
      const number = String(doc?.title).match(/TEST-HA-\d{6}/)?.[0];
      assert.ok(number && number !== before, "a new agreement number");
      assert.equal(doc?.version, 1);
      if (before) assert.match(String(doc?.title), new RegExp(`replaces ${before}`));
      assert.match(String(doc?.body_html), /Transmission: Automatic/);
      assert.match(String(doc?.body_html), /Seats: 5/);
      const reg = get<{ registration: string }>(`SELECT v.registration FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.id = ?`, [car])!.registration;
      assert.match(String(doc?.body_html), new RegExp(`internal-note">The hire vehicle page is included because a hire vehicle is allocated \\([^)]*${reg}\\)`));
      const lines = swapAgreementLines("c3");
      assert.equal(lines.at(-1)?.state, "awaiting signature");
    });
    db.close();
  });
});

describe("R30 and R31 — the automatic chaser", () => {
  const tuesdayTen = new Date("2026-11-03T10:00:00.000Z");
  const sundayTen = new Date("2026-11-01T10:00:00.000Z");

  it("sends nothing until Justin approves the wording, nothing outside the sending hours, then one simulated chaser that restarts the clock", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      db.prepare("UPDATE claim_third_parties SET insurer_email = ? WHERE claim_id = ?").run("claims@example.org", "c5");
      assert.ok(chaseForClaim("liability_response", "c5")?.due);
      const held = await runAutomaticChasers(tuesdayTen);
      assert.equal(held.emails, 0);
      assert.ok(held.held.some((row) => /approve this chaser's wording/.test(row.why)));
      assert.throws(() => setChaseRuleApproval({ kind: "liability_response", approved: true, actorId: "staff-sian" }), /Only Justin/);
      setChaseRuleApproval({ kind: "liability_response", approved: true, actorId: "staff-justin" });
      const weekend = await runAutomaticChasers(sundayTen);
      assert.equal(weekend.emails, 0);
      assert.match(weekend.outcome, /Outside the sending hours/);

      const sent = await runAutomaticChasers(tuesdayTen);
      assert.equal(sent.emails, 1);
      const email = get<{ sent_status: string; subject: string }>(
        `SELECT sent_status, subject FROM correspondence WHERE claim_id = 'c5' AND template_key = 'liability_response_chase' ORDER BY created_at DESC LIMIT 1`,
      );
      assert.equal(email?.sent_status, "simulated_sent");
      const filed = get<{ details: string; source: string }>(
        `SELECT details, source FROM claim_events WHERE claim_id = 'c5' AND event_type = 'outgoing_email' ORDER BY recorded_at DESC LIMIT 1`,
      );
      assert.match(String(filed?.details), /automatic chaser.*simulated/);
      assert.equal(filed?.source, "system");
      // However long it was due, one email goes: run again at the same time and nothing more is sent.
      const again = await runAutomaticChasers(tuesdayTen);
      assert.equal(again.emails, 0);
    });
    db.close();
  });

  it("puts chasers due to the same recipient on the same file in one email listing each item", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      db.prepare("UPDATE claim_third_parties SET insurer_email = ? WHERE claim_id = ?").run("claims@example.org", "c5");
      // TEST-0005 has a liability chase and an engineer-report chase due. Here both go to one address.
      db.prepare(
        `INSERT INTO engineers(id, name, address, email, active, created_at, updated_at)
         VALUES ('eng-shared', 'Shared Desk (fictional)', '1 Example Street', 'claims@example.org', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      ).run();
      db.prepare("UPDATE claims SET engineer_id = 'eng-shared' WHERE id = 'c5'").run();
      const both = listDueChases(tuesdayTen.toISOString()).filter((row) => row.claimId === "c5" && row.contactEmail === "claims@example.org");
      assert.deepEqual(both.map((row) => row.kind).sort(), ["engineer_report", "liability_response"]);
      setChaseRuleApproval({ kind: "liability_response", approved: true, actorId: "staff-justin" });
      setChaseRuleApproval({ kind: "engineer_report", approved: true, actorId: "staff-justin" });
      const result = await runAutomaticChasers(tuesdayTen);
      assert.equal(result.emails, 1);
      assert.equal(result.chases, 2);
      const combined = get<{ subject: string; body: string; sent_status: string }>(
        `SELECT subject, body, sent_status FROM correspondence WHERE claim_id = 'c5' AND template_key = 'combined_chase'`,
      );
      assert.match(String(combined?.subject), /2 outstanding items/);
      assert.equal(combined?.sent_status, "simulated_sent");
      assert.match(String(combined?.body), /1\. .*\n\n[\s\S]*2\. /);
      const items = all<{ sent_status: string }>(`SELECT sent_status FROM correspondence WHERE claim_id = 'c5' AND template_key != 'combined_chase' AND sent_status = 'combined_chase_item'`);
      assert.equal(items.length, 2);
      assert.equal(listDueChases(tuesdayTen.toISOString()).filter((row) => row.claimId === "c5").length, 0);
    });
    db.close();
    const email = combinedChaseEmail("TEST-0099", [
      { title: "Liability response chase", body: "Dear Claims Team,\n\nWe have not yet received a liability decision.\n\nKind regards,\nSian\nComplete Accident Solutions Ltd" },
      { title: "Repair authorisation chase", body: "Dear Claims Team,\n\nOur request for your decision remains outstanding.\n\nKind regards,\nSian\nComplete Accident Solutions Ltd" },
    ]);
    assert.match(email.subject, /TEST-0099 — 2 outstanding items/);
    assert.match(email.body, /^Dear Claims Team,/);
    assert.match(email.body, /1\. Liability response chase\n\nWe have not yet received a liability decision\./);
    assert.match(email.body, /2\. Repair authorisation chase\n\nOur request for your decision remains outstanding\./);
    assert.equal(email.body.match(/Kind regards/g)?.length, 1);
  });
});

describe("R32 — the outcome at step 6", () => {
  it("checks the figures and puts the estimate on the Repairs head as claimed only", () => {
    assert.throws(() => readReportOutcome({ claimId: "c1", actorId: "x", outcome: "" }), /Choose repairable/);
    assert.throws(() => readReportOutcome({ claimId: "c1", actorId: "x", outcome: "repairable", estimateNet: "1000", estimateVat: "200", estimateGross: "1300" }), /does not add up/);
    assert.throws(() => readReportOutcome({ claimId: "c1", actorId: "x", outcome: "total_loss", pav: "4000", salvageCategory: "Z", salvageDeduction: "500" }), /salvage category/);
    const db = prepared();
    withDatabase(db, () => {
      const before = get<{ agreed_pence: number; received_pence: number }>(`SELECT agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c1' AND head_of_loss = 'repairs'`);
      saveReportOutcome({ claimId: "c1", actorId: "staff-sian", outcome: "repairable", estimateNet: "1,000.00", estimateVat: "200", estimateGross: "", occurredOn: londonTodayIso() });
      const line = get<{ claimed_pence: number; agreed_pence: number; received_pence: number }>(
        `SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c1' AND head_of_loss = 'repairs'`,
      )!;
      assert.equal(line.claimed_pence, 120000);
      assert.equal(line.agreed_pence, before?.agreed_pence ?? 0);
      assert.equal(line.received_pence, before?.received_pence ?? 0);
      const screen = get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = 'c1' AND screen_key = 'assessed-damage'`);
      assert.equal(JSON.parse(String(screen?.data_json)).totalLoss, "no");
    });
    db.close();
  });
});

describe("R33 — the hire on the chronology", () => {
  const base = (id: string, type: string, at: string, details = "", recorded?: string) => ({ id, event_type: type, title: "", details, occurred_at: at, recorded_at: recorded || at });
  it("lists the hire, the swap, the signed agreements and payments on a credit-hire file, and today's steps at the time recorded", () => {
    const events = [
      base("a", "accident", "2026-10-30T17:40:00.000Z"),
      base("h", "hire_started", "2026-10-31T10:44:00.000Z"),
      base("s", "document_filed", "2026-10-31T10:44:22.000Z", "Hire Agreement TEST-HA-000009 (version 1) signed electronically by Eira Retest at the handover."),
      base("lic", "document_filed", "2026-10-31T10:43:45.000Z", "Licence check filed on the file."),
      base("l", "initial_letter_tp_insurer", "2026-10-31T10:47:43.000Z", "Marked as sent by Sian"),
      base("e", "engineer_instructed", "2026-10-31T09:00:00.000Z", "Engineer instructed.", "2026-10-31T10:55:00.000Z"),
      base("p", "head_payment_logged", "2026-10-31T10:49:34.000Z", "head=recovery amount_pence=47400 correction=0 received_pence=47400"),
      base("w", "hire_vehicle_changed", "2026-10-31T10:50:50.000Z", "Hire car changed."),
    ];
    const lines = justificationChronology(events, { creditHire: true });
    assert.deepEqual(lines.map((line) => line.id), ["a", "h", "s", "l", "p", "w", "e"]);
    assert.equal(lines.find((line) => line.id === "s")?.title, "Hire agreement signed");
    assert.equal(lines.find((line) => line.id === "p")?.details, "Recovery payment received: £474.00.");
    // A fault courtesy car is not credit hire.
    assert.ok(!justificationChronology(events).some((line) => line.id === "h" || line.id === "s"));
  });
});

describe("R34 — plain words, and sent only with evidence", () => {
  it("shows statuses in words and corrects rows stored as sent without a mailbox", () => {
    assert.equal(sentStatusWords("simulated_sent"), "Simulated (not sent to a real mailbox)");
    assert.equal(sentStatusWords("simulated_logged"), "Recorded only (simulated)");
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(
        `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
         VALUES ('corr-old', 'c1', 'outgoing', 'email', 'Old update', '', '', 'client@example.com', 'claims@cascar.co.uk', 0, 'sent', '2026-10-02T12:00:00.000Z')`,
      ).run();
      // Fictional chases long past due are paused once, with a note; nothing is sent.
      const asAt = "2026-12-31T10:00:00.000Z";
      const overdue = listDueChases(asAt).filter((row) => row.kind !== "hire_agreement_renewal").length;
      assert.ok(overdue > 0);
      assert.equal(tidyLongOverdueDemoChases(asAt), overdue);
      assert.equal(listDueChases(asAt).filter((row) => row.kind !== "hire_agreement_renewal").length, 0);
      assert.equal(tidyLongOverdueDemoChases(asAt), 0);
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM correspondence WHERE sent_status = 'simulated_sent' AND created_at >= '2026-12-01'`)?.n, 0);
      correctUnprovenSentEmails(db);
      correctUnprovenSentEmails(db);
      assert.equal(get<{ sent_status: string }>(`SELECT sent_status FROM correspondence WHERE id = 'corr-old'`)?.sent_status, "simulated_sent");
      const notes = all<{ details: string }>(`SELECT details FROM claim_events WHERE correspondence_id = 'corr-old'`);
      assert.equal(notes.length, 1);
      assert.match(notes[0]!.details, /always been simulated/);
    });
    db.close();
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/automations/page.tsx"), "utf8");
    assert.doesNotMatch(page, /r\.track|interval_unit|String\(r\.status\)/);
  });
});

describe("R36, R39, R40 and R41", () => {
  it("offers cars first, prints the registration alone when the make is unknown, and uses the fictional engineer", () => {
    assert.equal(isCar({ vehicleClass: "car" }), true);
    assert.equal(isCar({ vehicleClass: "" }), true);
    assert.equal(isCar({ vehicleClass: "motorcycle" }), false);
    assert.equal(isCar({ vehicleClass: "wheelchair_accessible_taxi" }), false);

    const letter = generateNonFaultTpInsurerLetter({
      ...emptyCorrespondenceFields(),
      fileReference: "TEST-0099",
      clientName: "Mrs Test",
      handlerName: "Sian",
      accidentAt: "2026-10-30T17:40:00.000Z",
      accidentLocation: "A483",
      circumstances: "Rear-ended",
      registration: "TT01 AAA",
      make: "Ford",
      model: "Fiesta",
      tpInsurer: "Example Mutual",
      tpPolicyOrClaimRef: "",
      ownInsurer: "",
      ownPolicyRef: "",
      dates: {},
      letterDate: "2026-10-31T10:00:00.000Z",
      tpVehicleReg: "TP26 XYZ",
      lossHeadsOnFile: ["vehicle repair charges", "recovery charges", "storage charges", "credit hire charges"],
    });
    assert.match(letter.text, /Your Insured's Vehicle: TP26 XYZ\n/);
    assert.ok(letter.missing.includes("Third-party vehicle make and model"));
    assert.match(letter.text, /losses include vehicle repair charges, recovery charges, storage charges and credit hire charges\./);
    assert.doesNotMatch(letter.html, /171 Cwmgarw Road/);

    const db = prepared();
    withDatabase(db, () => {
      assert.equal(SEEDED_ENGINEER.email, "engineer.test@example.org");
      assert.ok(!listActiveEngineers().some((row) => /hotmail/i.test(row.email)));
      assert.throws(() => setClaimEngineer("c5", "eng-andy-montgomery"), /live use only/);
      const footer = companyFooterLines(getCompanyDetails());
      assert.equal(footer.length, 2);
      assert.match(footer[0], /Company No 06805810 · VAT No 996 5540 63/);
      assert.doesNotMatch(footer.join(" "), /[\u{1F300}-\u{1FAFF}]/u);
    });
    db.close();
    assert.equal(headedPaperVariant("initial_tp_insurer"), "full");
    assert.equal(headedPaperVariant("hire_agreement"), "logo");
    assert.doesNotMatch(wrapLetter({ ...emptyCorrespondenceFields(), fileReference: "X" } as never, "Subject", "<p>Body</p>", "31/10/2026"), /Cwmgarw/);
  });
});

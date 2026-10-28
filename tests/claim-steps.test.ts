import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { pathAllowedForRole } from "../src/lib/auth/roles.ts";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { buildClaimSummaryModel } from "../src/lib/claims/claim-summary.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { generateClaimDocument, listClaimEvents, recordClaimEvent } from "../src/lib/db/chronology.ts";
import {
  recordAudatexEstimate,
  recordClientExcessPaid,
  recordFaultCarReturn,
  recordFaultInvoice,
  recordInspectionRoute,
  recordStepNotNeeded,
} from "../src/lib/db/claim-step-record.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { assertRepairStepRole } from "../src/lib/db/repair-progress.ts";
import { claimTabFromPath, headTabPath, workScreenTabPath } from "../src/lib/domain/claim-tabs.ts";
import {
  deriveClaimSteps,
  resolveDisplayedNextAction,
  type ClaimStepInput,
} from "../src/lib/domain/claim-steps.ts";
import { printChronology } from "../src/lib/domain/print-chronology.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

function blank(over: Partial<ClaimStepInput> = {}): ClaimStepInput {
  return {
    claimId: "c-new",
    claimType: "non_fault",
    roadworthiness: "unroadworthy",
    needsReplacement: true,
    needsRecovery: true,
    createdAt: "2026-10-01T09:00:00.000Z",
    clientName: "A Client",
    accidentAt: "2026-10-01T08:00:00.000Z",
    registration: "AB12 CDE",
    insurerExpected: true,
    insurerName: "An insurer",
    totalLoss: false,
    hasHireEvidence: false,
    prehireDone: false,
    vehicleChosen: false,
    agreementDone: false,
    dailyRatePence: null,
    recoveryFlagComplete: false,
    storageEndedOn: null,
    hireEndedOn: null,
    salvageRecorded: false,
    qualifyingOffHireOn: null,
    events: [],
    chases: [],
    payments: [],
    ...over,
  };
}

function step(input: ClaimStepInput, key: string) {
  const found = deriveClaimSteps(input).find((item) => item.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

describe("claim steps from history", () => {
  it("reads TEST-0013 from the events that are actually on the file", () => {
    const input = blank({
      claimId: "claim_e6ee0ed9-2614-4586-87fd-390c1cab4219",
      needsReplacement: false,
      needsRecovery: true,
      createdAt: "2026-10-19T16:02:51.628Z",
      clientName: "Mr Jason Roberts",
      accidentAt: "2026-10-19T13:30:00.000Z",
      registration: "CU63VLX",
      insurerName: "",
      events: [
        { event_type: "file_opened", occurred_at: "2026-10-19T16:02:51.628Z", details: "File TEST-0013 opened from staff intake." },
        { event_type: "recovery_completed", occurred_at: "2026-10-19T08:00:00.000Z", details: "Swansea Road" },
        { event_type: "storage_started", occurred_at: "2026-10-19T08:00:00.000Z", details: null },
        { event_type: "liability_status_changed", occurred_at: "2026-10-19T16:02:51.628Z", details: "Non-fault" },
        { event_type: "roadworthiness_changed", occurred_at: "2026-10-19T16:02:51.628Z", details: "Unroadworthy" },
        { event_type: "outgoing_whatsapp", occurred_at: "2026-10-19T16:05:00.000Z", details: "Not sent on WhatsApp" },
      ],
    });
    const details = step(input, "details");
    const recovery = step(input, "recovery");
    const hire = step(input, "hire");
    const letter = step(input, "initial_letter");
    const engineer = step(input, "engineer");
    assert.equal(details.state, "done");
    assert.match(details.statusText, /19\/10\/2026/);
    assert.equal(recovery.state, "done");
    assert.match(recovery.statusText, /19\/10\/2026/);
    assert.equal(hire.state, "not_decided");
    assert.equal(hire.statusText, "Not decided yet");
    assert.equal(hire.buttonLabel, "Arrange hire");
    assert.equal(letter.state, "to_do");
    assert.equal(letter.statusText, "To do");
    assert.equal(engineer.state, "to_do");
    assert.equal(engineer.statusText, "To do");
    assert.equal(details.statusText.includes("Sent"), false);
    assert.equal(letter.statusText.includes("Sent"), false);
  });

  it("keeps steps that can be done now as to do, and does not call them in progress on day one", () => {
    const steps = deriveClaimSteps(blank());
    for (const key of ["recovery", "hire", "initial_letter", "engineer"]) {
      assert.equal(steps.find((item) => item.key === key)?.state, "to_do", key);
      assert.equal(steps.find((item) => item.key === key)?.statusText, "To do", key);
    }
    assert.equal(steps.find((item) => item.key === "engineer_report")?.state, "not_started");
    assert.equal(steps.find((item) => item.key === "engineer_report")?.statusText, "Not started");
    assert.equal(steps.some((item) => item.key === "agree"), false);
  });

  it("derives TEST-0008 step 9 from the stored history and does not invent a return", () => {
    const db = prepared();
    withDatabase(db, () => {
      const events = listClaimEvents("c8");
      assert.equal(events.some((event) => event.event_type === "repairs_complete"), true);
      assert.equal(events.some((event) => event.event_type === "vehicle_returned"), false);
      const recoveryEvent = events.find((event) => event.event_type === "recovery_completed");
      assert.ok(recoveryEvent);
      assert.match(String(recoveryEvent.details || ""), /Demonstration data/);
      const steps = loadClaimSteps("c8");
      if (!steps) throw new Error("missing c8");
      const finish = steps.find((item) => item.key === "finish");
      assert.equal(finish?.state, "waiting");
      assert.equal(finish?.statusText, "Waiting on the car being returned");
      assert.equal(finish?.lines.some((line) => line.label === "Car returned to client"), false);
      assert.equal(finish?.lines.some((line) => line.label === "Repairs complete"), true);
      const recovery = steps.find((item) => item.key === "recovery");
      assert.equal(recovery?.state, "done");
      const model = buildClaimSummaryModel("c8");
      assert.equal(model?.nextAction, "Send letter");
      assert.match(model?.stageLine || "", /Initial letter to the third-party insurer · To do/);
      assert.equal(model?.staffNote, "Arrange customer collection of repaired vehicle");
      assert.equal(model?.staffNoteBy, null);
    });
  });

  it("shows the total-loss steps on TEST-0009 and does not change its offers", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = db
        .prepare(`SELECT id, head_of_loss, amount_pence, status FROM insurer_offers WHERE claim_id = 'c9' ORDER BY id`)
        .all() as Array<{ id: string; head_of_loss: string; amount_pence: number; status: string }>;
      const moneyBefore = db
        .prepare(`SELECT id, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c9' ORDER BY id`)
        .all() as Array<{ id: string; offered_pence: number; agreed_pence: number; received_pence: number }>;
      const steps = loadClaimSteps("c9");
      if (!steps) throw new Error("missing c9");
      assert.equal(steps.find((item) => item.key === "agree")?.title, "Agree valuation with the client");
      assert.equal(steps.find((item) => item.key === "send_report")?.title, "Send valuation to the insurer");
      assert.equal(steps.find((item) => item.key === "finish")?.title, "Payment received and salvage collected");
      const after = db
        .prepare(`SELECT id, head_of_loss, amount_pence, status FROM insurer_offers WHERE claim_id = 'c9' ORDER BY id`)
        .all() as Array<{ id: string; head_of_loss: string; amount_pence: number; status: string }>;
      const moneyAfter = db
        .prepare(`SELECT id, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c9' ORDER BY id`)
        .all() as Array<{ id: string; offered_pence: number; agreed_pence: number; received_pence: number }>;
      assert.equal(after.length, before.length);
      for (let index = 0; index < before.length; index += 1) {
        assert.equal(after[index]?.id, before[index]?.id);
        assert.equal(after[index]?.amount_pence, before[index]?.amount_pence);
        assert.equal(after[index]?.status, before[index]?.status);
        assert.equal(after[index]?.head_of_loss, before[index]?.head_of_loss);
      }
      assert.equal(moneyAfter.length, moneyBefore.length);
      for (let index = 0; index < moneyBefore.length; index += 1) {
        assert.equal(moneyAfter[index]?.id, moneyBefore[index]?.id);
        assert.equal(moneyAfter[index]?.offered_pence, moneyBefore[index]?.offered_pence);
        assert.equal(moneyAfter[index]?.agreed_pence, moneyBefore[index]?.agreed_pence);
        assert.equal(moneyAfter[index]?.received_pence, moneyBefore[index]?.received_pence);
      }
      const model = buildClaimSummaryModel("c9");
      assert.equal(model?.nextAction, "Arrange hire");
      assert.match(model?.stageLine || "", /Hire · In progress/);
      assert.equal(model?.staffNote, "Chase vehicle damage payment from Hastings");
      const report = steps.find((item) => item.key === "engineer_report");
      assert.notEqual(report?.state, "done");
      assert.match(report?.detail || "", /Cannot tell from the history/);
    });
  });

  it("changes a repairable file to a total loss and keeps the repair history", () => {
    const db = prepared();
    withDatabase(db, () => {
      recordClaimEvent({
        claimId: "c4",
        eventType: "repairs_started",
        occurredAt: "2026-10-01T09:00:00.000Z",
        details: "Test repair start. Figures were not changed.",
        actorId: "staff-justin",
      });
      const before = listClaimEvents("c4").map((event) => event.id);
      db.prepare(`UPDATE claims SET total_loss = 1 WHERE id = 'c4'`).run();
      const steps = loadClaimSteps("c4");
      const after = listClaimEvents("c4").map((event) => event.id);
      assert.deepEqual(after, before);
      assert.equal(steps?.find((item) => item.key === "finish")?.title, "Payment received and salvage collected");
      assert.equal(
        steps?.find((item) => item.key === "finish")?.historyLines.some((line) => line.label === "Repairs started"),
        true,
      );
      assert.equal(steps?.find((item) => item.key === "agree")?.title, "Agree valuation with the client");
    });
  });

  it("refuses to mark a step not needed without a reason, including for a driver", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = listClaimEvents("c3").length;
      assert.throws(
        () =>
          recordStepNotNeeded({
            claimId: "c3",
            actorId: "staff-justin",
            role: "staff",
            step: "hire",
            reason: "   ",
            occurredOn: "2026-10-19",
          }),
        /Enter a reason/,
      );
      assert.throws(
        () =>
          recordStepNotNeeded({
            claimId: "c3",
            actorId: "staff-driver",
            role: "driver",
            step: "hire",
            reason: "client has own transport",
            occurredOn: "2026-10-19",
          }),
        /You cannot change this step/,
      );
      assert.equal(listClaimEvents("c3").length, before);
      recordStepNotNeeded({
        claimId: "c3",
        actorId: "staff-justin",
        role: "staff",
        step: "hire",
        reason: "client has own transport",
        occurredOn: "2026-10-19",
      });
      const saved = listClaimEvents("c3").filter((event) => event.event_type === "step_not_needed");
      assert.equal(saved.length, 1);
      assert.match(String(saved[0]?.details || ""), /Step hire marked not needed\. Reason: client has own transport/);
    });
  });

  it("keeps a staff next action and uses the step only when none is stored", () => {
    const steps = deriveClaimSteps(blank());
    const kept = resolveDisplayedNextAction({
      storedAction: "Ring the garage about the courtesy car",
      storedDue: "2026-10-20T09:00:00.000Z",
      steps,
    });
    assert.equal(kept.action, "Record recovery");
    assert.equal(kept.fromStaff, false);
    assert.equal(kept.note, "Ring the garage about the courtesy car");
    // Guidance the old new-claim form stored is not a staff note, so it is not shown as one.
    const guidance = resolveDisplayedNextAction({ storedAction: "Pre-hire checks and choose a vehicle", storedDue: null, steps });
    assert.equal(guidance.note, null);
    assert.equal(guidance.action, "Record recovery");
    const fallback = resolveDisplayedNextAction({ storedAction: "  ", storedDue: null, steps });
    assert.equal(fallback.fromStaff, false);
    assert.equal(fallback.note, null);
    assert.equal(fallback.action, kept.action);
  });

  it("sends old addresses to the new tabs", () => {
    assert.equal(workScreenTabPath("c5", "client"), "/claims/c5/details/client");
    assert.equal(workScreenTabPath("c5", "comms"), "/claims/c5/messages");
    assert.equal(workScreenTabPath("c5", "history"), "/claims/c5/history");
    assert.equal(workScreenTabPath("c5", "storage"), "/claims/c5/money/storage");
    assert.equal(headTabPath("c5", "hire"), "/claims/c5/money/hire");
    assert.equal(headTabPath("c8", "recovery"), "/claims/c8/money/recovery");
    assert.equal(claimTabFromPath("/claims/c5/work/client", "c5"), "details");
    assert.equal(claimTabFromPath("/claims/c5/heads/storage", "c5"), "money");
    assert.equal(claimTabFromPath("/claims/c8", "c8"), "steps");
    assert.match(read("src/app/claims/[id]/work/[screen]/page.tsx"), /redirect\(workScreenTabPath/);
    assert.match(read("src/app/claims/[id]/heads/recovery/page.tsx"), /\/money\/recovery/);
    assert.match(read("src/app/claims/[id]/heads/storage/page.tsx"), /\/money\/storage/);
    assert.match(read("src/app/claims/[id]/heads/hire/page.tsx"), /\/money\/hire/);
    assert.match(read("src/app/claims/[id]/vehicles/page.tsx"), /\/details\/vehicles/);
    assert.match(read("src/app/claims/[id]/hire/page.tsx"), /section === "handover"/);
    assert.match(read("src/app/claims/[id]/handover/page.tsx"), /return HandoverScreen/);
  });

  it("still blocks a driver and a mechanic from office and money on the server", () => {
    assert.equal(pathAllowedForRole("driver", "/claims/c5"), false);
    assert.equal(pathAllowedForRole("driver", "/claims/c5/money"), false);
    assert.equal(pathAllowedForRole("driver", "/claims/c5/heads/hire"), false);
    assert.equal(pathAllowedForRole("driver", "/claims/c5/handover"), true);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c5/repair"), true);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c5/repair/step"), true);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c5/money/vehicle"), false);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c5/documents"), false);
    assert.doesNotThrow(() => assertRepairStepRole("mechanic", "repairs_started"));
    assert.throws(() => assertRepairStepRole("mechanic", "engineer_inspection_booked"), /cannot record an inspection/);
    assert.throws(() => assertRepairStepRole("driver", "repairs_started"), /cannot record this step/);
  });

  it("prints a chronology without calling a generated or simulated item sent", () => {
    const lines = printChronology([
      {
        id: "generated",
        event_type: "outgoing_email",
        title: "Hire chase",
        details: "Recorded from generated draft",
        occurred_at: "2026-10-01T09:00:00.000Z",
      },
      {
        id: "simulated",
        event_type: "outgoing_whatsapp",
        title: "WhatsApp",
        details: "Not sent on WhatsApp",
        occurred_at: "2026-10-02T09:00:00.000Z",
      },
      {
        id: "lba",
        event_type: "letter_before_action",
        title: "Letter before action",
        details: "Do not print this",
        occurred_at: "2026-10-03T09:00:00.000Z",
      },
      {
        id: "letter",
        event_type: "initial_letter_tp_insurer",
        title: "Initial letter to the third-party insurer",
        details: "This is not a letter before action. Sent from claims@cascar.co.uk by Sian.",
        occurred_at: "2026-10-04T10:00:00.000Z",
      },
    ]);
    assert.equal(lines.some((line) => line.id === "lba"), false);
    const generated = lines.find((line) => line.id === "generated");
    const simulated = lines.find((line) => line.id === "simulated");
    const letter = lines.find((line) => line.id === "letter");
    assert.equal(generated?.dispatch, "generated");
    assert.match(generated?.text || "", /Generated, not sent/);
    assert.equal((generated?.text || "").endsWith("Sent"), false);
    assert.equal(simulated?.dispatch, "not_sent");
    assert.match(simulated?.text || "", /Not sent/);
    assert.equal(letter?.dispatch, "sent");
    assert.match(letter?.date || "", /^\d{2}\/\d{2}\/\d{4}$/);
    assert.equal(lines[0]?.date, "01/10/2026");
  });

  it("uses the confirmed fault steps and does not offer the third-party letter", () => {
    const steps = deriveClaimSteps(blank({ claimType: "fault", roadworthiness: "roadworthy", needsReplacement: false }));
    assert.deepEqual(
      steps.map((item) => item.key),
      ["details", "recovery", "hire", "own_insurer", "audatex_send", "audatex_auth", "repairs", "excess", "return_car", "fault_invoice"],
    );
    assert.equal(steps.some((item) => item.key === "initial_letter" || item.key === "agree"), false);
    assert.equal(steps.find((item) => item.key === "hire")?.title, "Courtesy car");
    assert.equal(steps.find((item) => item.key === "recovery")?.state, "not_needed");
    assert.equal(steps.find((item) => item.key === "hire")?.state, "not_decided");
    assert.equal(steps.find((item) => item.key === "audatex_send")?.title, "Send the Audatex estimate to the client's own insurer");
  });

  it("calls hire in progress only after something has begun, and waits on the insurer after a real send", () => {
    const hire = step(blank({ prehireDone: true, vehicleChosen: true }), "hire");
    assert.equal(hire.state, "in_progress");
    assert.equal(hire.statusText, "In progress");
    assert.equal(hire.progressDone, 2);
    assert.equal(hire.progressTotal, 4);
    const waiting = step(
      blank({
        events: [
          { event_type: "inspection_route_chosen", occurred_at: "2026-10-02T09:00:00.000Z", details: "Route: engineer. Staff chose an engineer." },
          { event_type: "engineer_instructed", occurred_at: "2026-10-02T10:00:00.000Z", details: "Instructed." },
          { event_type: "engineer_report_received", occurred_at: "2026-10-03T10:00:00.000Z", details: "Report in." },
          {
            event_type: "engineer_report_sent_to_insurer",
            occurred_at: "2026-10-04T10:00:00.000Z",
            details: "Sent from claims@cascar.co.uk by Sian.",
          },
        ],
      }),
      "repair_authorisation",
    );
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.statusText, "Waiting on the insurer");
  });

  it("finishes the report step only when every chosen item has been received", () => {
    const both = [
      { event_type: "inspection_route_chosen", occurred_at: "2026-10-02T09:00:00.000Z", details: "Route: both. Staff chose engineer and an Audatex estimate." },
      { event_type: "engineer_instructed", occurred_at: "2026-10-02T10:00:00.000Z", details: "Instructed." },
    ];
    const partial = step(blank({ events: both }), "engineer");
    assert.equal(partial.state, "in_progress");
    assert.equal(partial.progressDone, 1);
    assert.equal(partial.progressTotal, 2);
    const reportWaiting = step(
      blank({
        events: [
          ...both,
          { event_type: "audatex_estimate_sent", occurred_at: "2026-10-02T11:00:00.000Z", details: "Sent." },
          { event_type: "engineer_report_received", occurred_at: "2026-10-03T10:00:00.000Z", details: "Report in." },
        ],
      }),
      "engineer_report",
    );
    assert.notEqual(reportWaiting.state, "done");
    const done = step(
      blank({
        events: [
          ...both,
          { event_type: "audatex_estimate_sent", occurred_at: "2026-10-02T11:00:00.000Z", details: "Sent." },
          { event_type: "engineer_report_received", occurred_at: "2026-10-03T10:00:00.000Z", details: "Report in." },
          { event_type: "audatex_estimate_received", occurred_at: "2026-10-04T10:00:00.000Z", details: "Estimate in." },
        ],
      }),
      "engineer_report",
    );
    assert.equal(done.state, "done");
  });

  it("records Audatex by hand without changing claimed, agreed or received, and shows the difference", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = moneyLines(db, "c6");
      recordInspectionRoute({
        claimId: "c6",
        actorId: "staff-justin",
        role: "administrator",
        route: "audatex",
        occurredOn: "2026-10-02",
      });
      recordAudatexEstimate({
        claimId: "c6",
        actorId: "staff-justin",
        role: "administrator",
        kind: "authorised",
        occurredOn: "2026-10-04",
        reference: "AUD-DEMO-1",
        estimate: "2400",
        labour: "900",
        parts: "1100",
        paint: "400",
        authorised: "2100",
        hourly: "100",
        hourlyNote: "Rate reduced",
        times: "50",
        timesNote: "Time reduced",
        partsReduction: "150",
        partsNote: "Parts reduced",
        other: "",
        otherNote: "",
        documentId: null,
      });
      const after = moneyLines(db, "c6");
      assert.equal(after.length, before.length);
      for (let index = 0; index < before.length; index += 1) {
        assert.equal(after[index]?.id, before[index]?.id);
        assert.equal(after[index]?.claimed_pence, before[index]?.claimed_pence);
        assert.equal(after[index]?.agreed_pence, before[index]?.agreed_pence);
        assert.equal(after[index]?.received_pence, before[index]?.received_pence);
      }
      const steps = loadClaimSteps("c6");
      const auth = steps?.find((item) => item.key === "repair_authorisation");
      assert.equal(auth?.lines.find((line) => line.label === "Difference")?.date, "£300.00");
      assert.equal(auth?.lines.find((line) => line.label === "Hourly rate reduction")?.date, "£100.00 · Rate reduced");
    });
  });

  it("shows TEST-0004 as the demonstration fault claim and keeps history when the type changes", () => {
    const db = prepared();
    withDatabase(db, () => {
      const steps = loadClaimSteps("c4");
      assert.deepEqual(
        steps?.map((item) => item.title),
        [
          "Basic details",
          "Recovery",
          "Courtesy car",
          "Notify the client's own insurer",
          "Send the Audatex estimate to the client's own insurer",
          "Authorisation received via Audatex",
          "Repairs done",
          "Excess paid by the client",
          "Car returned to the client",
          "Invoice the client's own insurer",
        ],
      );
      assert.equal(steps?.find((item) => item.key === "recovery")?.state, "not_needed");
      assert.equal(steps?.find((item) => item.key === "hire")?.state, "done");
      assert.equal(steps?.some((item) => item.key === "initial_letter"), false);
      const before = listClaimEvents("c3").map((event) => event.id);
      db.prepare(`UPDATE claims SET claim_type = 'fault' WHERE id = 'c3'`).run();
      const after = listClaimEvents("c3").map((event) => event.id);
      assert.deepEqual(after, before);
      const switched = loadClaimSteps("c3");
      assert.equal(switched?.some((item) => item.key === "excess"), true);
      assert.equal(switched?.some((item) => item.key === "initial_letter"), false);
      assert.equal(listClaimEvents("c3").some((event) => event.event_type === "initial_letter_tp_insurer"), true);
    });
  });

  it("refuses a fault car return before the excess unless Justin records a reason, and invoices authorised minus excess", () => {
    const db = prepared();
    withDatabase(db, () => {
      const offersBefore = offerLines(db, "c9");
      const seven = moneyLines(db, "c7");
      const six = moneyLines(db, "c6");
      assert.throws(
        () => recordFaultCarReturn({ claimId: "c4", actorId: "staff-sian", role: "staff", occurredOn: "2026-10-20", reason: "Client is travelling" }),
        /excess has to be recorded as paid/,
      );
      assert.throws(
        () => recordFaultCarReturn({ claimId: "c4", actorId: "staff-justin", role: "administrator", occurredOn: "2026-10-20", reason: "  " }),
        /Enter a reason/,
      );
      assert.equal(listClaimEvents("c4").some((event) => event.event_type === "vehicle_returned"), false);
      recordFaultCarReturn({
        claimId: "c4",
        actorId: "staff-justin",
        role: "administrator",
        occurredOn: "2026-10-20",
        reason: "Client is travelling and will pay the excess on return to the office",
      });
      const returned = listClaimEvents("c4").find((event) => event.event_type === "vehicle_returned");
      assert.match(String(returned?.details || ""), /releaseWithoutExcess/);
      recordClientExcessPaid({
        claimId: "c4",
        actorId: "staff-justin",
        role: "administrator",
        occurredOn: "2026-10-21",
        amount: "350",
        method: "Card in the office",
      });
      recordAudatexEstimate({
        claimId: "c4",
        actorId: "staff-justin",
        role: "administrator",
        kind: "authorised",
        occurredOn: "2026-10-18",
        reference: "AUD-FAULT-1",
        estimate: "1000",
        labour: "",
        parts: "",
        paint: "",
        authorised: "1000",
        hourly: "",
        hourlyNote: "",
        times: "",
        timesNote: "",
        partsReduction: "",
        partsNote: "",
        other: "",
        otherNote: "",
      });
      recordFaultInvoice({ claimId: "c4", actorId: "staff-justin", role: "administrator", occurredOn: "2026-10-21", kind: "sent" });
      const invoice = listClaimEvents("c4").find((event) => event.event_type === "fault_invoice_sent");
      assert.match(String(invoice?.details || ""), /Amount pence: 65000/);
      assert.match(String(invoice?.details || ""), /Excess pence: 35000/);
      assert.throws(
        () => generateClaimDocument({ claimId: "c4", templateKey: "initial_tp_insurer", actorId: "staff-justin", recordOnFile: false }),
        /does not apply on a fault claim/,
      );
      const offersAfter = offerLines(db, "c9");
      assert.equal(offersAfter.length, offersBefore.length);
      for (let index = 0; index < offersBefore.length; index += 1) {
        assert.equal(offersAfter[index]?.id, offersBefore[index]?.id);
        assert.equal(offersAfter[index]?.amount_pence, offersBefore[index]?.amount_pence);
      }
      const sevenAfter = moneyLines(db, "c7");
      const sixAfter = moneyLines(db, "c6");
      for (let index = 0; index < seven.length; index += 1) {
        assert.equal(sevenAfter[index]?.received_pence, seven[index]?.received_pence);
        assert.equal(sevenAfter[index]?.agreed_pence, seven[index]?.agreed_pence);
        assert.equal(sevenAfter[index]?.claimed_pence, seven[index]?.claimed_pence);
      }
      for (let index = 0; index < six.length; index += 1) {
        assert.equal(sixAfter[index]?.received_pence, six[index]?.received_pence);
        assert.equal(sixAfter[index]?.agreed_pence, six[index]?.agreed_pence);
      }
      const storageEnd = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as { storage_billing_end_on: string | null };
      assert.equal(storageEnd.storage_billing_end_on, null);
    });
  });

  it("does not write a step event when the steps are only read", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = listClaimEvents("c8").length;
      loadClaimSteps("c8");
      buildClaimSummaryModel("c8");
      assert.equal(listClaimEvents("c8").length, before);
    });
  });
});

function moneyLines(db: DatabaseSync, claimId: string) {
  return db
    .prepare(`SELECT id, claimed_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = ? ORDER BY id`)
    .all(claimId) as Array<{ id: string; claimed_pence: number | null; agreed_pence: number | null; received_pence: number | null }>;
}

function offerLines(db: DatabaseSync, claimId: string) {
  return db
    .prepare(`SELECT id, amount_pence, status FROM insurer_offers WHERE claim_id = ? ORDER BY id`)
    .all(claimId) as Array<{ id: string; amount_pence: number; status: string }>;
}

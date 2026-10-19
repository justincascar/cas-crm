import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { pathAllowedForRole } from "../src/lib/auth/roles.ts";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { buildClaimSummaryModel } from "../src/lib/claims/claim-summary.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { listClaimEvents, recordClaimEvent } from "../src/lib/db/chronology.ts";
import { recordStepNotNeeded } from "../src/lib/db/claim-step-record.ts";
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
    assert.equal(hire.state, "not_needed");
    assert.match(hire.statusText, /does not need a replacement vehicle/);
    assert.equal(letter.state, "in_progress");
    assert.equal(letter.statusText, "In progress");
    assert.equal(engineer.state, "in_progress");
    assert.equal(engineer.statusText, "In progress");
    assert.equal(details.statusText.includes("Sent"), false);
    assert.equal(letter.statusText.includes("Sent"), false);
  });

  it("keeps steps 2 to 5 in progress together on day one", () => {
    const steps = deriveClaimSteps(blank());
    for (const key of ["recovery", "hire", "initial_letter", "engineer"]) {
      assert.equal(steps.find((item) => item.key === key)?.state, "in_progress", key);
    }
    assert.equal(steps.find((item) => item.key === "engineer_report")?.state, "not_started");
  });

  it("derives TEST-0008 step 9 from the stored history and does not invent a return", () => {
    const db = prepared();
    withDatabase(db, () => {
      const events = listClaimEvents("c8");
      assert.equal(events.some((event) => event.event_type === "repairs_complete"), true);
      assert.equal(events.some((event) => event.event_type === "vehicle_returned"), false);
      assert.equal(events.some((event) => event.event_type === "recovery_completed"), false);
      const steps = loadClaimSteps("c8");
      if (!steps) throw new Error("missing c8");
      const finish = steps.find((item) => item.key === "finish");
      assert.equal(finish?.state, "waiting");
      assert.equal(finish?.statusText, "Waiting on the car being returned");
      assert.equal(finish?.lines.some((line) => line.label === "Car returned to client"), false);
      assert.equal(finish?.lines.some((line) => line.label === "Repairs complete"), true);
      const recovery = steps.find((item) => item.key === "recovery");
      assert.equal(recovery?.state, "not_started");
      assert.match(recovery?.detail || "", /Cannot tell from the history/);
      const model = buildClaimSummaryModel("c8");
      assert.equal(model?.nextAction, "Arrange customer collection of repaired vehicle");
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
      assert.equal(model?.nextAction, "Chase vehicle damage payment from Hastings");
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
      storedAction: "Pre-hire checks and choose a vehicle",
      storedDue: "2026-10-20T09:00:00.000Z",
      steps,
    });
    assert.equal(kept.action, "Pre-hire checks and choose a vehicle");
    assert.equal(kept.fromStaff, true);
    const fallback = resolveDisplayedNextAction({ storedAction: "  ", storedDue: null, steps });
    assert.equal(fallback.fromStaff, false);
    assert.equal(fallback.action.length > 0, true);
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
    assert.match(read("src/app/claims/[id]/handover/page.tsx"), /section=handover|section", "handover"/);
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

  it("marks a fault claim's third-party report as not needed, and says that is still a proposal", () => {
    const send = step(blank({ claimType: "fault", totalLoss: false }), "send_report");
    assert.equal(send.state, "not_needed");
    assert.match(send.statusText, /proposed/);
    assert.match(send.statusText, /waiting for confirmation/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT, ENGINEER_REPORT_CHASE_DUE_LABEL } from "../src/lib/constants.ts";
import { addCalendarDaysIso, isoDaysFromNow } from "../src/lib/dates.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  listClaimEvents,
  logEngineerReportReceived,
  clearEngineerReportReceived,
  markEngineerReportChaseSent,
  prepareEngineerReportChase,
} from "../src/lib/db/chronology.ts";
import {
  cancelEngineerInstructionChase,
  countEngineerInstructionChaseRows,
  engineerChaseForClaim,
  ensureDemoEngineerInstructionChase,
  ensureEngineerChaseIntervalSetting,
  getEngineerChaseIntervalDays,
  listDueEngineerInstructionChases,
  pauseEngineerInstructionChase,
  resumeEngineerInstructionChase,
  setEngineerChaseIntervalDays,
  startEngineerInstructionChase,
} from "../src/lib/db/engineer-chase.ts";
import { SEEDED_ENGINEER, ensureEngineers, setClaimEngineer } from "../src/lib/db/engineers.ts";
import { listClaims } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  engineerInstructionChaseDecision,
  parseChaseIntervalDays,
} from "../src/lib/domain/engineer-chase.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
  ensureEngineerChaseIntervalSetting(db);
  ensureDemoEngineerInstructionChase(db);
  return db;
}

const instructed = "2026-09-18T09:00:00.000Z";

describe("engineer instruction chase — interval threshold", () => {
  it("is not due just under the interval and is due at or just over it", () => {
    const under = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: null,
      latestReportClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-20T09:00:00.000Z",
    });
    assert.equal(under.due, false);
    assert.equal(under.daysOutstanding, 2);

    const onTheDay = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: null,
      latestReportClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-21T09:00:00.000Z",
    });
    assert.equal(onTheDay.due, true);
    assert.equal(onTheDay.daysOutstanding, 3);
    assert.equal(onTheDay.label, ENGINEER_REPORT_CHASE_DUE_LABEL);

    const over = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: null,
      latestReportClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(over.due, true);
    assert.equal(over.daysOutstanding, 4);
  });
});

describe("engineer instruction chase — pause, resume, cancel", () => {
  it("hides a due chase while paused, shows it again on resume, and stays off when cancelled", () => {
    const dueInput = {
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: null,
      latestReportClearedAt: null,
      intervalDays: 3,
      asAt: "2026-09-22T09:00:00.000Z",
    };
    assert.equal(engineerInstructionChaseDecision({ ...dueInput, handlerState: "tracking" }).due, true);
    const paused = engineerInstructionChaseDecision({ ...dueInput, handlerState: "paused" });
    assert.equal(paused.due, false);
    assert.match(paused.reason, /paused/i);
    assert.equal(engineerInstructionChaseDecision({ ...dueInput, handlerState: "tracking" }).due, true);
    const cancelled = engineerInstructionChaseDecision({ ...dueInput, handlerState: "cancelled" });
    assert.equal(cancelled.due, false);
    assert.match(cancelled.reason, /cancelled/i);
  });

  it("pause, resume and cancel are remembered on the file and visible in history", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = engineerChaseForClaim("c5");
      assert.equal(before?.due, true);
      pauseEngineerInstructionChase("c5");
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.handlerState, "paused");
      resumeEngineerInstructionChase("c5");
      assert.equal(engineerChaseForClaim("c5")?.due, true);
      assert.equal(engineerChaseForClaim("c5")?.handlerState, "tracking");
      cancelEngineerInstructionChase("c5");
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.handlerState, "cancelled");
      setEngineerChaseIntervalDays(1);
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.handlerState, "cancelled");
    });
    db.close();
  });
});

describe("engineer instruction chase — report received and corrections", () => {
  it("clears the due flag when a report is logged and can resume if that receipt is un-logged", () => {
    const withReport = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: "2026-09-20T12:00:00.000Z",
      latestReportClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(withReport.due, false);
    assert.equal(withReport.reportOnFile, true);

    const unlogged = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: "2026-09-20T12:00:00.000Z",
      latestReportClearedAt: "2026-09-21T09:00:00.000Z",
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(unlogged.due, true);
    assert.equal(unlogged.reportOnFile, false);

    const db = seeded();
    withDatabase(db, () => {
      assert.equal(engineerChaseForClaim("c5")?.due, true);
      logEngineerReportReceived({ claimId: "c5", actorId: "staff-sian" });
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.reportOnFile, true);
      const listed = listDueEngineerInstructionChases();
      assert.equal(listed.some((row) => row.claimId === "c5"), false);
      clearEngineerReportReceived({ claimId: "c5", actorId: "staff-tom" });
      assert.equal(engineerChaseForClaim("c5")?.due, true);
      const events = listClaimEvents("c5");
      assert.ok(events.some((event) => event.event_type === "engineer_report_received" && event.actor_name === "Sian Evans"));
      assert.ok(
        events.some((event) => event.event_type === "engineer_report_received_cleared" && event.actor_name === "Tom Hughes"),
      );
    });
    db.close();
  });
});

describe("engineer instruction chase — one reminder per instruction", () => {
  it("does not stack duplicate chase rows or duplicate due list entries", () => {
    const db = seeded();
    withDatabase(db, () => {
      const first = countEngineerInstructionChaseRows("c5");
      assert.equal(first, 1);
      startEngineerInstructionChase("c5", isoDaysFromNow(-7));
      startEngineerInstructionChase("c5", isoDaysFromNow(-7));
      assert.equal(countEngineerInstructionChaseRows("c5"), 1);
      const due = listDueEngineerInstructionChases().filter((row) => row.claimId === "c5");
      assert.equal(due.length, 1);
    });
    db.close();
  });
});

describe("engineer instruction chase — seeded TEST-0005 and settings", () => {
  it("shows TEST-0005 as chase due on the dashboard next-action list and not TEST-0006", () => {
    const db = seeded();
    withDatabase(db, () => {
      const chase = engineerChaseForClaim("c5");
      assert.equal(chase?.due, true);
      assert.equal(chase?.label, ENGINEER_REPORT_CHASE_DUE_LABEL);
      const claims = listClaims();
      const five = claims.find((row) => row.file_reference === "TEST-0005");
      const six = claims.find((row) => row.file_reference === "TEST-0006");
      assert.equal(five?.next_action, ENGINEER_REPORT_CHASE_DUE_LABEL);
      assert.notEqual(six?.next_action, ENGINEER_REPORT_CHASE_DUE_LABEL);
      assert.ok(listDueEngineerInstructionChases().some((row) => row.fileReference === "TEST-0005"));
      assert.equal(getEngineerChaseIntervalDays(), ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT);
    });
    db.close();
  });

  it("does not let a later interval change reopen a paused or resolved chase", () => {
    const db = seeded();
    withDatabase(db, () => {
      pauseEngineerInstructionChase("c5");
      setEngineerChaseIntervalDays(1);
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.handlerState, "paused");
      resumeEngineerInstructionChase("c5");
      assert.equal(engineerChaseForClaim("c5")?.due, true);

      logEngineerReportReceived({ claimId: "c5", actorId: "staff-sian" });
      setEngineerChaseIntervalDays(1);
      assert.equal(engineerChaseForClaim("c5")?.due, false);
      assert.equal(engineerChaseForClaim("c5")?.reportOnFile, true);
    });
    db.close();
  });

  it("does not cancel or restart the chase when liability status changes", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET claim_type = 'fault', cas_liability_assessment = 'fault' WHERE id = 'c5'`).run();
      const chase = engineerChaseForClaim("c5");
      assert.equal(chase?.due, true);
      assert.equal(chase?.handlerState, "tracking");
    });
    db.close();
  });

  it("prepares a chase email without sending it, and marking it sent restarts the interval", () => {
    const db = seeded();
    withDatabase(db, () => {
      setClaimEngineer("c5", SEEDED_ENGINEER.id);
      const prepared = prepareEngineerReportChase({ claimId: "c5", actorId: "staff-sian" });
      assert.match(prepared.to, /andy\.mont@hotmail\.co\.uk/i);
      assert.match(prepared.mailto, /^mailto:/);
      assert.match(prepared.body, /TEST-0005/);
      const again = prepareEngineerReportChase({ claimId: "c5", actorId: "staff-sian" });
      assert.equal(again.correspondenceId, prepared.correspondenceId);
      markEngineerReportChaseSent({
        claimId: "c5",
        correspondenceId: prepared.correspondenceId,
        actorId: "staff-sian",
        occurredAt: addCalendarDaysIso(isoDaysFromNow(0), 0),
      });
      const after = engineerChaseForClaim("c5");
      assert.equal(after?.due, false);
      assert.match(String(after?.reason || ""), /not yet reached/i);
    });
    db.close();
  });
});

describe("engineer instruction chase — setting parse", () => {
  it("rejects empty or zero interval values and keeps a whole number of days", () => {
    assert.equal(parseChaseIntervalDays("3"), 3);
    assert.equal(parseChaseIntervalDays("0", 3), 3);
    assert.equal(parseChaseIntervalDays("", 3), 3);
  });
});

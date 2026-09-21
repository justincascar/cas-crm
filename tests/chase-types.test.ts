import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  ENGINEER_REPORT_CHASE_DUE_LABEL,
  LIABILITY_RESPONSE_CHASE_DUE_LABEL,
  REPAIR_AUTHORISATION_CHASE_DUE_LABEL,
} from "../src/lib/constants.ts";
import { isoDaysFromNow } from "../src/lib/dates.ts";
import {
  chaseForClaim,
  clearChaseIntervalOverride,
  countChaseRows,
  ensureChaseSettings,
  ensureDemoChases,
  listChasesForClaim,
  listDueChases,
  pauseChase,
  setChaseIntervalDays,
  setChaseIntervalOverride,
  startChase,
} from "../src/lib/db/chase.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  logChaseOutcome,
  prepareOutstandingChase,
  recordClaimEvent,
} from "../src/lib/db/chronology.ts";
import { ensureEngineers } from "../src/lib/db/engineers.ts";
import { listClaims } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  chaseClockDecision,
  effectiveChaseIntervalDays,
  NO_INSURER_CONTACT_MESSAGE,
} from "../src/lib/domain/chase.ts";
import { engineerInstructionChaseDecision } from "../src/lib/domain/engineer-chase.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
  ensureChaseSettings(db);
  ensureDemoChases(db);
  return db;
}

describe("shared chase clock — still matches engineer-report behaviour", () => {
  it("is due at the interval and not due just under it", () => {
    const instructed = "2026-09-18T09:00:00.000Z";
    const shared = chaseClockDecision({
      startedAt: instructed,
      lastChaseSentAt: null,
      outcomeAt: null,
      outcomeClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-21T09:00:00.000Z",
      dueLabel: ENGINEER_REPORT_CHASE_DUE_LABEL,
      notStartedReason: "Engineer has not been instructed (marked as sent).",
      outcomeOnFileReason: "Engineer report has been logged as received.",
    });
    const wrapped = engineerInstructionChaseDecision({
      instructionMarkedSentAt: instructed,
      lastChaserMarkedSentAt: null,
      latestReportReceivedAt: null,
      latestReportClearedAt: null,
      handlerState: "tracking",
      intervalDays: 3,
      asAt: "2026-09-21T09:00:00.000Z",
    });
    assert.equal(shared.due, true);
    assert.equal(wrapped.due, true);
    assert.equal(shared.label, wrapped.label);
    assert.equal(wrapped.reportOnFile, shared.outcomeOnFile);
  });

  it("uses a per-claim override in preference to settings, including after a global change", () => {
    const tracking = effectiveChaseIntervalDays({
      overrideDays: 14,
      globalDays: 3,
      handlerState: "tracking",
      frozenDays: 3,
    });
    assert.equal(tracking.days, 14);
    assert.equal(tracking.source, "claim_override");
    const afterGlobalChange = effectiveChaseIntervalDays({
      overrideDays: 14,
      globalDays: 1,
      handlerState: "tracking",
      frozenDays: 3,
    });
    assert.equal(afterGlobalChange.days, 14);
    assert.equal(afterGlobalChange.source, "claim_override");
  });
});

describe("liability response chase", () => {
  it("shows TEST-0005 as liability-response chase due, independently of the engineer chase", () => {
    const db = seeded();
    withDatabase(db, () => {
      const liability = chaseForClaim("liability_response", "c5");
      const engineer = chaseForClaim("engineer_report", "c5");
      assert.equal(liability?.due, true);
      assert.equal(liability?.label, LIABILITY_RESPONSE_CHASE_DUE_LABEL);
      assert.equal(engineer?.due, true);
      assert.equal(engineer?.label, ENGINEER_REPORT_CHASE_DUE_LABEL);
      const due = listDueChases().filter((row) => row.claimId === "c5");
      assert.equal(due.length, 2);
      assert.ok(due.some((row) => row.kind === "liability_response"));
      assert.ok(due.some((row) => row.kind === "engineer_report"));
      const five = listClaims().find((row) => row.file_reference === "TEST-0005");
      assert.match(String(five?.next_action), /Liability response chase due/);
      assert.match(String(five?.next_action), /Engineer report chase due/);
    });
    db.close();
  });

  it("does not treat Disputed / unclear or not yet decided as a liability decision", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET claim_type = 'disputed', cas_liability_assessment = 'disputed' WHERE id = 'c5'`).run();
      assert.equal(chaseForClaim("liability_response", "c5")?.due, true);
      assert.throws(
        () => logChaseOutcome({ claimId: "c5", actorId: "staff-sian", kind: "liability_response", liabilityDecision: "pending" }),
        /not yet decided/i,
      );
      assert.equal(chaseForClaim("liability_response", "c5")?.due, true);
      logChaseOutcome({
        claimId: "c5",
        actorId: "staff-sian",
        kind: "liability_response",
        liabilityDecision: "admitted",
        occurredAt: isoDaysFromNow(0),
      });
      assert.equal(chaseForClaim("liability_response", "c5")?.due, false);
      assert.equal(chaseForClaim("liability_response", "c5")?.outcomeOnFile, true);
      assert.equal(chaseForClaim("engineer_report", "c5")?.due, true);
    });
    db.close();
  });

  it("refuses to prepare an insurer chase when no insurer email is on the file", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.throws(
        () => prepareOutstandingChase({ claimId: "c5", actorId: "staff-sian", kind: "liability_response" }),
        (error: unknown) => {
          assert.equal(error instanceof Error && error.message, NO_INSURER_CONTACT_MESSAGE);
          return true;
        },
      );
      db.prepare(`UPDATE claim_third_parties SET insurer_email = ? WHERE id = 'tp-c5'`).run("aviva.handler@example.test");
      const prepared = prepareOutstandingChase({ claimId: "c5", actorId: "staff-sian", kind: "liability_response" });
      assert.match(prepared.to, /aviva\.handler@example\.test/i);
      assert.match(prepared.mailto, /^mailto:/);
      assert.match(prepared.body, /TEST-0005/);
      const row = db
        .prepare(`SELECT sent_status FROM correspondence WHERE id = ?`)
        .get(prepared.correspondenceId) as { sent_status: string };
      assert.equal(row.sent_status, "prepared_not_sent");
    });
    db.close();
  });
});

describe("repair authorisation chase", () => {
  it("shows TEST-0006 as repair-authorisation chase due, independently of other chases", () => {
    const db = seeded();
    withDatabase(db, () => {
      const repair = chaseForClaim("repair_authorisation", "c6");
      assert.equal(repair?.due, true);
      assert.equal(repair?.label, REPAIR_AUTHORISATION_CHASE_DUE_LABEL);
      assert.equal(chaseForClaim("engineer_report", "c6"), null);
      assert.equal(chaseForClaim("liability_response", "c6"), null);
      const six = listClaims().find((row) => row.file_reference === "TEST-0006");
      assert.match(String(six?.next_action), /Repair authorisation chase due/);
      assert.ok(!String(six?.next_action).includes(ENGINEER_REPORT_CHASE_DUE_LABEL));
      assert.ok(!String(six?.next_action).includes(LIABILITY_RESPONSE_CHASE_DUE_LABEL));
      logChaseOutcome({
        claimId: "c6",
        actorId: "staff-tom",
        kind: "repair_authorisation",
        repairOutcome: "authorisation",
        occurredAt: isoDaysFromNow(0),
      });
      assert.equal(chaseForClaim("repair_authorisation", "c6")?.due, false);
      assert.equal(chaseForClaim("repair_authorisation", "c6")?.outcomeOnFile, true);
    });
    db.close();
  });
});

describe("per-claim interval override and multiple chases", () => {
  it("keeps a longer per-file interval after the global default is changed", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(chaseForClaim("liability_response", "c5")?.due, true);
      setChaseIntervalOverride("liability_response", "c5", 14, "Agreed with insurer");
      const overridden = chaseForClaim("liability_response", "c5");
      assert.equal(overridden?.due, false);
      assert.equal(overridden?.intervalDays, 14);
      assert.equal(overridden?.intervalSource, "claim_override");
      assert.match(String(overridden?.overrideReason), /agreed with insurer/i);
      setChaseIntervalDays("liability_response", 1);
      const afterGlobal = chaseForClaim("liability_response", "c5");
      assert.equal(afterGlobal?.due, false);
      assert.equal(afterGlobal?.intervalDays, 14);
      assert.equal(afterGlobal?.globalIntervalDays, 1);
      assert.equal(chaseForClaim("engineer_report", "c5")?.due, true);
      clearChaseIntervalOverride("liability_response", "c5");
      assert.equal(chaseForClaim("liability_response", "c5")?.intervalSource, "settings");
      assert.equal(chaseForClaim("liability_response", "c5")?.due, true);
    });
    db.close();
  });

  it("tracks two chase types on the same file separately, including pause", () => {
    const db = seeded();
    withDatabase(db, () => {
      const onFile = listChasesForClaim("c5");
      assert.equal(onFile.length, 2);
      assert.equal(countChaseRows("engineer_report", "c5"), 1);
      assert.equal(countChaseRows("liability_response", "c5"), 1);
      startChase("liability_response", "c5", isoDaysFromNow(-5));
      startChase("liability_response", "c5", isoDaysFromNow(-5));
      assert.equal(countChaseRows("liability_response", "c5"), 1);
      pauseChase("engineer_report", "c5");
      assert.equal(chaseForClaim("engineer_report", "c5")?.due, false);
      assert.equal(chaseForClaim("engineer_report", "c5")?.handlerState, "paused");
      assert.equal(chaseForClaim("liability_response", "c5")?.due, true);
      assert.equal(chaseForClaim("liability_response", "c5")?.handlerState, "tracking");
    });
    db.close();
  });

  it("does not start a chase from a status field — only from a recorded request", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET repair_status = 'awaiting_auth' WHERE id = 'c5'`).run();
      assert.equal(chaseForClaim("repair_authorisation", "c5"), null);
      recordClaimEvent({
        claimId: "c5",
        eventType: "repair_authorisation_requested",
        occurredAt: isoDaysFromNow(-4),
        details: "Request sent.",
        actorId: "staff-sian",
        channel: "file",
        source: "staff",
      });
      assert.equal(chaseForClaim("repair_authorisation", "c5")?.due, true);
      assert.equal(listChasesForClaim("c5").length, 3);
    });
    db.close();
  });
});

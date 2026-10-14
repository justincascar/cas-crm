import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";
import { formatUkDate } from "../src/lib/dates.ts";
import { withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { listClaimEvents, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  explainRepairProgressGap,
  gapsForClaim,
  listRepairGapClaims,
  recordRepairProgressStep,
  recordRepairStepCorrection,
} from "../src/lib/db/repair-progress.ts";
import { storageAuthorisationEndForClaim } from "../src/lib/db/storage-authorisation-end.ts";
import { justificationChronology, justificationRepairGaps } from "../src/lib/domain/justification-chronology.ts";
import {
  SIMULATED_REPORT_NOT_RECORDED,
  explainedGapWording,
  gapIsFlagged,
  inclusiveLondonDays,
  repairProgressGaps,
  unexplainedGapWording,
} from "../src/lib/domain/repair-progress.ts";
import {
  M365_CLIENT_ID_ENV,
  M365_CLIENT_SECRET_ENV,
  M365_TENANT_ID_ENV,
  setMailboxFetchForTests,
} from "../src/lib/email/microsoft-graph.ts";
import { EMAIL_SEND_MODE_ENV } from "../src/lib/email/send-mode.ts";

const ENV_KEYS = [M365_TENANT_ID_ENV, M365_CLIENT_ID_ENV, M365_CLIENT_SECRET_ENV, EMAIL_SEND_MODE_ENV] as const;

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function rememberEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setMailboxFetchForTests(null);
}

function useTestCredentials() {
  process.env[M365_TENANT_ID_ENV] = "11111111-1111-1111-1111-111111111111";
  process.env[M365_CLIENT_ID_ENV] = "22222222-2222-2222-2222-222222222222";
  process.env[M365_CLIENT_SECRET_ENV] = "secret-test-value";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function money(db: DatabaseSync, id: string) {
  return db.prepare(
    `SELECT claimed_pence, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE id = ?`,
  ).get(id) as { claimed_pence: number; offered_pence: number; agreed_pence: number; received_pence: number };
}

describe("repair progress", () => {
  it("counts both the first and last day and flags an inclusive gap of 15, not 14", () => {
    assert.equal(inclusiveLondonDays("2026-09-22T09:00:00.000Z", "2026-10-01T09:00:00.000Z"), 10);
    assert.equal(gapIsFlagged(14), false);
    assert.equal(gapIsFlagged(15), true);
    assert.equal(gapIsFlagged(16), true);
  });

  it("records each new step on the chronology, blocks a duplicate, and keeps a correction as a new entry", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaimEvents("c1");
        const steps = [
          ["engineer_inspection_booked", "2026-09-01"],
          ["engineer_inspection_attended", "2026-09-02"],
          ["engineer_report_sent_to_insurer", "2026-09-04"],
          ["vehicle_received_for_repair", "2026-09-06"],
          ["parts_ordered", "2026-09-05"],
          ["parts_delayed", "2026-09-08"],
          ["repairs_started", "2026-09-09"],
          ["repairs_complete", "2026-09-12"],
        ] as const;
        for (const [step, day] of steps) {
          recordRepairProgressStep({
            claimId: "c1",
            actorId: "staff-sian",
            role: "staff",
            step,
            occurredOn: day,
            note: `Demonstration note for ${step}.`,
            recipient: step === "engineer_report_sent_to_insurer" ? "Zurich" : undefined,
            expectedOn: step === "parts_ordered" ? "2026-09-07" : step === "parts_delayed" ? "2026-09-11" : undefined,
          });
        }
        recordRepairProgressStep({
          claimId: "c1",
          actorId: "staff-sian",
          role: "staff",
          step: "parts_delayed",
          occurredOn: "2026-09-10",
          note: "A second delay.",
          expectedOn: "2026-09-14",
        });
        const before = db.prepare(
          `SELECT id, event_type, title, details, occurred_at FROM claim_events WHERE claim_id = 'c1' AND event_type = 'engineer_inspection_booked'`,
        ).get() as { id: string; event_type: string; title: string; details: string; occurred_at: string };
        assert.equal(before.event_type, "engineer_inspection_booked");
        assert.equal(before.title, "Engineer inspection booked");
        assert.match(before.details, /Recorded by /);
        assert.throws(
          () =>
            recordRepairProgressStep({
              claimId: "c1",
              actorId: "staff-sian",
              role: "staff",
              step: "engineer_inspection_booked",
              occurredOn: "2026-09-03",
              note: "Second booking.",
            }),
          /already recorded/,
        );
        const after = db.prepare(`SELECT id, details FROM claim_events WHERE id = ?`).get(before.id) as {
          id: string;
          details: string;
        };
        assert.equal(after.id, before.id);
        assert.equal(after.details, before.details);
        const originalCount = db.prepare(
          `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c1' AND event_type = 'engineer_inspection_booked'`,
        ).get() as { n: number };
        assert.equal(Number(originalCount.n), 1);
        recordRepairStepCorrection({
          claimId: "c1",
          actorId: "staff-sian",
          role: "staff",
          step: "engineer_inspection_booked",
          occurredOn: "2026-09-03",
          reason: "The booking was the day after.",
        });
        const correction = db.prepare(
          `SELECT event_type, title, details FROM claim_events WHERE claim_id = 'c1' AND event_type = 'repair_step_correction'`,
        ).get() as { event_type: string; title: string; details: string };
        assert.equal(correction.event_type, "repair_step_correction");
        assert.equal(correction.title, "Correction of a repair step");
        assert.match(correction.details, /Correction of Engineer inspection booked/);
        assert.match(correction.details, /original entry is unchanged/);
        const still = db.prepare(`SELECT details FROM claim_events WHERE id = ?`).get(before.id) as { details: string };
        assert.equal(still.details, before.details);
        const lines = justificationChronology(listClaimEvents("c1"));
        for (const step of [
          "engineer_inspection_booked",
          "engineer_inspection_attended",
          "engineer_report_sent_to_insurer",
          "vehicle_received_for_repair",
          "parts_ordered",
          "parts_delayed",
          "repairs_started",
          "repairs_complete",
          "repair_step_correction",
        ]) {
          assert.equal(lines.some((line) => line.eventType === step), true, step);
        }
        const dates = lines.map((line) => line.occurredAt);
        assert.deepEqual(dates, [...dates].sort());
        const parts = lines.findIndex((line) => line.eventType === "parts_ordered");
        const received = lines.findIndex((line) => line.eventType === "vehicle_received_for_repair");
        assert.ok(parts < received);
        const delays = lines.filter((line) => line.eventType === "parts_delayed");
        assert.equal(delays.length, 2);
      });
    } finally {
      db.close();
    }
  });

  it("lets a bodyshop mechanic record workshop steps and refuses inspection steps on the server", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaimEvents("c2");
        recordRepairProgressStep({
          claimId: "c2",
          actorId: "staff-mechanic",
          role: "mechanic",
          step: "vehicle_received_for_repair",
          occurredOn: "2026-09-01",
          note: "On the ramp.",
        });
        recordRepairProgressStep({
          claimId: "c2",
          actorId: "staff-mechanic",
          role: "mechanic",
          step: "parts_ordered",
          occurredOn: "2026-09-02",
          note: "Bumper.",
        });
        recordRepairProgressStep({
          claimId: "c2",
          actorId: "staff-mechanic",
          role: "mechanic",
          step: "parts_delayed",
          occurredOn: "2026-09-03",
          note: "Supplier.",
          expectedOn: "2026-09-06",
        });
        recordRepairProgressStep({
          claimId: "c2",
          actorId: "staff-mechanic",
          role: "mechanic",
          step: "repairs_started",
          occurredOn: "2026-09-04",
          note: "Started.",
        });
        for (const step of ["engineer_inspection_booked", "engineer_inspection_attended", "engineer_report_sent_to_insurer"]) {
          assert.throws(
            () =>
              recordRepairProgressStep({
                claimId: "c2",
                actorId: "staff-mechanic",
                role: "mechanic",
                step,
                occurredOn: "2026-09-01",
                note: "Should be refused.",
                recipient: "Zurich",
              }),
            /cannot record an inspection or an insurer step/,
          );
        }
        const refused = db.prepare(
          `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c2' AND event_type = 'engineer_inspection_booked'`,
        ).get() as { n: number };
        assert.equal(Number(refused.n), 0);
      });
    } finally {
      db.close();
    }
  });

  it("flags an inclusive gap of 15 days, clears it when explained, and flags a later gap again", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaimEvents("c3");
        recordRepairProgressStep({
          claimId: "c3",
          actorId: "staff-tom",
          role: "staff",
          step: "engineer_inspection_booked",
          occurredOn: "2026-09-01",
          note: "Booked.",
        });
        recordRepairProgressStep({
          claimId: "c3",
          actorId: "staff-tom",
          role: "staff",
          step: "engineer_inspection_attended",
          occurredOn: "2026-09-15",
          note: "Attended.",
        });
        const flagged = gapsForClaim("c3", false).filter((gap) => !gap.explained);
        assert.equal(flagged.length, 1);
        assert.equal(flagged[0]?.inclusiveDays, 15);
        assert.equal(
          unexplainedGapWording(flagged[0]!),
          "Unexplained gap of 15 days between Engineer inspection booked and Engineer inspection attended",
        );
        const quiet = repairProgressGaps(listClaimEvents("c3"), {
          thresholdDays: 15,
          explanations: [],
        }).filter((gap) => gap.inclusiveDays === 14);
        assert.equal(quiet.length, 0);
        recordRepairProgressStep({
          claimId: "c4",
          actorId: "staff-sian",
          role: "staff",
          step: "engineer_inspection_booked",
          occurredOn: "2026-09-01",
          note: "Booked.",
        });
        recordRepairProgressStep({
          claimId: "c4",
          actorId: "staff-sian",
          role: "staff",
          step: "engineer_inspection_attended",
          occurredOn: "2026-09-14",
          note: "Attended.",
        });
        assert.equal(gapsForClaim("c4", false).length, 0);
        explainRepairProgressGap({
          claimId: "c3",
          actorId: "staff-tom",
          role: "staff",
          fromEventId: flagged[0]!.fromEventId,
          toEventId: flagged[0]!.toEventId,
          note: "awaiting the engineer",
        });
        const cleared = gapsForClaim("c3", false);
        assert.equal(cleared.filter((gap) => !gap.explained).length, 0);
        assert.match(explainedGapWording(cleared[0]!), /awaiting the engineer/);
        recordRepairProgressStep({
          claimId: "c3",
          actorId: "staff-tom",
          role: "staff",
          step: "engineer_report_sent_to_insurer",
          occurredOn: "2026-10-06",
          note: "Posted on.",
          recipient: "Admiral",
        });
        const again = gapsForClaim("c3", false).filter((gap) => !gap.explained);
        assert.equal(again.length, 1);
        assert.ok(again[0]!.inclusiveDays > 15);
        assert.notEqual(again[0]!.fromEventId, flagged[0]!.fromEventId);
      });
    } finally {
      db.close();
    }
  });

  it("shows no workshop blanks on a total loss and keeps steps already recorded", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaimEvents("c9");
        const before = justificationChronology(listClaimEvents("c9"), { totalLoss: true });
        assert.equal(before.some((line) => line.eventType === "vehicle_received_for_repair"), false);
        assert.deepEqual(justificationRepairGaps(listClaimEvents("c9"), { totalLoss: true }), []);
        recordRepairProgressStep({
          claimId: "c9",
          actorId: "staff-megan",
          role: "staff",
          step: "vehicle_received_for_repair",
          occurredOn: "2026-09-02",
          note: "Received before the file was treated as a total loss.",
        });
        const after = justificationChronology(listClaimEvents("c9"), { totalLoss: true });
        assert.equal(after.some((line) => line.eventType === "vehicle_received_for_repair"), true);
        assert.deepEqual(justificationRepairGaps(listClaimEvents("c9"), { totalLoss: true }), []);
        assert.equal(repairProgressGaps(listClaimEvents("c9"), { totalLoss: true }).length, 0);
      });
    } finally {
      db.close();
    }
  });

  it("gives TEST-0008 one explained gap and TEST-0007 an unexplained dashboard gap, without changing money", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaimEvents("c8");
        const hire = money(db, "f-c8-hire");
        assert.equal(hire.claimed_pence, 189600);
        assert.equal(hire.agreed_pence, 0);
        assert.equal(hire.received_pence, 0);
        const c7 = money(db, "f-c7-hire");
        assert.equal(c7.claimed_pence, 129600);
        assert.equal(c7.agreed_pence, 90000);
        assert.equal(c7.received_pence, 0);
        const c6 = money(db, "f-c6-rep");
        assert.equal(c6.claimed_pence, 240000);
        assert.equal(c6.agreed_pence, 0);
        assert.equal(c6.received_pence, 0);
        const c9 = money(db, "f-c9-vd");
        assert.equal(c9.offered_pence, 1200000);
        assert.equal(c9.claimed_pence, 1450000);
        const c5 = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as {
          storage_billing_end_on: string | null;
        };
        assert.equal(String(c5.storage_billing_end_on || ""), "");
        const storage = storageAuthorisationEndForClaim("c8");
        assert.equal(storage.kind, "matches");
        const c8Lines = justificationChronology(listClaimEvents("c8"));
        for (const step of [
          "engineer_inspection_booked",
          "engineer_inspection_attended",
          "engineer_report_received",
          "engineer_report_sent_to_insurer",
          "repairs_authorised",
          "vehicle_received_for_repair",
          "parts_ordered",
          "parts_delayed",
          "repairs_started",
          "repairs_complete",
        ]) {
          assert.equal(c8Lines.some((line) => line.eventType === step), true, step);
        }
        assert.deepEqual(justificationRepairGaps(listClaimEvents("c8")), []);
        const explained = gapsForClaim("c8", false);
        assert.equal(explained.length, 1);
        assert.equal(explained[0]?.explained, true);
        assert.match(String(explained[0]?.note), /awaiting parts/);
        const dashboard = listRepairGapClaims();
        assert.equal(dashboard.some((row) => row.fileReference === "TEST-0008"), false);
        const shown = dashboard.filter((row) => row.fileReference === "TEST-0007");
        assert.equal(shown.length, 1);
        assert.match(shown[0]!.wording, /Unexplained gap of 15 days between Engineer inspection booked and Engineer inspection attended/);
        const sent = c8Lines.find((line) => line.eventType === "engineer_report_sent_to_insurer");
        assert.match(String(sent?.details), /Sent to AXA/);
      });
    } finally {
      db.close();
    }
  });

  it("records the engineer's report from a mocked live send and not from a simulated send", async () => {
    const saved = rememberEnv();
    const db = seeded();
    try {
      useTestCredentials();
      process.env[EMAIL_SEND_MODE_ENV] = "simulate";
      await withDatabaseAsync(db, async () => {
        listClaimEvents("c3");
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, document_type, body_html, created_at) VALUES ('doc-eng-c3', 'c3', 'Engineer report', 'engineer_report', '<p>Report</p>', '2026-09-04T09:00:00.000Z')`,
        ).run();
        const simulated = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "claims@example.test",
          subject: "Engineer report simulate",
          body: "Simulated report.",
          attachmentIds: ["doc-eng-c3"],
        });
        assert.equal(simulated.ok, true);
        if (simulated.ok) {
          assert.equal(simulated.status, "simulated_sent");
          assert.equal(simulated.engineerReportNotice, SIMULATED_REPORT_NOT_RECORDED);
        }
        const simulatedRows = db.prepare(
          `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c3' AND event_type = 'engineer_report_sent_to_insurer'`,
        ).get() as { n: number };
        assert.equal(Number(simulatedRows.n), 0);
        process.env[EMAIL_SEND_MODE_ENV] = "live";
        setMailboxFetchForTests(async (input) => {
          const url = requestUrl(input);
          if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
          if (url.endsWith("/messages")) return Response.json({ id: "draft-1" }, { status: 201 });
          if (url.includes("/attachments")) return new Response(null, { status: 201 });
          if (url.endsWith("/send")) return new Response(null, { status: 202 });
          return new Response("unexpected", { status: 500 });
        });
        const live = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "claims@example.test",
          subject: "Engineer report live",
          body: "Mocked live report.",
          attachmentIds: ["doc-eng-c3"],
        });
        assert.equal(live.ok, true, live.ok ? "" : live.error);
        if (live.ok) assert.equal(live.status, "sent");
        const sent = db.prepare(
          `SELECT event_type, title, details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'engineer_report_sent_to_insurer'`,
        ).get() as { event_type: string; title: string; details: string };
        assert.equal(sent.event_type, "engineer_report_sent_to_insurer");
        assert.equal(sent.title, "Engineer's report sent to insurer");
        assert.match(sent.details, /claims@example\.test/);
        assert.match(sent.details, /live send/);
        const again = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "other@example.test",
          subject: "Engineer report live again",
          body: "Second mocked send.",
          attachmentIds: ["doc-eng-c3"],
        });
        assert.equal(again.ok, true);
        const count = db.prepare(
          `SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c3' AND event_type = 'engineer_report_sent_to_insurer'`,
        ).get() as { n: number };
        assert.equal(Number(count.n), 1);
        void CAS_CLAIMS_MAILBOX;
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("shows the simulated wording on the engineering and email screens", () => {
    const screen = fs.readFileSync(path.join(process.cwd(), "src/components/claims/RecordRepairSteps.tsx"), "utf8");
    const notice = fs.readFileSync(path.join(process.cwd(), "src/components/claims/SendPreparedEmailForm.tsx"), "utf8");
    const comms = fs.readFileSync(path.join(process.cwd(), "src/components/claim-file/CommsDesk.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.match(screen, /SIMULATED_REPORT_NOT_RECORDED/);
    assert.match(notice, /SIMULATED_REPORT_NOT_RECORDED/);
    assert.match(comms, /engineerReportNotice/);
    assert.match(dashboard, /Repair progress gaps to explain/);
    assert.equal(SIMULATED_REPORT_NOT_RECORDED, "Simulated, not recorded as sent");
  });
});

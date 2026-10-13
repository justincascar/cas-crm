import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { listClaimEvents } from "../src/lib/db/chronology.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { eventLabel } from "../src/lib/domain/events.ts";
import {
  dispatchFromHistoryNote,
  justificationChaseEventTypes,
  justificationChronology,
  justificationRepairGaps,
  type JustificationSourceEvent,
} from "../src/lib/domain/justification-chronology.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function event(partial: JustificationSourceEvent): JustificationSourceEvent {
  return partial;
}

function snapshot(db: DatabaseSync, claimId: string) {
  const events = db
    .prepare(
      `SELECT id, event_type, title, details, occurred_at, recorded_at
       FROM claim_events WHERE claim_id = ? ORDER BY id`,
    )
    .all(claimId) as Array<Record<string, string | null>>;
  const automations = db
    .prepare(`SELECT id, rule_key, status, paused, reason, next_run_at FROM automations WHERE claim_id = ? ORDER BY id`)
    .all(claimId) as Array<Record<string, string | number | null>>;
  return {
    events: events.map((row) => ({ ...row })),
    automations: automations.map((row) => ({ ...row })),
  };
}

describe("hire and repair chronology", () => {
  it("lists a full history in date order, with each existing label", () => {
    const chaseTypes = justificationChaseEventTypes();
    const chaseEvents = chaseTypes.map((type, index) =>
      event({
        id: `chase-${type}`,
        event_type: type,
        title: eventLabel(type),
        details:
          type === "liability_chase_sent"
            ? "Recorded from generated Liability chaser."
            : type === "payment_chase_1_sent" || type === "payment_chase_2_sent" || type === "document_chase_sent"
              ? `head note for ${type}`
              : `${eventLabel(type)} marked as sent by Sian. Interval restarted.`,
        occurred_at: `2026-05-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
        recorded_at: `2026-05-${String(index + 1).padStart(2, "0")}T09:05:00.000Z`,
      }),
    );
    const milestones: JustificationSourceEvent[] = [
      event({
        id: "storage",
        event_type: "storage_ended",
        title: "Storage ended",
        details: "Return job completed.",
        occurred_at: "2026-06-08T10:00:00.000Z",
        recorded_at: "2026-06-08T10:01:00.000Z",
      }),
      event({
        id: "hire",
        event_type: "hire_ended",
        title: "Hire ended",
        details: "Hire car collected.",
        occurred_at: "2026-06-01T10:00:00.000Z",
        recorded_at: "2026-06-01T10:01:00.000Z",
      }),
      event({
        id: "report",
        event_type: "engineer_report_received",
        title: "Engineer report received",
        details: "Engineer's report logged as received by Tom. Chase reminder cleared.",
        occurred_at: "2026-04-01T14:00:00.000Z",
        recorded_at: "2026-04-01T14:01:00.000Z",
      }),
      event({
        id: "eng-gen",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Recorded from generated Engineer instruction.",
        occurred_at: "2026-03-10T10:00:00.000Z",
        recorded_at: "2026-03-10T10:01:00.000Z",
      }),
      event({
        id: "own-gen",
        event_type: "initial_letter_own_insurer",
        title: "Initial letter to client's own insurer",
        details: "Recorded from generated Initial letter to the client's own insurer.",
        occurred_at: "2026-03-06T09:00:00.000Z",
        recorded_at: "2026-03-06T09:01:00.000Z",
      }),
      event({
        id: "tp-sent",
        event_type: "initial_letter_tp_insurer",
        title: "Initial letter to third-party insurer",
        details: "Initial letter. Marked as sent by Tom. Prepared, not auto-sent from claims@cascar.co.uk.",
        occurred_at: "2026-03-05T09:00:00.000Z",
        recorded_at: "2026-03-05T09:01:00.000Z",
      }),
      event({
        id: "recovery",
        event_type: "recovery_completed",
        title: "Recovery completed",
        details: "M4 Junction 42, Swansea.",
        occurred_at: "2026-03-02T18:00:00.000Z",
        recorded_at: "2026-03-02T18:01:00.000Z",
      }),
      event({
        id: "accident",
        event_type: "accident",
        title: "Accident",
        details: "Newport Road, Cardiff.",
        occurred_at: "2026-03-01T08:00:00.000Z",
        recorded_at: "2026-03-01T11:00:00.000Z",
      }),
      event({
        id: "noise-repair",
        event_type: "repairs_complete",
        title: "Repairs complete",
        details: "Not reliable yet.",
        occurred_at: "2026-04-15T08:00:00.000Z",
      }),
      event({
        id: "noise-start",
        event_type: "repairs_started",
        title: "Repairs started",
        details: "Not on this chronology.",
        occurred_at: "2026-04-10T08:00:00.000Z",
      }),
      event({
        id: "noise-hire",
        event_type: "hire_started",
        title: "Hire / courtesy started",
        details: "Not a required line.",
        occurred_at: "2026-03-03T08:00:00.000Z",
      }),
      event({
        id: "noise-doc",
        event_type: "document_generated",
        title: "Document generated",
        details: "Engineer instruction (version 1) generated — not sent",
        occurred_at: "2026-03-10T10:00:00.000Z",
      }),
      event({
        id: "noise-email",
        event_type: "outgoing_email",
        title: "Email sent",
        details: "Engineer instruction sent to engineer@example.com from claims@cascar.co.uk by Tom.",
        occurred_at: "2026-03-05T09:00:00.000Z",
      }),
    ];

    const lines = justificationChronology([...chaseEvents, ...milestones].reverse());
    const types = lines.map((line) => line.eventType);
    assert.deepEqual(types.slice(0, 6), [
      "accident",
      "recovery_completed",
      "initial_letter_tp_insurer",
      "initial_letter_own_insurer",
      "engineer_instructed",
      "engineer_report_received",
    ]);
    assert.equal(types.at(-2), "hire_ended");
    assert.equal(types.at(-1), "storage_ended");
    for (const type of chaseTypes) {
      assert.equal(types.includes(type), true, type);
    }
    assert.equal(types.includes("repairs_started"), true);
    assert.equal(types.includes("repairs_complete"), true);
    const startedAt = lines.findIndex((line) => line.eventType === "repairs_started");
    const completeAt = lines.findIndex((line) => line.eventType === "repairs_complete");
    const reportAt = lines.findIndex((line) => line.id === "report");
    assert.ok(reportAt < startedAt);
    assert.ok(startedAt < completeAt);
    assert.equal(lines[startedAt]?.title, "Repairs started");
    assert.equal(lines[completeAt]?.title, "Repairs complete");
    assert.equal(lines[startedAt]?.dispatch, null);
    assert.equal(lines[completeAt]?.dispatch, null);
    assert.deepEqual(justificationRepairGaps([...chaseEvents, ...milestones]), []);
    assert.equal(types.includes("hire_started"), false);
    assert.equal(types.includes("document_generated"), false);
    assert.equal(types.includes("outgoing_email"), false);
    assert.deepEqual(
      lines.map((line) => line.title),
      lines.map((line) => eventLabel(line.eventType)),
    );
    const dates = lines.map((line) => line.occurredAt);
    assert.deepEqual(dates, [...dates].sort());

    const generated = lines.find((line) => line.id === "eng-gen");
    const sent = lines.find((line) => line.id === "tp-sent");
    assert.equal(generated?.dispatch, "generated");
    assert.equal(sent?.dispatch, "sent");
    assert.notEqual(generated?.dispatch, sent?.dispatch);
    assert.match(generated?.details || "", /Recorded from generated/);
    assert.match(sent?.details || "", /Marked as sent/);

    const generatedChase = lines.find((line) => line.eventType === "liability_chase_sent");
    assert.equal(generatedChase?.title, "Liability chase sent");
    assert.equal(generatedChase?.dispatch, "generated");
  });

  it("shows only the steps a thin file already has", () => {
    const thin = [
      event({
        id: "a",
        event_type: "accident",
        title: "Accident",
        details: "Cardiff.",
        occurred_at: "2026-01-02T08:00:00.000Z",
      }),
      event({
        id: "open",
        event_type: "file_opened",
        title: "File opened",
        details: "New enquiry.",
        occurred_at: "2026-01-02T09:00:00.000Z",
      }),
    ];
    const onlyAccident = justificationChronology(thin);
    assert.equal(onlyAccident.length, 1);
    assert.equal(onlyAccident[0]?.title, "Accident");
    assert.equal(onlyAccident[0]?.dispatch, null);
    assert.deepEqual(justificationRepairGaps(thin), []);
    assert.equal(justificationChronology([]).length, 0);
    assert.deepEqual(justificationRepairGaps([]), []);
  });

  it("uses the stored note to tell a generated letter from a sent one", () => {
    assert.equal(dispatchFromHistoryNote("Recorded from generated Engineer instruction."), "generated");
    assert.equal(
      dispatchFromHistoryNote(
        "Engineer instructed (Engineer instruction). Marked as sent by Sian. Prepared, not auto-sent from claims@cascar.co.uk.",
      ),
      "sent",
    );
    assert.equal(
      dispatchFromHistoryNote("Engineer instructed (Engineer instruction). Sent from claims@cascar.co.uk by Sian."),
      "sent",
    );
    assert.equal(
      dispatchFromHistoryNote("Engineer report chase sent from claims@cascar.co.uk by Sian. Interval restarted."),
      "sent",
    );
    assert.equal(dispatchFromHistoryNote("head=repairs Sent by Sian. Reminder only — not auto-sent."), "sent");
    assert.equal(
      dispatchFromHistoryNote("Engineer instruction sent to eng@example.com from claims@cascar.co.uk by Sian."),
      "sent",
    );
    assert.equal(dispatchFromHistoryNote("Recorded from CAS email template engineer_instruction."), null);
    assert.equal(dispatchFromHistoryNote("Prepared, not auto-sent from claims@cascar.co.uk."), null);
    assert.equal(dispatchFromHistoryNote("Notification to Zurich. Simulated send."), null);

    const generated = justificationChronology([
      event({
        id: "g",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Recorded from generated Engineer instruction.",
        occurred_at: "2026-03-01T10:00:00.000Z",
      }),
    ]);
    const sent = justificationChronology([
      event({
        id: "s",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Engineer instructed (Engineer instruction). Sent from claims@cascar.co.uk by Sian.",
        occurred_at: "2026-03-02T10:00:00.000Z",
      }),
    ]);
    assert.equal(generated[0]?.dispatch, "generated");
    assert.equal(sent[0]?.dispatch, "sent");
    assert.notEqual(generated[0]?.details, sent[0]?.details);

    const view = fs.readFileSync(
      path.join(process.cwd(), "src/components/claims/JustificationChronology.tsx"),
      "utf8",
    );
    assert.match(view, /Generated only/);
    assert.match(view, /Sent/);
    assert.match(view, /is not recorded/);
    assert.equal(view.includes("recordClaimEvent"), false);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
    assert.match(page, /totalLoss=\{Number\(claim\.total_loss\) === 1 \|\| Number\(claim\.later_declared_total_loss\) === 1\}/);
  });

  it("does not change file history or automations", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/domain/justification-chronology.ts"),
      "utf8",
    );
    assert.equal(source.includes("recordClaimEvent"), false);
    assert.equal(source.includes("INSERT"), false);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
    assert.match(page, /JustificationChronology/);

    const db = seeded();
    withDatabase(db, () => {
      listClaimEvents("c3");
      listClaimEvents("c1");
      const beforeC3 = snapshot(db, "c3");
      const beforeC1 = snapshot(db, "c1");
      const beforeAutos = db.prepare(`SELECT COUNT(*) AS n FROM automations`).get() as { n: number };
      const c3 = justificationChronology(listClaimEvents("c3"));
      const c1 = justificationChronology(listClaimEvents("c1"));
      const afterC3 = snapshot(db, "c3");
      const afterC1 = snapshot(db, "c1");
      const afterAutos = db.prepare(`SELECT COUNT(*) AS n FROM automations`).get() as { n: number };
      assert.deepEqual(afterC3, beforeC3);
      assert.deepEqual(afterC1, beforeC1);
      assert.equal(Number(afterAutos.n), Number(beforeAutos.n));

      assert.deepEqual(
        c3.map((line) => line.eventType),
        ["accident", "recovery_completed", "initial_letter_tp_insurer", "engineer_instructed"],
      );
      assert.deepEqual(
        c3.map((line) => line.title),
        [
          "Accident",
          "Recovery completed",
          "Initial letter to third-party insurer",
          "Engineer instructed",
        ],
      );
      assert.equal(c3.every((line) => line.dispatch === null), true);
      assert.equal(c3.some((line) => line.eventType === "hire_ended"), false);
      assert.equal(c3.some((line) => line.eventType === "storage_ended"), false);
      assert.equal(c1.map((line) => line.title).join(","), "Accident");
      assert.deepEqual(justificationRepairGaps(listClaimEvents("c3")), [
        { eventType: "repairs_started", label: "Repairs started" },
        { eventType: "repairs_complete", label: "Repairs complete" },
      ]);
      assert.deepEqual(justificationRepairGaps(listClaimEvents("c1")), []);
    });
  });

  it("lists stored repair steps by the date on the file, not in a fixed order", () => {
    const mixed = [
      event({
        id: "storage",
        event_type: "storage_ended",
        title: "Storage ended",
        details: "Collected.",
        occurred_at: "2026-01-02T09:00:00.000Z",
        recorded_at: "2026-01-02T09:05:00.000Z",
      }),
      event({
        id: "done-first",
        event_type: "repairs_complete",
        title: "Repairs complete",
        details: "Finished before the later start was logged.",
        occurred_at: "2026-01-05T09:00:00.000Z",
        recorded_at: "2026-01-05T09:05:00.000Z",
      }),
      event({
        id: "accident",
        event_type: "accident",
        title: "Accident",
        details: "Cardiff.",
        occurred_at: "2026-02-01T08:00:00.000Z",
        recorded_at: "2026-02-01T12:00:00.000Z",
      }),
      event({
        id: "hire",
        event_type: "hire_ended",
        title: "Hire ended",
        details: "Collected.",
        occurred_at: "2026-02-10T10:00:00.000Z",
        recorded_at: "2026-02-10T10:01:00.000Z",
      }),
      event({
        id: "same-late",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Recorded from generated Engineer instruction.",
        occurred_at: "2026-03-01T10:00:00.000Z",
        recorded_at: "2026-03-01T11:00:00.000Z",
      }),
      event({
        id: "same-early",
        event_type: "initial_letter_tp_insurer",
        title: "Initial letter to third-party insurer",
        details: "Initial letter. Marked as sent by Tom.",
        occurred_at: "2026-03-01T10:00:00.000Z",
        recorded_at: "2026-03-01T10:00:00.000Z",
      }),
      event({
        id: "started-last",
        event_type: "repairs_started",
        title: "Repairs started",
        details: "Recorded from generated Repair commencement letter.",
        occurred_at: "2026-04-01T08:00:00.000Z",
        recorded_at: "2026-04-01T08:01:00.000Z",
      }),
      event({
        id: "noise",
        event_type: "hire_started",
        title: "Hire / courtesy started",
        details: "Not a required line.",
        occurred_at: "2026-01-01T08:00:00.000Z",
      }),
    ];
    const lines = justificationChronology(mixed);
    assert.deepEqual(
      lines.map((line) => line.id),
      ["storage", "done-first", "accident", "hire", "same-early", "same-late", "started-last"],
    );
    assert.equal(lines.find((line) => line.id === "started-last")?.title, "Repairs started");
    assert.equal(lines.find((line) => line.id === "started-last")?.dispatch, "generated");
    assert.equal(lines.find((line) => line.id === "done-first")?.title, "Repairs complete");
    assert.equal(lines.find((line) => line.id === "done-first")?.dispatch, null);
    assert.equal(lines.find((line) => line.id === "same-late")?.dispatch, "generated");
    assert.equal(lines.find((line) => line.id === "same-early")?.dispatch, "sent");
    assert.deepEqual(justificationRepairGaps(mixed), []);
    const dated = lines.map((line) => line.occurredAt);
    assert.deepEqual(dated, [...dated].sort());
    assert.ok(lines.findIndex((line) => line.id === "done-first") < lines.findIndex((line) => line.id === "started-last"));
    assert.ok(lines.findIndex((line) => line.id === "done-first") < lines.findIndex((line) => line.id === "accident"));
  });

  it("states a repair step is not recorded when repair applies and that event is absent", () => {
    const engineerOnly = [
      event({
        id: "eng",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Instructed.",
        occurred_at: "2026-03-01T10:00:00.000Z",
      }),
      event({
        id: "acc",
        event_type: "accident",
        title: "Accident",
        details: "Cardiff.",
        occurred_at: "2026-02-01T08:00:00.000Z",
      }),
    ];
    const waiting = justificationChronology(engineerOnly);
    assert.deepEqual(
      waiting.map((line) => line.eventType),
      ["accident", "engineer_instructed"],
    );
    assert.equal(waiting.some((line) => line.eventType === "repairs_started"), false);
    assert.equal(waiting.some((line) => line.eventType === "repairs_complete"), false);
    assert.deepEqual(justificationRepairGaps(engineerOnly), [
      { eventType: "repairs_started", label: "Repairs started" },
      { eventType: "repairs_complete", label: "Repairs complete" },
    ]);

    const startedOnly = [
      event({
        id: "start",
        event_type: "repairs_started",
        title: "Repairs started",
        details: "In the bodyshop.",
        occurred_at: "2026-04-10T08:00:00.000Z",
      }),
    ];
    const underway = justificationChronology(startedOnly);
    assert.equal(underway.length, 1);
    assert.equal(underway[0]?.title, "Repairs started");
    assert.equal(underway[0]?.occurredAt, "2026-04-10T08:00:00.000Z");
    assert.deepEqual(justificationRepairGaps(startedOnly), [
      { eventType: "repairs_complete", label: "Repairs complete" },
    ]);

    const finishedOnly = [
      event({
        id: "done",
        event_type: "repairs_complete",
        title: "Repairs complete",
        details: "Complete.",
        occurred_at: "2026-05-01T09:00:00.000Z",
      }),
    ];
    const finished = justificationChronology(finishedOnly);
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.title, "Repairs complete");
    assert.deepEqual(justificationRepairGaps(finishedOnly), [
      { eventType: "repairs_started", label: "Repairs started" },
    ]);
  });

  it("shows no repair-pipeline lines on a total loss or a file that never went to repair", () => {
    const repaired = [
      event({
        id: "eng",
        event_type: "engineer_instructed",
        title: "Engineer instructed",
        details: "Total loss inspection.",
        occurred_at: "2026-03-01T11:00:00.000Z",
      }),
      event({
        id: "start",
        event_type: "repairs_started",
        title: "Repairs started",
        details: "Started.",
        occurred_at: "2026-03-10T08:00:00.000Z",
      }),
      event({
        id: "done",
        event_type: "repairs_complete",
        title: "Repairs complete",
        details: "Complete.",
        occurred_at: "2026-04-01T08:00:00.000Z",
      }),
      event({
        id: "acc",
        event_type: "accident",
        title: "Accident",
        details: "Cwmbran.",
        occurred_at: "2026-02-01T08:00:00.000Z",
      }),
    ];
    const loss = justificationChronology(repaired, { totalLoss: true });
    assert.deepEqual(
      loss.map((line) => line.eventType),
      ["accident", "engineer_instructed"],
    );
    assert.equal(loss.some((line) => line.eventType === "repairs_started"), false);
    assert.equal(loss.some((line) => line.eventType === "repairs_complete"), false);
    assert.deepEqual(justificationRepairGaps(repaired, { totalLoss: true }), []);

    const fault = [
      event({
        id: "hire",
        event_type: "hire_started",
        title: "Hire / courtesy started",
        details: "Fault courtesy — not credit hire.",
        occurred_at: "2026-03-01T09:00:00.000Z",
      }),
      event({
        id: "acc",
        event_type: "accident",
        title: "Accident",
        details: "Bridgend.",
        occurred_at: "2026-02-20T08:00:00.000Z",
      }),
    ];
    const courtesy = justificationChronology(fault);
    assert.deepEqual(
      courtesy.map((line) => line.eventType),
      ["accident"],
    );
    assert.deepEqual(justificationRepairGaps(fault), []);
  });

  it("reads the seeded repair history and leaves a total loss without repair blanks", () => {
    const db = seeded();
    withDatabase(db, () => {
      listClaimEvents("c8");
      const c8 = listClaimEvents("c8");
      const c7 = listClaimEvents("c7");
      const c9 = listClaimEvents("c9");
      const c4 = listClaimEvents("c4");
      const loss = db
        .prepare(`SELECT total_loss, later_declared_total_loss FROM claims WHERE id = ?`)
        .get("c9") as { total_loss: number; later_declared_total_loss: number };
      assert.equal(Number(loss.total_loss), 1);

      const done = justificationChronology(c8);
      assert.equal(done.some((line) => line.eventType === "repairs_started" && line.title === "Repairs started"), true);
      assert.equal(done.some((line) => line.eventType === "repairs_complete" && line.title === "Repairs complete"), true);
      const doneDates = done.map((line) => line.occurredAt);
      assert.deepEqual(doneDates, [...doneDates].sort());
      assert.deepEqual(justificationRepairGaps(c8), []);

      const underway = justificationChronology(c7);
      assert.equal(underway.some((line) => line.title === "Repairs started"), true);
      assert.equal(underway.some((line) => line.eventType === "repairs_complete"), false);
      assert.deepEqual(justificationRepairGaps(c7), [
        { eventType: "repairs_complete", label: "Repairs complete" },
      ]);

      const writtenOff = justificationChronology(c9, { totalLoss: Number(loss.total_loss) === 1 });
      assert.equal(writtenOff.some((line) => line.eventType === "engineer_instructed"), true);
      assert.equal(writtenOff.some((line) => line.eventType === "repairs_started"), false);
      assert.equal(writtenOff.some((line) => line.eventType === "repairs_complete"), false);
      assert.deepEqual(
        justificationRepairGaps(c9, { totalLoss: Number(loss.later_declared_total_loss) === 1 || Number(loss.total_loss) === 1 }),
        [],
      );

      assert.deepEqual(justificationRepairGaps(c4), []);
      assert.equal(justificationChronology(c4).some((line) => line.eventType.startsWith("repair")), false);
    });
    db.close();
  });
});

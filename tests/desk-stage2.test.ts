import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { EXTENDED_WAIT } from "../src/lib/auth/roles.ts";
import { chaseRow } from "../src/lib/db/chase.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  hiddenWaitItemIds,
  logDeskCall,
  prepareDeskChaser,
  releaseDueWaits,
  setWorkWait,
  undoWorkWait,
  claimRunningDaily,
} from "../src/lib/db/desk-work.ts";
import { claimOutstandingSummary, getDashboard, listClaims } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { dayAfter, fleetConflictText, isDeskIntent } from "../src/lib/domain/desk-actions.ts";
import { lineOutstanding, summariseHeads, type OutstandingLineInput } from "../src/lib/domain/head-outstanding.ts";
import { compareDeskItems, runningScore, todaysWorkRows, type DeskWorkItem } from "../src/lib/domain/todays-work.ts";
import { londonTodayIso } from "../src/lib/dates.ts";
import { emailSendMode } from "../src/lib/email/send-mode.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function shift(iso: string, days: number): string {
  let day = iso;
  for (let index = 0; index < days; index += 1) day = dayAfter(day);
  return day;
}

function line(partial: Partial<OutstandingLineInput> & Pick<OutstandingLineInput, "fileReference" | "head">): OutstandingLineInput {
  return {
    claimId: partial.fileReference,
    claimedPence: 0,
    offeredPence: 0,
    agreedPence: 0,
    receivedPence: 0,
    claimedConfirmed: true,
    ...partial,
  };
}

/** The figures on the database Justin uses. Stored amounts are not changed to force them. */
function liveLines(): OutstandingLineInput[] {
  return [
    line({ fileReference: "TEST-0007", head: "hire", claimedPence: 90_000, agreedPence: 90_000, receivedPence: 10_000 }),
    line({ fileReference: "TEST-0001", head: "recovery", claimedPence: 47_400 }),
    line({ fileReference: "TEST-0003", head: "recovery", claimedPence: 39_500, receivedPence: 10_000 }),
    line({ fileReference: "TEST-0005", head: "recovery", claimedPence: 47_400 }),
    line({ fileReference: "TEST-0006", head: "repairs", claimedPence: 8_000, agreedPence: 8_000, receivedPence: 8_000 }),
    line({ fileReference: "TEST-0009", head: "salvage_shortfall", claimedPence: 180_000 }),
    line({ fileReference: "TEST-0003", head: "storage", claimedPence: 23_400 }),
    line({ fileReference: "TEST-0009", head: "vehicle_damage", claimedPence: 1_450_000 }),
    line({ fileReference: "TEST-0012", head: "vehicle_damage", claimedPence: 1_800_000 }),
    line({
      fileReference: "TEST-0010",
      head: "vehicle_damage",
      claimedPence: 820_000,
      agreedPence: 670_000,
      receivedPence: 820_000,
    }),
    line({ fileReference: "TEST-0004", head: "courtesy", claimedPence: 0, claimedConfirmed: false }),
  ];
}

describe("stage 2 desk", () => {
  it("keeps an overpayment off every other head", () => {
    const mixed = summariseHeads([
      line({ fileReference: "TEST-A", head: "hire", agreedPence: 10_000, receivedPence: 0, claimedPence: 10_000 }),
      line({ fileReference: "TEST-A", head: "repairs", agreedPence: 5_000, receivedPence: 8_000, claimedPence: 5_000 }),
    ]);
    assert.equal(mixed.heads.find((row) => row.head === "hire")?.outstandingPence, 10_000);
    assert.equal(mixed.heads.find((row) => row.head === "repairs")?.outstandingPence, 0);
    assert.equal(mixed.heads.find((row) => row.head === "repairs")?.overpaidPence, 3_000);
    assert.equal(mixed.confirmed.outstandingPence, 10_000);
    assert.equal(mixed.confirmed.overpaidPence, 3_000);

    const live = summariseHeads(liveLines());
    const vehicle = live.heads.find((row) => row.head === "vehicle_damage");
    assert.equal(vehicle?.outstandingPence, 3_250_000);
    assert.equal(vehicle?.overpaidPence, 150_000);
    assert.equal(live.confirmed.outstandingPence, 3_657_700);
    assert.equal(live.confirmed.overpaidPence, 150_000);
    assert.equal(live.heads.find((row) => row.head === "hire")?.outstandingPence, 80_000);
    assert.equal(live.heads.find((row) => row.head === "recovery")?.outstandingPence, 124_300);
    assert.equal(live.heads.find((row) => row.head === "repairs")?.outstandingPence, 0);
    assert.equal(live.heads.find((row) => row.head === "storage")?.outstandingPence, 23_400);
    assert.equal(live.heads.find((row) => row.head === "salvage_shortfall")?.outstandingPence, 180_000);
    const courtesy = lineOutstanding(liveLines().find((row) => row.head === "courtesy")!);
    assert.equal(courtesy.basis, "none");
    assert.equal(courtesy.outstandingPence, null);

    const sianRefs = new Set(["TEST-0001", "TEST-0005", "TEST-0010"]);
    const sian = summariseHeads(liveLines().filter((row) => sianRefs.has(row.fileReference)));
    assert.equal(sian.confirmed.outstandingPence, 94_800);
    assert.equal(sian.confirmed.overpaidPence, 150_000);
    assert.ok((sian.confirmed.outstandingPence || 0) >= 0);
  });

  it("does not let an overpayment reduce All claims or My claims", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const all = getDashboard();
        const sian = getDashboard({ handlerId: "staff-sian" });
        const sumHeads = (rows: typeof all.moneyHeads) => rows.reduce((sum, row) => sum + (row.outstandingPence || 0), 0);
        for (const row of all.moneyHeads) {
          if (row.outstandingPence !== null) assert.ok(row.outstandingPence >= 0);
        }
        for (const row of sian.moneyHeads) {
          if (row.outstandingPence !== null) assert.ok(row.outstandingPence >= 0);
        }
        assert.equal(all.moneyConfirmed.outstandingPence, sumHeads(all.moneyHeads));
        assert.equal(sian.moneyConfirmed.outstandingPence, sumHeads(sian.moneyHeads));
        assert.equal(all.moneyConfirmed.overpaidPence, all.moneyHeads.reduce((sum, row) => sum + row.overpaidPence, 0));
        assert.equal(sian.moneyConfirmed.overpaidPence, sian.moneyHeads.reduce((sum, row) => sum + row.overpaidPence, 0));
        const courtesy = all.moneyHeads.find((row) => row.head === "courtesy");
        if (courtesy) assert.equal(courtesy.outstandingPence === null || courtesy.outstandingPence >= 0, true);
      });
    } finally {
      db.close();
    }
  });

  it("flags the fleet conflict on TEST-0010 and does not repeat Overdue in an item", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const all = getDashboard();
        const conflict = all.fleetConflicts.find((row) => row.fileReference === "TEST-0010");
        assert.ok(conflict);
        assert.equal(conflict.status, "maintenance");
        assert.equal(conflict.text, fleetConflictText(conflict.registration, conflict.status, "TEST-0010"));
        assert.match(conflict.text, /^Fleet record conflict: .+ is marked maintenance but is on hire to TEST-0010$/);
        const row = all.todaysWork.find((item) => item.fileReference === "TEST-0010");
        assert.ok(row);
        assert.equal([row.lead, ...row.rest].some((item) => item.item === conflict.text && item.tier === 1), true);
        for (const work of all.todaysWork) {
          for (const item of [work.lead, ...work.rest]) assert.equal(/\boverdue\b/i.test(item.item), false);
        }
      });
    } finally {
      db.close();
    }
  });

  it("sorts deadlines, then money still running, then the rest", () => {
    const deadline = {
      id: "d",
      claimId: "c-d",
      fileReference: "TEST-D",
      clientName: "D",
      handlerName: "H",
      item: "Deadline",
      wording: "Overdue by 1 day",
      tone: "overdue",
      sortDays: 1,
      tier: 1,
    } as DeskWorkItem;
    const dear = {
      ...deadline,
      id: "dear",
      claimId: "c-dear",
      fileReference: "TEST-E",
      sortDays: 9,
      item: "Older deadline",
    };
    const moneyHigh = {
      ...deadline,
      id: "m1",
      claimId: "c-m1",
      fileReference: "TEST-M1",
      tier: 2 as const,
      sortDays: 3,
      runningDailyPence: 12_400,
      progressDays: 10,
      item: "Gap",
    };
    const moneyLow = {
      ...moneyHigh,
      id: "m2",
      claimId: "c-m2",
      fileReference: "TEST-M2",
      runningDailyPence: 2_000,
      progressDays: 8,
    };
    const other = { ...deadline, id: "o", claimId: "c-o", fileReference: "TEST-O", tier: 3 as const, sortDays: 40, item: "Task" };
    const rows = todaysWorkRows([other, moneyLow, dear, moneyHigh, deadline]);
    assert.equal(rows[0]?.fileReference, "TEST-E");
    assert.equal(rows[1]?.fileReference, "TEST-D");
    assert.equal(rows[2]?.fileReference, "TEST-M1");
    assert.equal(rows[3]?.fileReference, "TEST-M2");
    assert.equal(rows[4]?.fileReference, "TEST-O");
    assert.equal(runningScore(moneyHigh) > runningScore(moneyLow), true);
    assert.ok(compareDeskItems(rows[0]!.lead, rows[1]!.lead) <= 0);

    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const all = getDashboard();
        for (let index = 1; index < all.todaysWork.length; index += 1) {
          assert.ok(compareDeskItems(all.todaysWork[index - 1]!.lead, all.todaysWork[index]!.lead) <= 0);
        }
        for (const row of all.todaysWork.filter((item) => item.lead.tier === 2)) {
          assert.equal(row.lead.runningDailyPence, claimRunningDaily(row.claimId).dailyPence);
          assert.ok((row.lead.progressDays || 0) > 0);
        }
      });
    } finally {
      db.close();
    }
  });

  it("uses the open step for today's work and does not let a typed note replace it", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        db.prepare(`UPDATE claims SET next_action = 'Call the client about the courtesy car', next_action_due = NULL WHERE file_reference = 'TEST-0004'`).run();
        const claim = db.prepare(`SELECT id FROM claims WHERE file_reference = 'TEST-0004'`).get() as { id: string };
        listClaims();
        const all = getDashboard();
        const row = all.todaysWork.find((item) => item.fileReference === "TEST-0004");
        assert.ok(row);
        const blank = [row.lead, ...row.rest].find((item) => item.id === `next-${claim.id}`);
        assert.ok(blank);
        assert.equal(blank.tier, 3);
        assert.equal(blank.item, "Open messages");
        assert.equal(blank.wording, "No due date");
        assert.equal(blank.item.includes("Call the client"), false);
      });
    } finally {
      db.close();
    }
  });

  it("logs a call and waits until the day after a promised date", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const today = londonTodayIso();
        const promise = shift(today, 2);
        const saved = logDeskCall({
          claimId: "c1",
          itemKey: "task-t1",
          outcome: "promised",
          note: "Handler will reply.",
          promiseOn: promise,
          actorId: "staff-sian",
          role: "staff",
          expectedVersion: "",
          submitKey: "call-1",
          today,
        });
        assert.equal(saved.waitUntil, dayAfter(promise));
        const event = db.prepare(`SELECT event_type, details FROM claim_events WHERE claim_id = 'c1' AND event_type = 'call_logged'`).get() as
          | { event_type: string; details: string }
          | undefined;
        assert.ok(event);
        assert.equal(event.event_type, "call_logged");
        assert.match(event.details, /Promised payment or response/);
        assert.equal(hiddenWaitItemIds(today).has("task-t1"), true);
      });
    } finally {
      db.close();
    }
  });

  it("hides a wait, brings it back, pauses a chase, and undoes within 10 seconds", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const today = londonTodayIso();
        listClaims();
        const before = getDashboard();
        const chase = before.todaysWork.flatMap((row) => [row.lead, ...row.rest]).find((item) => item.id === "chase-liability_response-c5");
        assert.ok(chase);
        const waited = setWorkWait({
          claimId: "c5",
          itemKey: chase.id,
          waitUntil: shift(today, 3),
          reason: "Insurer asked for three days.",
          actorId: "staff-sian",
          role: "staff",
          chaseKind: "liability_response",
          expectedVersion: "",
          submitKey: "wait-chase",
          today,
        });
        const hidden = getDashboard();
        assert.equal(
          hidden.todaysWork.flatMap((row) => [row.lead, ...row.rest]).some((item) => item.id === chase.id),
          false,
        );
        const paused = chaseRow("c5", "liability_response");
        assert.equal(paused?.status, "paused");
        assert.equal(Number(paused?.paused), 1);
        const stillThere = db.prepare(`SELECT COUNT(*) AS c FROM automations WHERE claim_id = 'c5' AND id = 'auto-c5-liab-chase'`).get() as {
          c: number;
        };
        assert.equal(Number(stillThere.c), 1);
        db.prepare(`UPDATE work_waits SET wait_until = ? WHERE id = ?`).run(today, waited.id);
        releaseDueWaits(today);
        const resumed = chaseRow("c5", "liability_response");
        assert.equal(resumed?.status, "tracking");
        assert.equal(Number(resumed?.paused), 0);
        const back = getDashboard();
        assert.equal(
          back.todaysWork.flatMap((row) => [row.lead, ...row.rest]).some((item) => item.id === chase.id),
          true,
        );
        const kept = db.prepare(`SELECT event_type FROM claim_events WHERE claim_id = 'c5' AND event_type = 'work_wait_set'`).get() as
          | { event_type: string }
          | undefined;
        assert.equal(kept?.event_type, "work_wait_set");

        const undoWait = setWorkWait({
          claimId: "c1",
          itemKey: "task-t1",
          waitUntil: shift(today, 2),
          reason: "Call back tomorrow.",
          actorId: "staff-sian",
          role: "staff",
          expectedVersion: "",
          submitKey: "wait-undo",
          today,
        });
        assert.equal(hiddenWaitItemIds(today).has("task-t1"), true);
        undoWorkWait({ waitId: undoWait.id, actorId: "staff-sian" });
        assert.equal(hiddenWaitItemIds(today).has("task-t1"), false);
        const undone = db.prepare(`SELECT undone_at FROM work_waits WHERE id = ?`).get(undoWait.id) as { undone_at: string | null };
        assert.ok(undone.undone_at);

        const late = setWorkWait({
          claimId: "c2",
          itemKey: "task-t2",
          waitUntil: shift(today, 2),
          reason: "Too late to undo.",
          actorId: "staff-sian",
          role: "staff",
          expectedVersion: "",
          submitKey: "wait-late",
          today,
        });
        const created = db.prepare(`SELECT created_at FROM work_waits WHERE id = ?`).get(late.id) as { created_at: string };
        assert.throws(
          () => undoWorkWait({ waitId: late.id, actorId: "staff-sian", nowMs: new Date(created.created_at).getTime() + 11_000 }),
          /10 seconds/,
        );
        assert.equal(hiddenWaitItemIds(today).has("task-t2"), true);
      });
    } finally {
      db.close();
    }
  });

  it("refuses a wait past 14 days unless the staff row has extendedWait", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const today = londonTodayIso();
        const far = shift(today, 15);
        const near = shift(today, 14);
        db.prepare(
          `INSERT INTO staff(id, name, email, username, password_hash, role, active) VALUES ('staff-admin-plain', 'Plain Admin', 'plain.admin@example.test', 'plainadmin', 'x', 'administrator', 1)`,
        ).run();
        db.prepare(
          `INSERT INTO staff(id, name, email, username, password_hash, role, active) VALUES ('staff-named-justin', 'Another Justin', 'another.justin@example.test', 'justin-other', 'x', 'administrator', 1)`,
        ).run();
        const base = {
          claimId: "c3",
          waitUntil: far,
          reason: "A long wait.",
          expectedVersion: "",
          today,
        };
        assert.throws(() => setWorkWait({ ...base, itemKey: "far-sian", actorId: "staff-sian", role: "staff", submitKey: "far-sian" }), /14 days/);
        assert.throws(
          () => setWorkWait({ ...base, itemKey: "far-admin", actorId: "staff-admin-plain", role: "administrator", submitKey: "far-admin" }),
          /14 days/,
        );
        assert.throws(
          () => setWorkWait({ ...base, itemKey: "far-name", actorId: "staff-named-justin", role: "administrator", submitKey: "far-name" }),
          /14 days/,
        );
        const allowed = setWorkWait({
          ...base,
          itemKey: "far-justin",
          actorId: "staff-justin",
          role: "administrator",
          submitKey: "far-justin",
        });
        assert.equal(allowed.waitUntil, far);
        const within = setWorkWait({
          ...base,
          itemKey: "near-sian",
          waitUntil: near,
          actorId: "staff-sian",
          role: "staff",
          submitKey: "near-sian",
        });
        assert.equal(within.waitUntil, near);
        const grant = db.prepare(`SELECT permission FROM staff_permissions WHERE staff_id = 'staff-justin' AND permission = ?`).get(EXTENDED_WAIT) as
          | { permission: string }
          | undefined;
        assert.equal(grant?.permission, EXTENDED_WAIT);
        const others = db.prepare(`SELECT COUNT(*) AS c FROM staff_permissions WHERE permission = ? AND staff_id != 'staff-justin'`).get(EXTENDED_WAIT) as {
          c: number;
        };
        assert.equal(Number(others.c), 0);
      });
    } finally {
      db.close();
    }
  });

  it("prepares a chaser without sending, and the desk cannot approve a settlement or change bank details", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        db.prepare(`UPDATE claim_third_parties SET insurer_email = ? WHERE id = 'tp-c5'`).run("aviva.handler@example.test");
        const prepared = prepareDeskChaser({ claimId: "c5", actorId: "staff-sian", kind: "liability_response" });
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as {
          sent_status: string;
        };
        assert.equal(row.sent_status, "prepared_not_sent");
        assert.notEqual(row.sent_status, "sent");
      });
    } finally {
      db.close();
    }
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/work/route.ts"), "utf8");
    assert.equal(route.includes("sendPreparedCorrespondence"), false);
    assert.equal(route.includes("acceptCharge"), false);
    assert.equal(route.includes("payment-details"), false);
    assert.equal(isDeskIntent("accept"), false);
    assert.equal(isDeskIntent("bank"), false);
    assert.equal(isDeskIntent("prepare"), true);
    const send = fs.readFileSync(path.join(process.cwd(), "src/lib/db/mailbox-send.ts"), "utf8");
    assert.match(send, /BANK_DETAILS_MISSING_SETTINGS/);
    const desk = fs.readFileSync(path.join(process.cwd(), "src/components/dashboard/TodaysWork.tsx"), "utf8");
    assert.match(desk, /BANK_DETAILS_MISSING_SETTINGS/);
    const copy = fs.readFileSync(path.join(process.cwd(), "src/lib/domain/payment-details.ts"), "utf8");
    assert.match(copy, /Bank details missing in Settings/);
    assert.equal(emailSendMode() === "live", false);
  });

  it("matches the claim summary to the money table", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const all = getDashboard();
        let outstanding = 0;
        let overpaid = 0;
        for (const claim of all.claims) {
          const summary = claimOutstandingSummary(String(claim.id));
          for (const head of summary.heads) {
            if (head.outstandingPence !== null) {
              assert.ok(head.outstandingPence >= 0);
              outstanding += head.outstandingPence;
            }
            overpaid += head.overpaidPence;
          }
        }
        assert.equal(outstanding, all.moneyConfirmed.outstandingPence);
        assert.equal(overpaid, all.moneyConfirmed.overpaidPence);
      });
    } finally {
      db.close();
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { runningDailyLabel } from "../src/lib/claims/claim-summary.ts";
import { listChasesForClaim } from "../src/lib/db/chase.ts";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import { databaseFingerprint, fingerprintChanges } from "../src/lib/db/database-fingerprint.ts";
import { claimRunningDaily } from "../src/lib/db/desk-work.ts";
import { hireChargeForClaim } from "../src/lib/db/hire-charge.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { getDashboard } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { recoveryClaimForClaim, syncRecoveryClaimed } from "../src/lib/db/storage-charge.ts";
import { storageChargeForClaim } from "../src/lib/db/storage-charge.ts";
import { formatGbp } from "../src/lib/money.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { c: number } | undefined;
  return Number(row?.c) || 0;
}

function readPage(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("opening a page does not write", () => {
  it("names a database change and stays quiet when nothing changed", () => {
    const db = prepared();
    try {
      const before = databaseFingerprint(db);
      assert.equal(fingerprintChanges(before, databaseFingerprint(db)).length, 0);
      db.prepare(`INSERT INTO settings(key, value) VALUES ('fingerprint-test', '1')`).run();
      const changes = fingerprintChanges(before, databaseFingerprint(db));
      assert.equal(changes.length, 1);
      assert.equal(changes[0], "added settings:fingerprint-test");
    } finally {
      db.close();
    }
  });

  it("does not insert a financial line or event when recovery, storage, hire and the desk are read", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        get(`SELECT id FROM claims WHERE id = 'c8'`);
        const recoveryBefore = count(db, `SELECT COUNT(*) AS c FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'recovery'`);
        const eventsBefore = count(db, `SELECT COUNT(*) AS c FROM claim_events WHERE claim_id = 'c8'`);
        assert.equal(recoveryBefore, 0);
        const before = databaseFingerprint(db);
        recoveryClaimForClaim("c8");
        storageChargeForClaim("c5");
        storageChargeForClaim("c8");
        hireChargeForClaim("c8");
        hireChargeForClaim("c3");
        listChasesForClaim("c5");
        listChasesForClaim("c8");
        getDashboard();
        assert.equal(fingerprintChanges(before, databaseFingerprint(db)).length, 0);
        assert.equal(count(db, `SELECT COUNT(*) AS c FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'recovery'`), 0);
        assert.equal(count(db, `SELECT COUNT(*) AS c FROM claim_events WHERE claim_id = 'c8'`), eventsBefore);
        const end = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as { storage_billing_end_on: string | null };
        assert.equal(end.storage_billing_end_on, null);
      });
    } finally {
      db.close();
    }
  });

  it("records recovery when the charge is deliberately written", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        get(`SELECT id FROM claims WHERE id = 'c8'`);
        const eventsBefore = count(db, `SELECT COUNT(*) AS c FROM claim_events`);
        const decision = syncRecoveryClaimed("c8");
        assert.equal(decision.write, true);
        assert.ok(decision.totalPence > 0);
        const line = db.prepare(
          `SELECT claimed_pence FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'recovery'`,
        ).get() as { claimed_pence: number };
        assert.equal(Number(line.claimed_pence), decision.totalPence);
        assert.equal(count(db, `SELECT COUNT(*) AS c FROM claim_events`), eventsBefore);
        const again = databaseFingerprint(db);
        recoveryClaimForClaim("c8");
        assert.equal(fingerprintChanges(again, databaseFingerprint(db)).length, 0);
      });
    } finally {
      db.close();
    }
  });

  it("keeps the charge pages from writing on render", () => {
    const recovery = readPage("src/app/claims/[id]/heads/recovery/page.tsx");
    const storage = readPage("src/app/claims/[id]/heads/storage/page.tsx");
    const hire = readPage("src/app/claims/[id]/heads/hire/page.tsx");
    assert.equal(recovery.includes("syncRecoveryClaimed"), false);
    assert.equal(recovery.includes("refreshFollowedFigure"), false);
    assert.equal(recovery.includes("No recovery recorded yet"), true);
    assert.equal(recovery.includes("Record recovery"), true);
    assert.equal(storage.includes("syncStorageClaimed"), false);
    assert.equal(storage.includes("refreshFollowedFigure"), false);
    assert.equal(storage.includes("No storage recorded yet"), true);
    assert.equal(storage.includes("Record storage"), true);
    assert.equal(hire.includes("adoptHireClaimedIfNone"), false);
    assert.equal(hire.includes("refreshFollowedFigure"), false);
    assert.equal(hire.includes("No hire recorded yet"), true);
    assert.equal(hire.includes("Record hire"), true);
  });
});

describe("money running uses a real daily rate", () => {
  it("puts TEST-0005's past proposed storage end in the normal tier and never shows £0/day", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        get(`SELECT id FROM claims WHERE id = 'c5'`);
        const running = claimRunningDaily("c5");
        assert.equal(running.open, false);
        assert.equal(running.dailyPence, 0);
        assert.equal(running.storageProposedPast, "2026-10-01");
        assert.equal(runningDailyLabel(running).includes("£0.00"), false);
        assert.equal(runningDailyLabel({ dailyPence: 0 }).includes("£0"), false);

        const desk = getDashboard();
        const five = desk.todaysWork.find((row) => row.fileReference === "TEST-0005");
        assert.ok(five);
        const items = [five.lead, ...five.rest];
        const confirm = items.find((item) => item.id === "storage-confirm-c5");
        assert.ok(confirm);
        assert.equal(confirm.tier, 3);
        assert.equal(confirm.item, "Confirm storage end (proposed 01/10/2026)");
        assert.equal(items.some((item) => item.tier === 2), false);

        const money = desk.todaysWork.flatMap((row) => [row.lead, ...row.rest]).filter((item) => item.tier === 2);
        assert.ok(money.length > 0);
        for (const item of money) {
          assert.ok((item.runningDailyPence || 0) > 0);
          assert.equal(formatGbp(item.runningDailyPence).includes("£0.00"), false);
          assert.equal(item.runningDailyPence, claimRunningDaily(item.claimId).dailyPence);
        }
        const end = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as {
          storage_billing_end_on: string | null;
        };
        assert.equal(end.storage_billing_end_on, null);
      });
    } finally {
      db.close();
    }
  });
});

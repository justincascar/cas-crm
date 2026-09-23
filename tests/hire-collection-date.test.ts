import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  applyHireCollectionActualDate,
  confirmHireEndDate,
  getHireEndDateReviews,
} from "../src/lib/db/hire-collection-date.ts";
import { assignDayJob } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { requireLondonDateTime } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function snapshot(db: DatabaseSync, claimId: string, episodeId: string) {
  const claim = db.prepare(
    `SELECT storage_started_on, storage_billing_end_on, storage_rate_pence, off_hire_scheduled_on, payment_qualifies_off_hire, total_loss
     FROM claims WHERE id = ?`,
  ).get(claimId) as {
    storage_started_on: string | null;
    storage_billing_end_on: string | null;
    storage_rate_pence: number | null;
    off_hire_scheduled_on: string | null;
    payment_qualifies_off_hire: number;
    total_loss: number;
  };
  const episode = db.prepare(
    `SELECT billing_end_at, hire_end_review_on, collection_at, rate_pence_per_day FROM hire_episodes WHERE id = ?`,
  ).get(episodeId) as {
    billing_end_at: string | null;
    hire_end_review_on: string | null;
    collection_at: string | null;
    rate_pence_per_day: number | null;
  } | undefined;
  const lines = db.prepare(`SELECT id, rate_pence, net_pence, vat_pence, gross_pence, claimed_pence FROM financial_lines WHERE claim_id = ? ORDER BY id`).all(claimId);
  return { claim, episode, lines };
}

describe("hire ends on the day the hire car is collected", () => {
  it("uses the collection job date when the booking has no hire end, and leaves rate, storage and off-hire alone", () => {
    const db = prepared();
    const before = withDatabase(db, () => snapshot(db, "c3", "h-c3"));
    withDatabase(db, () => {
      const occurred = requireLondonDateTime("2026-09-18T16:30");
      const result = applyHireCollectionActualDate({
        claimId: "c3",
        hireEpisodeId: "h-c3",
        actualOccurredAt: occurred,
        actorId: "staff-sian",
      });
      assert.equal(result.status, "applied");
      const after = snapshot(db, "c3", "h-c3");
      assert.equal(after.episode?.billing_end_at, "2026-09-18");
      assert.equal(after.episode?.hire_end_review_on, null);
      assert.equal(after.episode?.collection_at, before.episode?.collection_at);
      assert.equal(after.episode?.rate_pence_per_day, before.episode?.rate_pence_per_day);
      assert.deepEqual(after.claim, before.claim);
      assert.deepEqual(after.lines, before.lines);
      assert.equal(getHireEndDateReviews("c3").length, 0);
    });
    db.close();
  });

  it("flags an existing hire end instead of overwriting it, until staff confirm", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE hire_episodes SET billing_end_at = '2026-09-22' WHERE id = 'h-c3'`).run();
      const before = snapshot(db, "c3", "h-c3");
      const occurred = requireLondonDateTime("2026-09-18T16:30");
      const result = applyHireCollectionActualDate({
        claimId: "c3",
        hireEpisodeId: "h-c3",
        actualOccurredAt: occurred,
        actorId: "staff-sian",
      });
      assert.equal(result.status, "review");
      const flagged = snapshot(db, "c3", "h-c3");
      assert.equal(flagged.episode?.billing_end_at, "2026-09-22");
      assert.equal(flagged.episode?.hire_end_review_on, "2026-09-18");
      assert.equal(flagged.episode?.rate_pence_per_day, before.episode?.rate_pence_per_day);
      assert.deepEqual(flagged.claim, before.claim);
      assert.deepEqual(flagged.lines, before.lines);
      const review = getHireEndDateReviews("c3");
      assert.equal(review.length, 1);
      assert.equal(review[0]?.jobDate, "2026-09-18");
      assert.equal(review[0]?.hireEndDay, "2026-09-22");

      confirmHireEndDate({ claimId: "c3", episodeId: "h-c3", choice: "file", actorId: "staff-justin" });
      assert.equal(snapshot(db, "c3", "h-c3").episode?.billing_end_at, "2026-09-22");
      assert.equal(getHireEndDateReviews("c3").length, 0);

      applyHireCollectionActualDate({
        claimId: "c3",
        hireEpisodeId: "h-c3",
        actualOccurredAt: occurred,
        actorId: "staff-sian",
      });
      confirmHireEndDate({ claimId: "c3", episodeId: "h-c3", choice: "job", actorId: "staff-justin" });
      const chosen = snapshot(db, "c3", "h-c3");
      assert.equal(chosen.episode?.billing_end_at, "2026-09-18");
      assert.equal(chosen.episode?.rate_pence_per_day, 8900);
      assert.equal(chosen.claim.off_hire_scheduled_on, before.claim.off_hire_scheduled_on);
      assert.equal(chosen.claim.storage_billing_end_on, before.claim.storage_billing_end_on);
      assert.equal(getHireEndDateReviews("c3").length, 0);
    });
    db.close();
  });

  it("sets the end date from a completed collection job, and a delivery does not", () => {
    const db = prepared();
    withDatabase(db, () => {
      const collected = assignDayJob({
        assigneeId: "staff-justin",
        jobKind: "hire_collection",
        claimId: "c3",
        hireEpisodeId: "h-c3",
        actorId: "staff-justin",
        workDate: "2026-09-18",
        completed: true,
        actualDriverId: "staff-justin",
        actualOccurredAt: "2026-09-18T16:30",
      });
      assert.equal(collected.hireEndReview, false);
      assert.equal(collected.storageDateReview, false);
      assert.equal(collected.storageEndReview, false);
      assert.equal(snapshot(db, "c3", "h-c3").episode?.billing_end_at, "2026-09-18");

      db.prepare(`UPDATE hire_episodes SET billing_end_at = NULL, hire_end_review_on = NULL WHERE id = 'h-c4'`).run();
      assignDayJob({
        assigneeId: "staff-justin",
        jobKind: "hire_delivery",
        claimId: "c4",
        hireEpisodeId: "h-c4",
        actorId: "staff-justin",
        workDate: "2026-09-18",
        completed: true,
        actualDriverId: "staff-justin",
        actualOccurredAt: "2026-09-18T09:00",
      });
      assert.equal(snapshot(db, "c4", "h-c4").episode?.billing_end_at, null);
    });
    db.close();
  });

  it("does not invent a time, a booking, or a total-loss hire end", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.throws(
        () =>
          applyHireCollectionActualDate({
            claimId: "c3",
            hireEpisodeId: "h-c3",
            actualOccurredAt: "",
            actorId: "staff-sian",
          }),
        /Enter the date and time this happened/,
      );
      assert.equal(snapshot(db, "c3", "h-c3").episode?.billing_end_at, null);

      const bare = db.prepare(
        `SELECT id FROM claims c WHERE NOT EXISTS (SELECT 1 FROM hire_episodes he WHERE he.claim_id = c.id) LIMIT 1`,
      ).get() as { id: string };
      const skipped = applyHireCollectionActualDate({
        claimId: bare.id,
        hireEpisodeId: "",
        actualOccurredAt: requireLondonDateTime("2026-09-18T16:30"),
        actorId: "staff-sian",
      });
      assert.equal(skipped.status, "skipped");

      const beforeLoss = snapshot(db, "c10", "h-c10");
      const loss = applyHireCollectionActualDate({
        claimId: "c10",
        hireEpisodeId: "h-c10",
        actualOccurredAt: requireLondonDateTime("2026-09-18T16:30"),
        actorId: "staff-sian",
      });
      assert.equal(loss.status, "skipped");
      const afterLoss = snapshot(db, "c10", "h-c10");
      assert.equal(afterLoss.episode?.billing_end_at, beforeLoss.episode?.billing_end_at);
      assert.equal(afterLoss.episode?.hire_end_review_on, null);
      assert.equal(afterLoss.claim.off_hire_scheduled_on, beforeLoss.claim.off_hire_scheduled_on);
      assert.equal(afterLoss.claim.payment_qualifies_off_hire, beforeLoss.claim.payment_qualifies_off_hire);
      assert.equal(getHireEndDateReviews("c10").length, 0);
    });
    db.close();
  });
});

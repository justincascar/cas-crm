import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { recordTotalLossPaymentReceived } from "../src/lib/db/total-loss.ts";
import { confirmTotalLossOffHire, totalLossOffHireForClaim } from "../src/lib/db/total-loss-off-hire.ts";
import { suggestedHireEndDay, totalLossOffHireDecision } from "../src/lib/domain/total-loss-off-hire.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function event(db: DatabaseSync, id: string, at: string) {
  db.prepare(
    `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
     VALUES (?, 'c9', 'total_loss_payment_received', 'Payment', '', ?, ?, 'staff-justin', 'staff')`,
  ).run(id, at, at);
}

function untouched(db: DatabaseSync) {
  const claim = db
    .prepare(
      `SELECT storage_billing_end_on, storage_started_on, storage_rate_pence, off_hire_scheduled_on, payment_qualifies_off_hire
       FROM claims WHERE id = 'c9'`,
    )
    .get() as Record<string, string | number | null>;
  const money = db
    .prepare(`SELECT claimed_pence, offered_pence FROM financial_lines WHERE id = 'f-c9-vd'`)
    .get() as { claimed_pence: number; offered_pence: number };
  const episode = db
    .prepare(`SELECT rate_pence_per_day FROM hire_episodes WHERE id = 'h-c9'`)
    .get() as { rate_pence_per_day: number };
  return { claim, money, rate: episode.rate_pence_per_day };
}

describe("total-loss hire end suggestion", () => {
  it("suggests seven days after a full payment, and does not suggest a partial payment", () => {
    const payment = "2026-10-01T12:00:00.000Z";
    assert.equal(suggestedHireEndDay(payment), "2026-10-08");
    const partial = totalLossOffHireDecision({
      agreedPence: 1_000_000,
      receivedPence: 400_000,
      paymentAt: payment,
      salvageVariancePence: null,
      salvageMismatch: null,
      existingHireEndDay: null,
      keptSuggestionDay: null,
    });
    assert.equal(partial.kind, "review");
    if (partial.kind === "review") assert.equal("date" in partial, false);
    const full = totalLossOffHireDecision({
      agreedPence: 1_000_000,
      receivedPence: 1_000_000,
      paymentAt: payment,
      salvageVariancePence: null,
      salvageMismatch: null,
      existingHireEndDay: null,
      keptSuggestionDay: null,
    });
    assert.deepEqual(full, { kind: "suggest", date: "2026-10-08" });
  });

  it("confirms the suggestion onto the hire end and leaves storage alone", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = untouched(db);
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 1000000 WHERE id = 'f-c9-vd'`).run();
      event(db, "pay-full", "2026-10-01T12:00:00.000Z");
      const suggestion = totalLossOffHireForClaim("c9");
      assert.equal(suggestion?.kind, "suggest");
      if (suggestion?.kind === "suggest") assert.equal(suggestion.date, "2026-10-08");
      confirmTotalLossOffHire({ claimId: "c9", actorId: "staff-justin", choice: "suggested" });
      const episode = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c9'`).get() as { billing_end_at: string };
      assert.equal(episode.billing_end_at, "2026-10-08");
      assert.deepEqual(untouched(db), before);
      assert.equal(totalLossOffHireForClaim("c4"), null);
    });
  });

  it("adds later payments until the agreed figure is reached, then offers the suggestion", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = untouched(db);
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 0 WHERE id = 'f-c9-vd'`).run();
      recordTotalLossPaymentReceived({ claimId: "c9", actorId: "staff-justin", receivedPence: 400_000 });
      assert.equal(totalLossOffHireForClaim("c9")?.kind, "review");
      const hireEnd = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c9'`).get() as { billing_end_at: string | null };
      assert.equal(hireEnd.billing_end_at, null);
      recordTotalLossPaymentReceived({ claimId: "c9", actorId: "staff-justin", receivedPence: 600_000 });
      const paid = db.prepare(`SELECT received_pence FROM financial_lines WHERE id = 'f-c9-vd'`).get() as { received_pence: number };
      assert.equal(paid.received_pence, 1_000_000);
      assert.equal(totalLossOffHireForClaim("c9")?.kind, "suggest");
      assert.deepEqual(untouched(db).claim, before.claim);
      assert.equal(untouched(db).rate, before.rate);
    });
  });

  it("flags an unresolved salvage dispute, then suggests once that flag has gone", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = untouched(db);
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 1000000 WHERE id = 'f-c9-vd'`).run();
      event(db, "pay-dispute", "2026-10-01T12:00:00.000Z");
      db.prepare(
        `INSERT INTO total_loss_reports(claim_id, pav_pence, salvage_pence, disposal, sale_proceeds_pence, cas_request, insurer_salvage_interest, updated_at, updated_by)
         VALUES ('c9', 1000000, 150000, 'sold', 100000, 'full_pav', 'no_interest', '2026-10-01T12:00:00.000Z', 'staff-justin')`,
      ).run();
      const flagged = totalLossOffHireForClaim("c9");
      assert.equal(flagged?.kind, "review");
      if (flagged?.kind === "review") {
        assert.ok(flagged.reasons.some((reason) => reason.includes("salvage sale")));
        assert.ok(flagged.reasons.some((reason) => reason.includes("differs")));
      }
      db.prepare(
        `UPDATE total_loss_reports SET sale_proceeds_pence = 150000, cas_request = 'net_cas', insurer_salvage_interest = 'no_interest' WHERE claim_id = 'c9'`,
      ).run();
      const cleared = totalLossOffHireForClaim("c9");
      assert.equal(cleared?.kind, "suggest");
      if (cleared?.kind === "suggest") assert.equal(cleared.date, "2026-10-08");
      const hireEnd = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c9'`).get() as { billing_end_at: string | null };
      assert.equal(hireEnd.billing_end_at, null);
      assert.deepEqual(untouched(db), before);
    });
  });

  it("does not overwrite a hire end that is already on the file", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = untouched(db);
      db.prepare(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 1000000 WHERE id = 'f-c9-vd'`).run();
      db.prepare(`UPDATE hire_episodes SET billing_end_at = '2026-09-20' WHERE id = 'h-c9'`).run();
      event(db, "pay-conflict", "2026-10-01T12:00:00.000Z");
      const conflict = totalLossOffHireForClaim("c9");
      assert.equal(conflict?.kind, "conflict");
      if (conflict?.kind === "conflict") {
        assert.equal(conflict.existingDate, "2026-09-20");
        assert.equal(conflict.suggestedDate, "2026-10-08");
      }
      confirmTotalLossOffHire({ claimId: "c9", actorId: "staff-justin", choice: "keep" });
      const kept = db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c9'`).get() as { billing_end_at: string };
      assert.equal(kept.billing_end_at, "2026-09-20");
      assert.equal(totalLossOffHireForClaim("c9")?.kind, "kept");
      assert.deepEqual(untouched(db), before);
    });
  });
});

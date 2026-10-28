import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import {
  confirmRepairableHireEnd,
  recordCarReturnedByHand,
  recordRepairAuthorisedByHand,
  recordRepairMilestoneByHand,
} from "../src/lib/db/claim-step-record.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { applyHireCollectionActualDate } from "../src/lib/db/hire-collection-date.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { getTotalLossReport, saveTotalLossReport } from "../src/lib/db/total-loss.ts";
import { totalLossOffHireForClaim } from "../src/lib/db/total-loss-off-hire.ts";
import { isoDateFromNow, isoDaysFromNow } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

async function blankNonFault() {
  const form = new FormData();
  form.set("client_forename", "Dylan");
  form.set("client_surname", "Endings");
  form.set("client_mobile", "07700900888");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-10));
  form.set("accidentTime", "09:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "roadworthy");
  return createClaimFromIntake(intakeFromFormData(form));
}

function step(claimId: string, key: string) {
  const found = loadClaimSteps(claimId)?.find((item) => item.key === key);
  assert.ok(found, `step ${key} missing`);
  return found;
}

function event(claimId: string, type: string, daysAgo: number, details = "For the test.") {
  const at = isoDaysFromNow(-daysAgo, 10, 0);
  run(
    `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'staff-sian', 'staff')`,
    [`t-${claimId}-${type}-${daysAgo}`, claimId, type, type, details, at, at],
  );
}

const sian = { actorId: "staff-sian", role: "staff" };

describe("repair authorisation and repairs, one click each (J5)", () => {
  it("records authorisation with an optional figure and reduction, then repairs started, complete and car returned in order", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await blankNonFault();
      event(claim.id, "engineer_report_received", 6);
      event(claim.id, "engineer_report_sent_to_insurer", 5, "Sent to the insurer. Marked as sent by Sian Evans.");
      assert.deepEqual(step(claim.id, "repair_authorisation").forms, ["authorisation"]);
      assert.throws(
        () => recordRepairAuthorisedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-4), authorised: "", reduction: "120", reductionNote: "" }),
        /note for the reduction/,
      );
      recordRepairAuthorisedByHand({
        claimId: claim.id,
        ...sian,
        occurredOn: isoDateFromNow(-4),
        authorised: "1850",
        reduction: "120",
        reductionNote: "labour rate reduced",
      });
      const authorised = step(claim.id, "repair_authorisation");
      assert.equal(authorised.state, "done");
      assert.equal(authorised.detail, "Authorised £1,850.00. Reduced by £120.00, labour rate reduced.");
      assert.throws(
        () => recordRepairAuthorisedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-3), authorised: "", reduction: "", reductionNote: "" }),
        /already on the file/,
      );
      const line = get<{ claimed_pence: number | null; agreed_pence: number | null }>(
        `SELECT claimed_pence, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'repairs'`,
        [claim.id],
      );
      assert.ok(!line || (line.agreed_pence ?? 0) === 0, "authorisation must not set an agreed figure");

      assert.deepEqual(step(claim.id, "finish").forms, ["repairs_started"]);
      assert.throws(
        () => recordRepairMilestoneByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-2), milestone: "repairs_complete" }),
        /repairs started first/,
      );
      recordRepairMilestoneByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-3), milestone: "repairs_started" });
      assert.throws(() => recordCarReturnedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-1) }), /repairs complete first/);
      assert.throws(
        () => recordRepairMilestoneByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-4), milestone: "repairs_complete" }),
        /cannot be before repairs started/,
      );
      recordRepairMilestoneByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-1), milestone: "repairs_complete" });
      assert.deepEqual(step(claim.id, "finish").forms, ["car_returned"]);
      recordCarReturnedByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(0) });
      assert.equal(step(claim.id, "finish").state, "done");
    });
    db.close();
  });
});

describe("hire end confirmed by a handler (J5)", () => {
  it("proposes the collection day, and only lets a handler confirm it after repairs are complete and the car is back", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE hire_episodes SET billing_end_at = NULL, hire_end_review_on = NULL WHERE id = 'h-c8'`);
      const collectedAt = isoDaysFromNow(-1, 15, 0);
      const result = applyHireCollectionActualDate({ claimId: "c8", hireEpisodeId: "h-c8", actualOccurredAt: collectedAt, actorId: "staff-megan" });
      assert.equal(result.status, "proposed");
      assert.equal(get<{ billing_end_at: string | null }>(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c8'`)?.billing_end_at, null);
      const day = isoDateFromNow(-1);
      if (!get(`SELECT id FROM claim_events WHERE claim_id = 'c8' AND event_type = 'repairs_complete'`)) {
        assert.throws(() => confirmRepairableHireEnd({ claimId: "c8", ...sian, occurredOn: day }), /repairs are complete/);
        event("c8", "repairs_complete", 3);
      }
      if (!get(`SELECT id FROM claim_events WHERE claim_id = 'c8' AND event_type = 'vehicle_returned'`)) event("c8", "vehicle_returned", 2);
      const finish = step("c8", "finish");
      assert.ok(finish.forms.includes("hire_end"));
      assert.equal(finish.proposals.hire_end?.day, day);
      assert.throws(() => confirmRepairableHireEnd({ claimId: "c8", ...sian, occurredOn: isoDateFromNow(1) }), /future/);
      assert.throws(() => confirmRepairableHireEnd({ claimId: "c8", ...sian, occurredOn: isoDateFromNow(-5) }), /before the car was returned/);
      confirmRepairableHireEnd({ claimId: "c8", ...sian, occurredOn: day });
      assert.equal(get<{ billing_end_at: string | null }>(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c8'`)?.billing_end_at, day);
      const ended = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c8' AND event_type = 'hire_ended' ORDER BY recorded_at DESC LIMIT 1`);
      assert.match(String(ended?.details), /Hire end confirmed by Sian Evans/);
      assert.equal(step("c8", "finish").forms.includes("hire_end"), false);
    });
    db.close();
  });
});

describe("total-loss figures (J5)", () => {
  it("keeps the salvage category, and flags a disputed shortfall for review without adding it to agreed or paid", () => {
    const db = prepared();
    withDatabase(db, () => {
      const base = { claimId: "c9", actorId: "staff-sian", pavPence: 1000000, salvagePence: 150000, interest: null, disposal: null } as const;
      assert.throws(() => saveTotalLossReport({ ...base, disputedShortfallPence: 25000, disputedShortfallNote: "" }), /what the disputed shortfall is about/);
      saveTotalLossReport({ ...base, salvageCategory: "S", disputedShortfallPence: 25000, disputedShortfallNote: "Insurer valued the car below market" });
      const report = getTotalLossReport("c9");
      assert.equal(report.salvageCategory, "S");
      assert.equal(report.disputedShortfallPence, 25000);
      run(`UPDATE financial_lines SET agreed_pence = 850000, received_pence = 850000 WHERE id = 'f-c9-vd'`);
      event("c9", "total_loss_payment_received", 2);
      const offHire = totalLossOffHireForClaim("c9");
      assert.equal(offHire?.kind, "review");
      if (offHire?.kind === "review") assert.ok(offHire.reasons.some((reason) => /shortfall is disputed/.test(reason)));
      const vd = get<{ agreed_pence: number; received_pence: number }>(`SELECT agreed_pence, received_pence FROM financial_lines WHERE id = 'f-c9-vd'`);
      assert.equal(vd?.agreed_pence, 850000);
      assert.equal(vd?.received_pence, 850000);
      saveTotalLossReport({ ...base, disputedShortfallPence: null, disputedShortfallNote: null });
      const cleared = totalLossOffHireForClaim("c9");
      assert.notEqual(cleared?.kind, "review");
    });
    db.close();
  });

  it("keeps the repair history when a repairable file becomes a total loss", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await blankNonFault();
      event(claim.id, "repairs_authorised", 5);
      recordRepairMilestoneByHand({ claimId: claim.id, ...sian, occurredOn: isoDateFromNow(-4), milestone: "repairs_started" });
      saveScreenData(claim.id, "assessed-damage", { totalLoss: "yes" }, "staff-sian");
      assert.equal(Number(get<{ total_loss: number }>(`SELECT total_loss FROM claims WHERE id = ?`, [claim.id])?.total_loss), 1);
      assert.ok(get(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'repairs_started'`, [claim.id]));
      const finish = step(claim.id, "finish");
      assert.ok(finish.historyLines.some((item) => item.label === "Repairs started"));
    });
    db.close();
  });
});

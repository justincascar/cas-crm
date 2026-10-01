import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  ENGINEER_REPORT_CHASE_DUE_LABEL,
  HIRE_AGREEMENT_RENEWAL_DUE_LABEL,
  HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL,
  LIABILITY_RESPONSE_CHASE_DUE_LABEL,
  REPAIR_AUTHORISATION_CHASE_DUE_LABEL,
} from "../src/lib/constants.ts";
import { isoDaysFromNow } from "../src/lib/dates.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { listDueChases } from "../src/lib/db/chase.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { outstandingForClaim } from "../src/lib/db/outstanding.ts";
import { getClaim, updateClaimPosition } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  INSTRUCT_ENGINEER_LABEL,
  NOTHING_OUTSTANDING,
  REQUEST_REPAIR_AUTHORISATION_LABEL,
  SEND_LIABILITY_LABEL,
  awaitedEngineerReport,
  awaitedLiabilityResponse,
  awaitedRepairAuthorisation,
  buildOutstanding,
} from "../src/lib/domain/outstanding.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function labels(claimId: string): string[] {
  return outstandingForClaim(claimId).map((item) => item.label);
}

describe("outstanding on a claim", () => {
  it("uses the same awaited-queue tests as the dashboard cards", () => {
    const queries = fs.readFileSync(path.join(process.cwd(), "src/lib/db/queries.ts"), "utf8");
    assert.equal(awaitedLiabilityResponse("pending"), true);
    assert.equal(awaitedLiabilityResponse("admitted"), false);
    assert.equal(awaitedEngineerReport("instructed"), true);
    assert.equal(awaitedEngineerReport("awaiting_report"), true);
    assert.equal(awaitedEngineerReport("not_instructed"), false);
    assert.equal(awaitedRepairAuthorisation("awaiting_auth"), true);
    assert.equal(awaitedRepairAuthorisation("not_applicable"), false);
    assert.match(queries, /insurer_liability_position = 'pending'/);
    assert.match(queries, /engineering_status IN \('instructed', 'awaiting_report'\)/);
    assert.match(queries, /repair_status = 'awaiting_auth'/);
  });

  it("lists an overdue task on its own, and leaves a future task off", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET engineering_status = 'report_received', repair_status = 'not_applicable' WHERE id = 'c4'`).run();
      db.prepare(`UPDATE tasks SET due_at = ? WHERE id = 't4'`).run(isoDaysFromNow(-2, 9, 0));
      assert.deepEqual(labels("c4"), ["Overdue task: Confirm courtesy return date"]);
    });
  });

  it("includes a due chase for liability, the engineer, repair authorisation and hire renewal", () => {
    const db = prepared();
    withDatabase(db, () => {
      const five = labels("c5");
      const six = labels("c6");
      const eleven = labels("c11");
      assert.ok(five.includes(LIABILITY_RESPONSE_CHASE_DUE_LABEL));
      assert.ok(five.includes(ENGINEER_REPORT_CHASE_DUE_LABEL));
      assert.ok(six.includes(REPAIR_AUTHORISATION_CHASE_DUE_LABEL));
      assert.ok(
        eleven.includes(HIRE_AGREEMENT_RENEWAL_DUE_LABEL) || eleven.includes(HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL),
      );
      const listed = listDueChases()
        .filter((chase) => chase.claimId === "c5")
        .map((chase) => chase.label || chase.dueLabel);
      const onFile = five.filter((label) => listed.includes(label));
      assert.deepEqual(onFile, listed);
    });
  });

  it("shows a first step that has not been marked sent, and leaves it off where that step does not apply", () => {
    const db = prepared();
    withDatabase(db, () => {
      const roadworthy = labels("c2");
      const fault = labels("c4");
      const totalLoss = labels("c9");
      assert.ok(roadworthy.includes(SEND_LIABILITY_LABEL));
      assert.equal(roadworthy.includes(INSTRUCT_ENGINEER_LABEL), false);
      assert.ok(roadworthy.includes(REQUEST_REPAIR_AUTHORISATION_LABEL));
      assert.equal(fault.includes(SEND_LIABILITY_LABEL), false);
      assert.ok(fault.includes(INSTRUCT_ENGINEER_LABEL));
      assert.ok(fault.includes(REQUEST_REPAIR_AUTHORISATION_LABEL));
      assert.equal(totalLoss.includes(REQUEST_REPAIR_AUTHORISATION_LABEL), false);
      assert.equal(totalLoss.includes(INSTRUCT_ENGINEER_LABEL), false);
      assert.equal(totalLoss.includes(SEND_LIABILITY_LABEL), false);
    });
  });

  it("says nothing is outstanding when no task or chase needs a person", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET engineering_status = 'report_received', repair_status = 'not_applicable' WHERE id = 'c4'`).run();
      db.prepare(`UPDATE tasks SET due_at = ? WHERE id = 't4'`).run(isoDaysFromNow(4, 9, 0));
      assert.deepEqual(labels("c4"), []);
      const page = fs.readFileSync(path.join(process.cwd(), "src/components/claims/OutstandingSummary.tsx"), "utf8");
      assert.match(page, /NOTHING_OUTSTANDING/);
      assert.equal(NOTHING_OUTSTANDING, "Nothing outstanding right now.");
    });
  });

  it("shows every current item, overdue task first, then due chases in the claims-list order", () => {
    const db = prepared();
    withDatabase(db, () => {
      const items = outstandingForClaim("c5");
      assert.equal(items[0]?.label, "Overdue task: Engineer report overdue chase");
      const chaseLabels = items.filter((item) => item.band.startsWith("chase_")).map((item) => item.label);
      assert.deepEqual(chaseLabels, [LIABILITY_RESPONSE_CHASE_DUE_LABEL, ENGINEER_REPORT_CHASE_DUE_LABEL]);
      assert.equal(items.some((item) => item.band === "plain"), false);
    });
  });

  it("keeps the handler's typed note separate from the outstanding list", () => {
    const db = prepared();
    withDatabase(db, () => {
      updateClaimPosition("c4", { next_action: "Handler typed this note only" });
      assert.equal(labels("c4").includes("Handler typed this note only"), false);
      const saved = getClaim("c4");
      assert.equal(saved?.claim.next_action, "Handler typed this note only");
      const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
      assert.match(page, /name="next_action"/);
      assert.match(page, /OutstandingSummary/);
      const plain = buildOutstanding({
        tasks: [],
        chases: [],
        eventTypes: [],
        insurerLiabilityPosition: "admitted",
        engineeringStatus: "report_received",
        repairStatus: "in_progress",
        totalLoss: false,
      });
      assert.deepEqual(plain, []);
    });
  });
});

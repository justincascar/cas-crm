import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  HIRE_AGREEMENT_RENEWAL_DUE_LABEL,
  HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL,
} from "../src/lib/constants.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import {
  chaseForClaim,
  ensureChaseSettings,
  ensureDemoChases,
  listDueChases,
  startChase,
} from "../src/lib/db/chase.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { listHireAgreements, logChaseOutcome } from "../src/lib/db/chronology.ts";
import { ensureEngineers } from "../src/lib/db/engineers.ts";
import { getDashboard } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  HIRE_AGREEMENT_ENDED_REASON,
  HIRE_AGREEMENT_START_MISSING_REASON,
  hireAgreementRenewalDecision,
} from "../src/lib/domain/chase.ts";

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

const dueBase = {
  applies: true,
  hireEnded: false,
  handlerState: "tracking" as const,
  dueLabel: HIRE_AGREEMENT_RENEWAL_DUE_LABEL,
  overdueLabel: HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL,
  alertDay: 80,
  maxDays: 88,
};

describe("hire agreement renewal clock", () => {
  it("is not due just under day 80, and is due at and over day 80", () => {
    const startOn = "2026-06-27";
    const justUnder = hireAgreementRenewalDecision({ ...dueBase, startOn, asAt: "2026-09-13T12:00:00.000Z" });
    const atThreshold = hireAgreementRenewalDecision({ ...dueBase, startOn, asAt: "2026-09-14T12:00:00.000Z" });
    const over = hireAgreementRenewalDecision({ ...dueBase, startOn, asAt: "2026-09-15T12:00:00.000Z" });
    assert.equal(justUnder.due, false);
    assert.equal(justUnder.daysOutstanding, 79);
    assert.equal(atThreshold.due, true);
    assert.equal(atThreshold.label, HIRE_AGREEMENT_RENEWAL_DUE_LABEL);
    assert.equal(atThreshold.daysOutstanding, 80);
    assert.equal(over.due, true);
    assert.equal(over.label, HIRE_AGREEMENT_RENEWAL_DUE_LABEL);
  });

  it("escalates at and over day 88 when no renewal has been logged", () => {
    const startOn = "2026-06-19";
    const atLimit = hireAgreementRenewalDecision({ ...dueBase, startOn, asAt: "2026-09-14T12:00:00.000Z" });
    const overLimit = hireAgreementRenewalDecision({ ...dueBase, startOn, asAt: "2026-09-15T12:00:00.000Z" });
    assert.equal(atLimit.due, true);
    assert.equal(atLimit.label, HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL);
    assert.equal(overLimit.due, true);
    assert.equal(overLimit.label, HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL);
    assert.match(String(overLimit.reason), /clears only when a renewal is logged/i);
  });

  it("does not guess a start date, and never alerts after the hire has ended", () => {
    const missing = hireAgreementRenewalDecision({
      ...dueBase,
      startOn: null,
      asAt: "2026-09-21T12:00:00.000Z",
    });
    const ended = hireAgreementRenewalDecision({
      ...dueBase,
      hireEnded: true,
      startOn: "2026-06-01",
      asAt: "2026-09-21T12:00:00.000Z",
    });
    assert.equal(missing.due, false);
    assert.equal(missing.reason, HIRE_AGREEMENT_START_MISSING_REASON);
    assert.equal(ended.due, false);
    assert.equal(ended.reason, HIRE_AGREEMENT_ENDED_REASON);
  });
});

describe("hire agreement renewal on TEST files", () => {
  it("escalates TEST hire files at day 88 when no renewal is logged", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE agreements SET start_on = ? WHERE id = 'ag-c3'`).run(isoDateFromNow(-87));
      const atLimit = chaseForClaim("hire_agreement_renewal", "c3");
      assert.equal(atLimit?.due, true);
      assert.equal(atLimit?.label, HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL);
      db.prepare(`UPDATE agreements SET start_on = ? WHERE id = 'ag-c3'`).run(isoDateFromNow(-90));
      const overLimit = chaseForClaim("hire_agreement_renewal", "c3");
      assert.equal(overLimit?.due, true);
      assert.equal(overLimit?.label, HIRE_AGREEMENT_RENEWAL_OVERDUE_LABEL);
    });
    db.close();
  });

  it("shows TEST-0011 as hire agreement renewal due on the dashboard and claim", () => {
    const db = seeded();
    withDatabase(db, () => {
      const view = chaseForClaim("hire_agreement_renewal", "c11");
      assert.equal(view?.due, true);
      assert.equal(view?.label, HIRE_AGREEMENT_RENEWAL_DUE_LABEL);
      const due = listDueChases().filter((row) => row.kind === "hire_agreement_renewal");
      assert.ok(due.some((row) => row.claimId === "c11"));
      const dashboard = getDashboard();
      const eleven = dashboard.claims.find((row) => row.file_reference === "TEST-0011");
      assert.match(String(eleven?.next_action), /Hire agreement renewal due/);
      assert.ok(dashboard.chasesDueByKind.hire_agreement_renewal.some((row) => row.claimId === "c11"));
      assert.equal(chaseForClaim("hire_agreement_renewal", "c4"), null);
    });
    db.close();
  });

  it("logs a renewal without overwriting earlier agreements, including two renewals in sequence", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE agreements SET start_on = ? WHERE id = 'ag-c3'`).run(isoDateFromNow(-80));
      assert.equal(chaseForClaim("hire_agreement_renewal", "c3")?.due, true);
      const before = listHireAgreements("c3");
      assert.equal(before.length, 1);
      logChaseOutcome({ claimId: "c3", actorId: "staff-tom", kind: "hire_agreement_renewal" });
      const afterFirst = listHireAgreements("c3");
      assert.equal(afterFirst.length, 2);
      assert.equal(afterFirst[0].id, "ag-c3");
      assert.equal(Number(afterFirst[0].signed), 1);
      assert.equal(Number(afterFirst[1].signed), 1);
      assert.equal(chaseForClaim("hire_agreement_renewal", "c3")?.due, false);
      logChaseOutcome({
        claimId: "c3",
        actorId: "staff-tom",
        kind: "hire_agreement_renewal",
        occurredAt: isoDateFromNow(0),
      });
      const afterSecond = listHireAgreements("c3");
      assert.equal(afterSecond.length, 3);
      assert.deepEqual(
        afterSecond.map((row) => Number(row.sequence)),
        [1, 2, 3],
      );
      assert.ok(afterSecond.every((row) => Number(row.signed) === 1));
      assert.equal(chaseForClaim("hire_agreement_renewal", "c3")?.due, false);
    });
    db.close();
  });

  it("never alerts on an ended hire, even when the dates would be past day 80", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`UPDATE agreements SET start_on = ? WHERE id = 'ag-c3'`).run(isoDateFromNow(-90));
      db.prepare(`UPDATE hire_episodes SET collection_at = ? WHERE id = 'h-c3'`).run(isoDateFromNow(-10));
      const view = chaseForClaim("hire_agreement_renewal", "c3");
      assert.equal(view?.due, false);
      assert.match(String(view?.reason), /hire has ended/i);
      const due = listDueChases().filter((row) => row.kind === "hire_agreement_renewal" && row.claimId === "c3");
      assert.equal(due.length, 0);
    });
    db.close();
  });

  it("flags a missing agreement start instead of using the reservation dates, and stays due after day 80 until a renewal is logged", () => {
    const db = seeded();
    withDatabase(db, () => {
      const missing = chaseForClaim("hire_agreement_renewal", "c7");
      assert.equal(missing?.due, false);
      assert.match(String(missing?.reason), /will not guess/i);
      db.prepare(`UPDATE agreements SET start_on = ? WHERE id = 'ag-c3'`).run(isoDateFromNow(-81));
      assert.equal(chaseForClaim("hire_agreement_renewal", "c3")?.due, true);
      const stillDue = chaseForClaim("hire_agreement_renewal", "c3");
      assert.equal(stillDue?.due, true);
      startChase("hire_agreement_renewal", "c3", isoDateFromNow(-81));
      assert.equal(chaseForClaim("hire_agreement_renewal", "c3")?.due, true);
    });
    db.close();
  });
});

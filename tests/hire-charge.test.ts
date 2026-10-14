import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { withDatabase, get, run } from "../src/lib/db/connection.ts";
import { letterPreview } from "../src/lib/db/chronology.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { applyHireCollectionActualDate } from "../src/lib/db/hire-collection-date.ts";
import { adoptHireClaimedIfNone, hireChargeForClaim, storedHireMoney } from "../src/lib/db/hire-charge.ts";
import { confirmTotalLossOffHire } from "../src/lib/db/total-loss-off-hire.ts";
import {
  FAULT_COURTESY_NOT_CREDIT_HIRE,
  HIRE_NOT_STARTED,
  STORED_HIRE_DIFFERS,
  hireCharge,
} from "../src/lib/domain/hire-charge.ts";
import { HIRE_PAYMENT_REQUEST_BLOCK } from "../src/lib/domain/payment-chase.ts";
import { inclusiveHireDays } from "../src/lib/domain/rules.ts";
import { formatGbp } from "../src/lib/money.ts";
import { isoDaysFromNow, londonDateIso } from "../src/lib/dates.ts";
import { ukDayLabel } from "../src/lib/domain/storage-charge.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const base = {
  handoverDay: "2026-09-22",
  confirmedEndDay: "2026-10-01",
  today: "2026-10-14",
  creditHire: true,
  agreements: [{ sequence: 1, startDay: "2026-09-22", signed: true, ratePence: 10000 }],
};

describe("hire charge from inclusive days", () => {
  it("counts a single agreement from the handover through the end, including both days", () => {
    assert.equal(inclusiveHireDays("2026-09-22", "2026-10-01"), 10);
    const charge = hireCharge(base);
    assert.equal(charge.status, "calculated");
    if (charge.status !== "calculated") return;
    assert.equal(charge.days, 10);
    assert.equal(charge.provisional, false);
    assert.equal(charge.label, null);
    assert.equal(charge.lines.length, 1);
    assert.equal(charge.netPence, 100000);
    assert.equal(charge.vatPence, 20000);
    assert.equal(charge.totalPence, 120000);
  });

  it("does not count the renewal day twice when the rate stays the same", () => {
    const charge = hireCharge({
      ...base,
      agreements: [
        { sequence: 1, startDay: "2026-09-22", signed: true, ratePence: 10000 },
        { sequence: 2, startDay: "2026-09-27", signed: true, ratePence: 10000 },
      ],
    });
    assert.equal(charge.status, "calculated");
    if (charge.status !== "calculated") return;
    assert.equal(charge.days, 10);
    assert.equal(charge.lines.reduce((sum, line) => sum + line.days, 0), 10);
    assert.equal(charge.lines[0].days, 5);
    assert.equal(charge.lines[1].days, 5);
    assert.equal(charge.netPence, 100000);
  });

  it("splits a renewal that records a different rate and the day it started", () => {
    const charge = hireCharge({
      ...base,
      agreements: [
        { sequence: 1, startDay: "2026-09-22", signed: true, ratePence: 10000 },
        { sequence: 2, startDay: "2026-09-27", signed: true, ratePence: 20000 },
      ],
    });
    assert.equal(charge.status, "calculated");
    if (charge.status !== "calculated") return;
    assert.equal(charge.lines[0].netPence, 50000);
    assert.equal(charge.lines[1].netPence, 100000);
    assert.equal(charge.days, 10);
    assert.equal(charge.netPence, 150000);
    assert.equal(charge.vatPence, 30000);
  });

  it("does not invent a split when the renewal does not record its rate", () => {
    const charge = hireCharge({
      ...base,
      agreements: [
        { sequence: 1, startDay: "2026-09-22", signed: true, ratePence: 10000 },
        { sequence: 2, startDay: "2026-09-27", signed: true, ratePence: null },
      ],
    });
    assert.equal(charge.status, "calculated");
    if (charge.status !== "calculated") return;
    assert.equal(charge.lines.length, 1);
    assert.equal(charge.days, 10);
    assert.match(charge.notes.join(" "), /does not record its own daily rate/);
  });

  it("does not add a day for a vehicle swap, and keeps the agreement rate", () => {
    const charge = hireCharge({ ...base, swapDays: ["2026-09-25"] });
    assert.equal(charge.status, "calculated");
    if (charge.status !== "calculated") return;
    assert.equal(charge.days, 10);
    assert.deepEqual(charge.swapDays, ["2026-09-25"]);
    assert.equal(charge.lines[0].ratePence, 10000);
  });

  it("labels a proposed end as provisional and a confirmed end as final", () => {
    const proposed = hireCharge({ ...base, confirmedEndDay: null, proposedEndDay: "2026-10-01" });
    assert.equal(proposed.status, "calculated");
    if (proposed.status !== "calculated") return;
    assert.equal(proposed.provisional, true);
    assert.equal(proposed.label, "Provisional, to proposed end 01/10/2026, awaiting confirmation");
    assert.equal(proposed.days, 10);
    const open = hireCharge({ ...base, confirmedEndDay: null, proposedEndDay: null, today: "2026-09-22" });
    assert.equal(open.status, "calculated");
    if (open.status !== "calculated") return;
    assert.equal(open.label, "Provisional to today");
    assert.equal(open.days, 1);
  });

  it("gives no figure when the replacement has not been handed over", () => {
    const charge = hireCharge({ ...base, handoverDay: null });
    assert.equal(charge.status, "not_started");
    assert.equal(HIRE_NOT_STARTED, "Hire not started");
  });

  it("does not price fault courtesy as credit hire", () => {
    const charge = hireCharge({ ...base, creditHire: false });
    assert.equal(charge.status, "courtesy");
    assert.match(FAULT_COURTESY_NOT_CREDIT_HIRE, /not credit hire/);
  });

  it("includes extras only when a signed agreement records a rate", () => {
    const blank = hireCharge({ ...base, extrasOnSignedAgreement: true, cdwPence: 0, additionalDriverPence: null, deliveryCollectionPence: 0 });
    assert.equal(blank.status, "calculated");
    if (blank.status === "calculated") assert.equal(blank.extras.length, 0);
    const withExtras = hireCharge({
      ...base,
      extrasOnSignedAgreement: true,
      cdwPence: 1500,
      additionalDriverPence: 2000,
      deliveryCollectionPence: 20000,
    });
    assert.equal(withExtras.status, "calculated");
    if (withExtras.status !== "calculated") return;
    assert.equal(withExtras.extras.map((extra) => extra.key).join(","), "cdw,additional_driver,delivery_collection");
    assert.equal(withExtras.netPence, 155000);
    assert.equal(withExtras.vatPence, 31000);
    assert.equal(withExtras.totalPence, 186000);
    const unsigned = hireCharge({ ...base, extrasOnSignedAgreement: false, cdwPence: 1500 });
    assert.equal(unsigned.status, "calculated");
    if (unsigned.status === "calculated") assert.equal(unsigned.extras.length, 0);
  });
});

describe("hire charge on a file", () => {
  it("flags a stored hire figure that differs and does not overwrite it", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = storedHireMoney("c8");
      assert.ok(before.claimedPence > 0);
      const agreed = before.agreedPence;
      const received = before.receivedPence;
      run(
        `INSERT INTO vehicle_handovers(
          id, claim_id, hire_episode_id, event_kind, occurred_at, recorded_by, mileage, fuel_level,
          spare_wheel, tools_present, warning_lights_off, tyres_legal, condition_note, created_at
        ) VALUES ('vh-test-c3', 'c3', 'h-c3', 'hire_delivered', '2026-09-22T10:00:00.000Z', 'staff-tom', 1, 'half', 'yes', 'yes', 'yes', 'yes', 'Handed over', '2026-09-22T10:00:00.000Z')`,
      );
      const view = hireChargeForClaim("c3", "2026-10-14");
      assert.equal(view.differs, true);
      assert.equal(adoptHireClaimedIfNone("c3", "2026-10-14"), false);
      const after = storedHireMoney("c3");
      assert.equal(after.claimedPence, 53400);
      assert.equal(storedHireMoney("c8").claimedPence, before.claimedPence);
      assert.equal(storedHireMoney("c8").agreedPence, agreed);
      assert.equal(storedHireMoney("c8").receivedPence, received);
      assert.equal(storedHireMoney("c6").claimedPence, 0);
      assert.equal(STORED_HIRE_DIFFERS, "Stored figure differs from calculation, review");
    });
  });

  it("adopts the calculation only when the file has no stored hire claimed figure", () => {
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE financial_lines SET claimed_pence = 0 WHERE claim_id = 'c8' AND head_of_loss = 'hire'`);
      const agreedBefore = storedHireMoney("c8").agreedPence;
      assert.equal(adoptHireClaimedIfNone("c8", "2026-10-14"), true);
      const after = storedHireMoney("c8");
      const view = hireChargeForClaim("c8", "2026-10-14");
      assert.equal(view.charge.status, "calculated");
      if (view.charge.status === "calculated") assert.equal(after.claimedPence, view.charge.totalPence);
      assert.equal(after.agreedPence, agreedBefore);
      assert.equal(after.receivedPence, 0);
      assert.equal(view.differs, false);
    });
  });

  it("keeps a repairable proposed end provisional until the collection job confirms it", () => {
    const db = prepared();
    withDatabase(db, () => {
      const handover = get<{ occurred_at: string }>(
        `SELECT occurred_at FROM vehicle_handovers WHERE claim_id = 'c8' AND event_kind = 'hire_delivered' ORDER BY occurred_at LIMIT 1`,
      );
      assert.ok(handover);
      const proposedDay = londonDateIso(new Date(isoDaysFromNow(-3, 12, 0)));
      run(`UPDATE hire_episodes SET hire_end_proposed_on = ?, billing_end_at = NULL WHERE id = 'h-c8'`, [proposedDay]);
      const proposed = hireChargeForClaim("c8");
      assert.equal(proposed.charge.status, "calculated");
      if (proposed.charge.status === "calculated") {
        assert.equal(proposed.charge.provisional, true);
        assert.equal(proposed.charge.label, `Provisional, to proposed end ${ukDayLabel(proposedDay)}, awaiting confirmation`);
      }
      const collectedAt = isoDaysFromNow(-1, 15, 0);
      applyHireCollectionActualDate({
        claimId: "c8",
        hireEpisodeId: "h-c8",
        actualOccurredAt: collectedAt,
        actorId: "staff-megan",
      });
      const confirmed = hireChargeForClaim("c8");
      assert.equal(confirmed.confirmedEndDay, londonDateIso(new Date(collectedAt)));
      assert.equal(confirmed.charge.status, "calculated");
      if (confirmed.charge.status === "calculated") assert.equal(confirmed.charge.provisional, false);
    });
  });

  it("does not treat a total-loss suggestion as final until a handler confirms it", () => {
    const db = prepared();
    withDatabase(db, () => {
      const hireBefore = storedHireMoney("c9");
      run(
        `INSERT INTO vehicle_handovers(
          id, claim_id, hire_episode_id, event_kind, occurred_at, recorded_by, mileage, fuel_level,
          spare_wheel, tools_present, warning_lights_off, tyres_legal, condition_note, created_at
        ) VALUES ('vh-c9-out', 'c9', 'h-c9', 'hire_delivered', '2026-09-22T10:00:00.000Z', 'staff-megan', 1, 'half', 'yes', 'yes', 'yes', 'yes', 'Handed over', '2026-09-22T10:00:00.000Z')`,
      );
      run(`UPDATE agreements SET rate_pence_per_day = 12500 WHERE id = 'ag-c11a'`);
      run(
        `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note, rate_pence_per_day)
         VALUES ('ag-c9', 'h-c9', 1, '2026-09-22', '2026-12-19', 88, 80, 1, '2026-09-22T10:00:00.000Z', 'signed', 'Signed for the test.', 12500)`,
      );
      run(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 1000000 WHERE id = 'f-c9-vd'`);
      run(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES ('pay-c9-hire', 'c9', 'total_loss_payment_received', 'Payment', '', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', 'staff-justin', 'staff')`,
      );
      const proposed = hireChargeForClaim("c9", "2026-10-14");
      assert.equal(proposed.confirmedEndDay, null);
      assert.equal(proposed.proposedEndDay, "2026-10-08");
      assert.equal(proposed.charge.status, "calculated");
      if (proposed.charge.status === "calculated") assert.equal(proposed.charge.provisional, true);
      assert.equal(storedHireMoney("c9").claimedPence, hireBefore.claimedPence);
      assert.equal(storedHireMoney("c9").offeredPence, hireBefore.offeredPence);
      confirmTotalLossOffHire({ claimId: "c9", actorId: "staff-justin", choice: "suggested" });
      const confirmed = hireChargeForClaim("c9", "2026-10-14");
      assert.equal(confirmed.confirmedEndDay, "2026-10-08");
      assert.equal(confirmed.charge.status, "calculated");
      if (confirmed.charge.status === "calculated") assert.equal(confirmed.charge.provisional, false);
      assert.equal(storedHireMoney("c9").offeredPence, hireBefore.offeredPence);
    });
  });

  it("keeps a confirmed collection end when a repairable file is later marked a total loss", () => {
    const db = prepared();
    withDatabase(db, () => {
      const collectedAt = isoDaysFromNow(-1, 11, 0);
      applyHireCollectionActualDate({
        claimId: "c8",
        hireEpisodeId: "h-c8",
        actualOccurredAt: collectedAt,
        actorId: "staff-megan",
      });
      const before = get<{ billing_end_at: string | null; rate_pence_per_day: number | null }>(
        `SELECT billing_end_at, rate_pence_per_day FROM hire_episodes WHERE id = 'h-c8'`,
      );
      saveScreenData("c8", "assessed-damage", { totalLoss: "yes" }, "staff-megan");
      const after = get<{ billing_end_at: string | null; rate_pence_per_day: number | null; total_loss: number }>(
        `SELECT he.billing_end_at, he.rate_pence_per_day, c.total_loss
         FROM hire_episodes he JOIN claims c ON c.id = he.claim_id WHERE he.id = 'h-c8'`,
      );
      assert.equal(Number(after?.total_loss), 1);
      assert.equal(after?.billing_end_at, before?.billing_end_at);
      assert.equal(after?.rate_pence_per_day, before?.rate_pence_per_day);
      const charge = hireChargeForClaim("c8", "2026-10-14");
      assert.equal(charge.confirmedEndDay, londonDateIso(new Date(collectedAt)));
      assert.equal(charge.charge.status, "calculated");
      if (charge.charge.status === "calculated") assert.equal(charge.charge.provisional, false);
    });
  });

  it("does not let a typed collection date become the chargeable hire end", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = get<{ billing_end_at: string | null }>(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c3'`);
      saveScreenData(
        "c3",
        "delivery-collection",
        { hireEndDate: "2026-10-03", collectionDate: "2026-10-03" },
        "staff-tom",
      );
      const after = get<{ billing_end_at: string | null }>(`SELECT billing_end_at FROM hire_episodes WHERE id = 'h-c3'`);
      assert.equal(after?.billing_end_at ?? null, before?.billing_end_at ?? null);
    });
  });

  it("leaves an unconfirmed hire total out of a letter, and still shows the daily rate", () => {
    const db = prepared();
    withDatabase(db, () => {
      const letter = letterPreview("c8", "hire_pack_cover");
      assert.match(letter.text, /Hire continuing/);
      assert.match(letter.text, /Unknown/);
      assert.equal(letter.text.includes(formatGbp(storedHireMoney("c8").claimedPence)), false);
      assert.ok(letter.missing.includes("Total hire charge"));
      assert.match(HIRE_PAYMENT_REQUEST_BLOCK, /unconfirmed hire figure/);
      const view = hireChargeForClaim("c8");
      assert.equal(view.charge.status, "calculated");
      if (view.charge.status === "calculated") {
        assert.equal(view.charge.provisional, true);
        assert.equal(letter.text.includes(formatGbp(view.charge.totalPence)), false);
        assert.match(letter.text, new RegExp(formatGbp(view.continuingRatePence || 0).replace("£", "£")));
      }
    });
  });
});

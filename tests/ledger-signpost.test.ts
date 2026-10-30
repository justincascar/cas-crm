import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { getClaimScreen } from "../src/lib/claim-screens.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { listOpenPaymentReviews } from "../src/lib/db/payment-review.ts";
import { getScreenData, saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { applicableVehicleHead, headScreenPath } from "../src/lib/domain/head-screen.ts";

const LOSS_OF_USE_FIELDS: Array<{ name: string; label: string }> = [
  { name: "mitStatReturned", label: "MIT / statement of truth returned" },
  { name: "firstNotificationTpi", label: "1st notification to TPI" },
  { name: "solicitorInstructed", label: "Date solicitor instructed" },
  { name: "engineerInstructed", label: "Engineer instructed" },
  { name: "engineerInvoicePaid", label: "Engineer invoice paid" },
  { name: "repairAuthorised", label: "Repair authorised" },
  { name: "repairerInstructed", label: "Repairer instructed" },
  { name: "repairStart", label: "Repair start date" },
  { name: "repairerInvoicePaid", label: "Repairer invoice paid" },
  { name: "abiHirePackTpi", label: "ABI hire pack to TPI" },
  { name: "nonAbiHirePackTpi", label: "Non-ABI hire pack to TPI" },
  { name: "hirePaidInFull", label: "Hire paid in full" },
  { name: "hirerInstructed", label: "Hirer instructed" },
  { name: "hireOut", label: "Hire out" },
  { name: "hireBack", label: "Hire back" },
  { name: "currentHireStatus", label: "Current hire status" },
  { name: "caseStatus", label: "Case status" },
  { name: "daysBeforeTpiPayment", label: "No of days before TPI payment" },
];

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function moneySnapshot(db: DatabaseSync, claimId: string) {
  return {
    lines: db
      .prepare(
        `SELECT id, head_of_loss, claimed_pence, offered_pence, agreed_pence, received_pence, agreed_on
         FROM financial_lines WHERE claim_id = ? ORDER BY id`,
      )
      .all(claimId),
    events: db
      .prepare(`SELECT id, event_type, occurred_at, details FROM claim_events WHERE claim_id = ? ORDER BY id`)
      .all(claimId),
    automations: db
      .prepare(`SELECT id, rule_key, status, paused, reason FROM automations WHERE claim_id = ? ORDER BY id`)
      .all(claimId),
    claim: db.prepare(`SELECT total_loss, later_declared_total_loss FROM claims WHERE id = ?`).get(claimId),
  };
}

describe("ledger signposts", () => {
  it("labels assessed damage notes and the live total-loss panel, and points financial summary at the ledgers", () => {
    const form = read("src/components/claim-file/ScreenForm.tsx");
    const page = read("src/app/claims/[id]/work/[screen]/page.tsx");
    const nav = read("src/components/claim-file/ScreenNav.tsx");
    const assessed = getClaimScreen("assessed-damage");
    assert.equal(assessed?.sections[0]?.title, "Engineer's notes");
    assert.match(assessed?.hint || "", /do not update claimed, offered, agreed or received/);
    assert.match(form, /These figures are saved as notes only — they do not update claimed, offered, agreed or received/);
    assert.match(form, /Nothing entered here updates the live ledgers or feeds automatic chasing/);
    assert.match(form, /headScreenPath\(claimId, "repairs"\)/);
    assert.match(form, /headScreenPath\(claimId, "hire"\)/);
    assert.match(form, /headScreenPath\(claimId, "recovery"\)/);
    assert.match(form, /Open the vehicle damage ledger/);
    assert.match(page, /This section updates the vehicle damage ledger/);
    assert.match(page, /screen === "assessed-damage" && Number\(data\.claim\.total_loss\) === 1/);
    assert.match(nav, /Vehicle damage ledger/);
    assert.match(nav, /headScreenPath\(claimId, "repairs"\)/);
    assert.equal(headScreenPath("c4", "repairs"), "/claims/c4/heads/vehicle");
    assert.equal(headScreenPath("c4", "hire"), "/claims/c4/heads/hire");
    assert.equal(headScreenPath("c4", "recovery"), "/claims/c4/heads/recovery");
    assert.equal(headScreenPath("c4", "storage"), "/claims/c4/heads/storage");
    const totalLossTick = assessed?.sections[0]?.fields.find((field) => field.name === "totalLoss");
    assert.match(totalLossTick?.hint || "", /marks the file as a total loss/);
    assert.match(totalLossTick?.hint || "", /does not set claimed, offered, agreed or received/);
  });

  it("opens the repair ledger on a repairable file and the total-loss ledger on a total loss, from the same file-screens link", () => {
    const vehiclePage = read("src/app/claims/[id]/heads/vehicle/page.tsx");
    assert.match(vehiclePage, /applicableVehicleHead\(totalLoss\)/);
    const db = seeded();
    withDatabase(db, () => {
      const repairable = db.prepare(`SELECT total_loss, later_declared_total_loss FROM claims WHERE id = 'c4'`).get() as {
        total_loss: number;
        later_declared_total_loss: number;
      };
      const totalLoss = db.prepare(`SELECT total_loss, later_declared_total_loss FROM claims WHERE id = 'c9'`).get() as {
        total_loss: number;
        later_declared_total_loss: number;
      };
      assert.equal(Number(repairable.total_loss), 0);
      assert.equal(Number(totalLoss.total_loss), 1);
      const repairHead = applicableVehicleHead(Number(repairable.total_loss) === 1 || Number(repairable.later_declared_total_loss) === 1);
      const lossHead = applicableVehicleHead(Number(totalLoss.total_loss) === 1 || Number(totalLoss.later_declared_total_loss) === 1);
      assert.equal(repairHead, "repairs");
      assert.equal(lossHead, "vehicle_damage");
      assert.equal(headScreenPath("c4", repairHead), "/claims/c4/heads/vehicle");
      assert.equal(headScreenPath("c9", lossHead), "/claims/c9/heads/vehicle");
      assert.equal(loadHeadSection("c4", repairHead).head, "repairs");
      assert.equal(loadHeadSection("c9", lossHead).head, "vehicle_damage");
      assert.match(loadHeadSection("c4", repairHead).title, /Repair/i);
      assert.match(loadHeadSection("c9", lossHead).title, /Vehicle damage|Total loss/i);
    });
    db.close();
  });

  it("keeps ledger figures and chases unchanged when notes are saved", () => {
    const db = seeded();
    withDatabase(db, () => {
      getScreenData("c4", "assessed-damage");
      getScreenData("c9", "financial-summary");
      const before = {
        c4: moneySnapshot(db, "c4"),
        c9: moneySnapshot(db, "c9"),
      };
      const reviewsBefore = JSON.stringify({
        c4: listOpenPaymentReviews("c4"),
        c9: listOpenPaymentReviews("c9"),
      });
      saveScreenData(
        "c4",
        "assessed-damage",
        {
          totalLoss: "",
          assessedRepair: "yes",
          salvageCategory: "N",
          salvageValue: "19075",
          grossValuation: "1315000",
          netValuation: "1295925",
          repairHours: "12",
          hourlyRate: "4500",
          labour: "54000",
          parts: "80000",
          paintMaterials: "15000",
          specialist: "0",
          subtotal: "149000",
          vat: "29800",
          totalReserve: "178800",
        },
        "staff-justin",
      );
      saveScreenData(
        "c9",
        "financial-summary",
        {
          hireInvoice: "100000",
          engineerInvoice: "25000",
          repairInvoice: "80000",
          policeInvoice: "0",
          recoveryInvoice: "39500",
          storageInvoice: "3900",
          photographerInvoice: "0",
          invoiceReceived: "5000",
          storageReceived: "0",
          recoveryReceived: "0",
          invoiceWriteOff: "0",
          storageWriteOff: "0",
          recoveryWriteOff: "0",
        },
        "staff-justin",
      );
      const notes = getScreenData("c4", "assessed-damage");
      assert.equal(notes.labour, "54000");
      assert.equal(notes.totalReserve, "178800");
      assert.equal(notes.totalLoss, "");
      const summary = getScreenData("c9", "financial-summary");
      assert.equal(summary.repairInvoice, "80000");
      assert.equal(summary.invoiceReceived, "5000");
      assert.equal(
        JSON.stringify({
          c4: listOpenPaymentReviews("c4"),
          c9: listOpenPaymentReviews("c9"),
        }),
        reviewsBefore,
      );
      assert.deepEqual(moneySnapshot(db, "c4"), before.c4);
      assert.deepEqual(moneySnapshot(db, "c9"), before.c9);
    });
    db.close();
  });

  it("still marks the file as a total loss when that box is ticked, without changing the ledger", () => {
    const db = seeded();
    const before = moneySnapshot(db, "c5");
    withDatabase(db, () => {
      saveScreenData("c5", "assessed-damage", { totalLoss: "yes", labour: "100" }, "staff-justin");
    });
    const after = moneySnapshot(db, "c5");
    assert.equal(Number((after.claim as { total_loss: number }).total_loss), 1);
    assert.deepEqual(after.lines, before.lines);
    const beforeEvents = before.events as Array<{ id: string; event_type: string }>;
    const afterEvents = after.events as Array<{ id: string; event_type: string }>;
    const added = afterEvents.filter((event) => !beforeEvents.some((prior) => prior.id === event.id));
    assert.deepEqual(
      added.map((event) => event.event_type).sort(),
      ["repair_steps_closed_total_loss", "storage_end_date_review"],
    );
    assert.equal(
      (db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as { storage_billing_end_on: string | null })
        .storage_billing_end_on,
      null,
    );
    assert.deepEqual(after.automations, before.automations);
    db.close();
  });

  it("stores loss-of-use dates without writing the chronology", () => {
    const screen = getClaimScreen("loss-of-use");
    assert.equal(screen?.hidden, true);
    const fields = screen?.sections[0]?.fields.map((field) => ({ name: field.name, label: field.label })) || [];
    assert.deepEqual(fields, LOSS_OF_USE_FIELDS);
    assert.equal(read("src/lib/db/screens.ts").includes("Recorded from loss of use dates."), false);
    const db = seeded();
    const before = moneySnapshot(db, "c4");
    const values = {
      mitStatReturned: "2026-01-02",
      firstNotificationTpi: "2026-01-03",
      solicitorInstructed: "2026-01-04",
      engineerInstructed: "2026-01-05",
      engineerInvoicePaid: "2026-01-06",
      repairAuthorised: "2026-01-07",
      repairerInstructed: "2026-01-08",
      repairStart: "2026-01-09",
      repairerInvoicePaid: "2026-01-10",
      abiHirePackTpi: "2026-01-11",
      nonAbiHirePackTpi: "2026-01-12",
      hirePaidInFull: "2026-01-13",
      hirerInstructed: "2026-01-14",
      hireOut: "2026-01-15",
      hireBack: "2026-01-16",
      currentHireStatus: "On hire",
      caseStatus: "Open",
      daysBeforeTpiPayment: "14",
    };
    withDatabase(db, () => {
      saveScreenData("c4", "loss-of-use", values, "staff-justin");
      assert.deepEqual(getScreenData("c4", "loss-of-use"), values);
    });
    const after = moneySnapshot(db, "c4");
    assert.deepEqual(after.events, before.events);
    assert.deepEqual(after.lines, before.lines);
    const written = db
      .prepare(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c4' AND details = ?`)
      .get("Recorded from loss of use dates.") as { n: number };
    assert.equal(Number(written.n), 0);
    db.close();
  });
});

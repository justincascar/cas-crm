import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import { chooseHireCar, saveHireNeed } from "../src/lib/db/hire-choice.ts";
import { saveHirePack } from "../src/lib/db/hire-pack.ts";
import { canReadDocument } from "../src/lib/db/jobs.ts";
import { setLicenceCheckWindowDays } from "../src/lib/db/licence-window.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import {
  bankStatementPosition,
  hireAgreementPrehireBlock,
  listHireDrivers,
  listStoredBankStatements,
  recordLicenceCheck,
  recordNoBankExplanation,
  storeHireBankStatement,
} from "../src/lib/db/prehire-checks.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow, londonTodayIso } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function warmup() {
  get<{ id: string }>(`SELECT id FROM claims WHERE id = 'c1'`);
}

function licence(claimId: string, checkedOn = londonTodayIso(), result: "ok" | "problem" = "ok") {
  for (const driver of listHireDrivers(claimId)) {
    recordLicenceCheck({
      claimId,
      actorId: "staff-sian",
      driverKey: driver.key,
      checkCode: "",
      category: "B",
      penaltyPoints: 0,
      licenceExpiresOn: "2032-01-01",
      checkedOn,
      result,
    });
  }
}

describe("hire check gates", () => {
  it("lets a car be reserved before the checks, and blocks only the agreement and the handover", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      saveHireNeed({ claimId: "c1", actorId: "staff-sian", choice: "yes", reason: "", submitKey: "need-c1" });
      const car = get<{ id: string }>(
        `SELECT fv.id FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id
         WHERE fv.status = 'available' AND fv.removed_at IS NULL ORDER BY v.registration LIMIT 1`,
      );
      const chosen = chooseHireCar({
        claimId: "c1",
        fleetVehicleId: car!.id,
        method: "deliver",
        date: "2026-11-02",
        time: "09:30",
        address: "1 Test Street, Cardiff",
        actorId: "staff-sian",
        submitKey: "choose-c1",
      });
      assert.equal(chosen.reservationId.length > 0, true);
      const reserved = get<{ status: string }>(`SELECT status FROM fleet_vehicles WHERE id = ?`, [car!.id]);
      assert.equal(reserved?.status, "reserved");
      const started = get<{ started_at: string | null }>(
        `SELECT started_at FROM hire_episodes WHERE claim_id = 'c1' ORDER BY rowid DESC LIMIT 1`,
      );
      assert.equal(started?.started_at, null);
      db.prepare(`UPDATE claims SET claim_type = 'non_fault' WHERE id = 'c1'`).run();
      const blocked = hireAgreementPrehireBlock("c1", { purpose: "agreement" });
      assert.match(String(blocked), /A hire agreement was not produced/);
      assert.match(String(blocked), /licence check/);
      assert.match(String(blocked), /bank statement/);
    });
  });

  it("requires only a current licence check on a fault courtesy file", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      assert.match(String(hireAgreementPrehireBlock("c4", { purpose: "handover" })), /licence check/);
      assert.equal(/bank statement/.test(String(hireAgreementPrehireBlock("c4"))), false);
      licence("c4");
      assert.equal(hireAgreementPrehireBlock("c4", { purpose: "handover" }), null);
      assert.equal(hireAgreementPrehireBlock("c4", { purpose: "agreement" }), null);
    });
  });

  it("treats a check older than the settings window as not done", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      setLicenceCheckWindowDays("10");
      licence("c4", isoDateFromNow(-11));
      const block = hireAgreementPrehireBlock("c4", { purpose: "handover" });
      assert.match(String(block), /older than 10 days/);
      licence("c4", isoDateFromNow(-10));
      assert.equal(hireAgreementPrehireBlock("c4", { purpose: "handover" }), null);
    });
  });

  it("asks again when an additional driver is added after the checks", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      db.prepare(`UPDATE claims SET claim_type = 'non_fault' WHERE id = 'c4'`).run();
      licence("c4");
      recordNoBankExplanation({ claimId: "c4", actorId: "staff-sian", explanation: "The client uses a family member's account." });
      assert.equal(hireAgreementPrehireBlock("c4", { purpose: "handover" }), null);
      saveHirePack("c4", { additional_name: "Nia Jones" });
      const again = hireAgreementPrehireBlock("c4", { purpose: "agreement" });
      assert.match(String(again), /No licence check is recorded for Nia Jones/);
    });
  });

  it("accepts a no-bank explanation in place of a statement", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      licence("c5");
      assert.match(String(hireAgreementPrehireBlock("c5")), /no bank account/);
      recordNoBankExplanation({ claimId: "c5", actorId: "staff-sian", explanation: "The client has no bank account." });
      const position = bankStatementPosition("c5");
      assert.equal(position.satisfied, true);
      assert.equal(position.noBankExplanation, "The client has no bank account.");
      assert.equal(hireAgreementPrehireBlock("c5"), null);
    });
  });

  it("labels an uploaded statement and counts it, and ignores a repeated submit", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const input = {
        claimId: "c2",
        actorId: "staff-sian",
        actorRole: "staff",
        clientName: "Bethan Lewis",
        period: "July to September 2026",
        submitKey: "bank-c2-once",
        file: { buffer: Buffer.from("%PDF-1.4\n"), filename: "july.pdf", mimeType: "application/pdf" },
      };
      const first = storeHireBankStatement(input);
      const second = storeHireBankStatement(input);
      assert.equal(first.id, second.id);
      const rows = listStoredBankStatements("c2");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title.startsWith("Bank statement – Bethan Lewis – "), true);
      assert.equal(rows[0].period, "July to September 2026");
      assert.equal(bankStatementPosition("c2").statements.length, 1);
      assert.equal(bankStatementPosition("c2").satisfied, true);
      assert.equal(canReadDocument({ id: "staff-driver", role: "driver" }, first.id), false);
      assert.equal(canReadDocument({ id: "staff-mechanic", role: "mechanic" }, first.id), false);
      assert.equal(canReadDocument({ id: "staff-sian", role: "staff" }, first.id), true);
    });
  });

  it("refuses a mechanic upload and leaves a problem result undone", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      assert.throws(
        () =>
          storeHireBankStatement({
            claimId: "c2",
            actorId: "staff-mechanic",
            actorRole: "mechanic",
            clientName: "Bethan Lewis",
            submitKey: "bank-mechanic",
            file: { buffer: Buffer.from("%PDF-1.4\n"), filename: "july.pdf", mimeType: "application/pdf" },
          }),
        /cannot store documents/,
      );
      licence("c2", londonTodayIso(), "problem");
      assert.match(String(hireAgreementPrehireBlock("c2")), /found a problem/);
    });
  });
});

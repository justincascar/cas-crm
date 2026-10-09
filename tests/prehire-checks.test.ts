import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { generateHireAgreementDocument } from "../src/lib/db/hire-agreement.ts";
import { saveHirePack } from "../src/lib/db/hire-pack.ts";
import {
  addImpecuniosityAccount,
  checklistStatus,
  impecuniosityApproved,
  saveFinancialCircumstances,
} from "../src/lib/db/impecuniosity.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import {
  hireAgreementPrehireBlock,
  listHireDrivers,
  recordLicenceCheck,
} from "../src/lib/db/prehire-checks.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow, londonTodayIso } from "../src/lib/dates.ts";
import { handoverStaleLines, licenceCheckIsStale } from "../src/lib/domain/prehire-checks.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function licenceFor(claimId: string, driverKey: string, checkedOn = londonTodayIso()) {
  recordLicenceCheck({
    claimId,
    actorId: "staff-justin",
    driverKey,
    checkCode: "test-check-code",
    category: "B",
    pointsEndorsements: "None shown",
    licenceExpiresOn: "2032-01-01",
    checkedOn,
  });
}

function hireAgreementCount(db: DatabaseSync, claimId: string) {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`).get(claimId) as {
      n: number;
    }
  ).n;
}

describe("pre-hire checks before a hire agreement", () => {
  it("includes each person who will drive, and not an owner, hirer, witness or third party", () => {
    const db = prepared();
    withDatabase(db, () => {
      const courtesy = listHireDrivers("c4").map((driver) => driver.name);
      assert.deepEqual(courtesy, ["Dafydd Jones"]);

      const split = listHireDrivers("c10");
      assert.deepEqual(split.map((driver) => driver.name), ["Mei Chen"]);
      assert.equal(split.some((driver) => driver.name === "Chen Logistics Ltd"), false);

      const withWitness = listHireDrivers("c2").map((driver) => driver.name);
      assert.deepEqual(withWitness, ["Bethan Lewis"]);

      assert.deepEqual(listHireDrivers("c5").map((driver) => driver.name), ["Elin Powell"]);
      db.prepare(
        `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES ('c5', 'driver', ?, ?)`,
      ).run(JSON.stringify({ forename: "Owen", surname: "Price" }), "2026-10-07T12:00:00.000Z");
      const named = listHireDrivers("c5");
      assert.deepEqual(named.map((driver) => driver.name), ["Owen Price"]);
      assert.equal(named.some((driver) => driver.name === "Elin Powell"), false);

      saveHirePack("c4", { additional_name: "Dafydd Jones" });
      assert.deepEqual(listHireDrivers("c4").map((driver) => driver.name), ["Dafydd Jones"]);
      saveHirePack("c4", { additional_name: "Nia Evans" });
      assert.deepEqual(listHireDrivers("c4").map((driver) => driver.name), ["Dafydd Jones", "Nia Evans"]);
    });
    db.close();
  });

  it("refuses a direct call to generate the agreement when a licence check is missing, and files nothing", () => {
    const db = prepared();
    withDatabase(db, () => {
      addImpecuniosityAccount({ claimId: "c4", actorId: "staff-justin", label: "Barclays current", kind: "bank_account" });
      const beforeDocs = hireAgreementCount(db, "c4");
      const beforeNumber = db.prepare(`SELECT hire_agreement_number AS n FROM claims WHERE id = 'c4'`).get() as { n: string | null };
      const beforeSequence = db.prepare(`SELECT value FROM settings WHERE key = 'next_hire_agreement_number'`).get() as { value: string };
      assert.throws(() => generateHireAgreementDocument("c4", "staff-justin", 0), /No licence check is recorded for Dafydd Jones/);
      assert.match(String(hireAgreementPrehireBlock("c4")), /no override/i);
      assert.equal(hireAgreementCount(db, "c4"), beforeDocs);
      assert.equal((db.prepare(`SELECT hire_agreement_number AS n FROM claims WHERE id = 'c4'`).get() as { n: string | null }).n, beforeNumber.n);
      assert.equal(
        (db.prepare(`SELECT value FROM settings WHERE key = 'next_hire_agreement_number'`).get() as { value: string }).value,
        beforeSequence.value,
      );
    });
    db.close();
  });

  it("refuses generation when bank-statement evidence is missing, and does not treat wage slips as a bank account", () => {
    const db = prepared();
    withDatabase(db, () => {
      for (const driver of listHireDrivers("c4")) licenceFor("c4", driver.key);
      addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "March wages", kind: "wage_slips" });
      assert.throws(() => generateHireAgreementDocument("c4", "staff-sian", 0), /no bank account listed/);
      assert.equal(hireAgreementCount(db, "c4"), 0);
    });
    db.close();
  });

  it("accepts a saved no-bank explanation without a listed account, a complete checklist, or impecuniosity approval", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveFinancialCircumstances({
        claimId: "c4",
        actorId: "staff-sian",
        employmentStatus: "employed",
        abilityToPay: "not_answered",
        noBankExplanation: "Paid in cash. No bank account.",
      });
      for (const driver of listHireDrivers("c4")) licenceFor("c4", driver.key);
      assert.equal(checklistStatus("c4"), "not_started");
      assert.equal(impecuniosityApproved("c4"), false);
      assert.equal(hireAgreementPrehireBlock("c4"), null);
      const result = generateHireAgreementDocument("c4", "staff-sian", 0);
      const row = db.prepare(`SELECT signed FROM documents WHERE id = ?`).get(result.documentId) as { signed: number };
      assert.equal(row.signed, 0);
    });
    db.close();
  });

  it("blocks generation when an additional driver has no licence check, even if the lead driver's check is done", () => {
    const db = prepared();
    withDatabase(db, () => {
      for (const driver of listHireDrivers("c4")) licenceFor("c4", driver.key);
      addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "Barclays current", kind: "bank_account" });
      assert.equal(hireAgreementPrehireBlock("c4"), null);
      saveHirePack("c4", { additional_name: "Nia Evans" });
      assert.match(String(hireAgreementPrehireBlock("c4")), /Nia Evans/);
      assert.throws(() => generateHireAgreementDocument("c4", "staff-justin", 0), /Nia Evans/);
      assert.equal(hireAgreementCount(db, "c4"), 0);
      const extra = listHireDrivers("c4").find((driver) => driver.name === "Nia Evans");
      assert.ok(extra);
      licenceFor("c4", extra.key);
      assert.equal(hireAgreementPrehireBlock("c4"), null);
      const result = generateHireAgreementDocument("c4", "staff-sian", 0);
      const row = db.prepare(`SELECT signed FROM documents WHERE id = ?`).get(result.documentId) as { signed: number };
      assert.equal(row.signed, 0);
    });
    db.close();
  });

  it("still treats a check outside the 21-day demonstration window as recorded, and flags it at handover", () => {
    const db = prepared();
    withDatabase(db, () => {
      const staleOn = isoDateFromNow(-22);
      const within = isoDateFromNow(-21);
      assert.equal(licenceCheckIsStale(staleOn, londonTodayIso()), true);
      assert.equal(licenceCheckIsStale(within, londonTodayIso()), false);
      const driver = listHireDrivers("c4")[0];
      licenceFor("c4", driver.key, staleOn);
      addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "Barclays current", kind: "bank_account" });
      assert.equal(hireAgreementPrehireBlock("c4"), null);
      const result = generateHireAgreementDocument("c4", "staff-sian", 0);
      assert.ok(result.documentId);
      const lines = handoverStaleLines({
        drivers: listHireDrivers("c4"),
        checks: [{ driverKey: driver.key, checkedOn: staleOn, recordedAt: "2026-01-01T00:00:00.000Z" }],
        asAtYmd: londonTodayIso(),
      });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /21-day demonstration window/);
      assert.match(lines[0], /Dafydd Jones/);
    });
    db.close();
  });
});

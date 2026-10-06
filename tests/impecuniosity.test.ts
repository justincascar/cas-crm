import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { storeClaimDocument } from "../src/lib/db/claim-documents.ts";
import { generateClaimDocument, letterPreview, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import {
  addImpecuniosityAccount,
  checklistStatus,
  impecuniosityApproved,
  impecuniosityGate,
  listFinancialCircumstances,
  listMitigationStatements,
  saveFinancialCircumstances,
  saveMitigationStatement,
  setChecklistStatus,
  setImpecuniosityApproval,
} from "../src/lib/db/impecuniosity.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { ABILITY_TO_PAY_QUESTION, MITIGATION_QUESTIONNAIRE } from "../src/lib/domain/impecuniosity.ts";
import { getHirePack, renderHirePack } from "../src/lib/db/hire-pack.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const means = {
  claimId: "c4",
  actorId: "staff-sian",
  employmentStatus: "employed",
  incomeAsStated: "about £1,800 a month, as the client said",
  benefitsAsStated: "",
  abilityToPay: "no",
  abilityToPayWords: "I could not pay for a hire car myself.",
  noBankExplanation: "Paid in cash. No bank account.",
};

describe("financial circumstances and impecuniosity", () => {
  it("saves the client's own answers, including no bank account, and keeps the earlier entry", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveFinancialCircumstances(means);
      assert.throws(
        () => saveFinancialCircumstances({ ...means, incomeAsStated: "changed", employmentStatus: "not_employed" }),
        /new dated entry/,
      );
      saveFinancialCircumstances({
        ...means,
        employmentStatus: "not_employed",
        incomeAsStated: "lost the job during the hire",
        correctionReason: "Client says they lost their job.",
      });
      const rows = listFinancialCircumstances("c4");
      assert.equal(rows.length, 2);
      assert.equal(rows[0].employment_status, "employed");
      assert.equal(rows[0].income_as_stated, "about £1,800 a month, as the client said");
      assert.equal(rows[0].no_bank_explanation, "Paid in cash. No bank account.");
      assert.equal(rows[0].question_wording, ABILITY_TO_PAY_QUESTION);
      assert.equal(rows[1].employment_status, "not_employed");
      assert.equal(rows[1].correction_reason, "Client says they lost their job.");
    });
    db.close();
  });

  it("keeps Partial until a handler marks Complete, and uploading files does not promote it", () => {
    const db = prepared();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-impec-"));
    const previous = process.env.CAS_FILES_DIR;
    process.env.CAS_FILES_DIR = dir;
    try {
      withDatabase(db, () => {
        assert.equal(checklistStatus("c4"), "not_started");
        addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "Barclays current", kind: "bank_account" });
        addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "Monzo", kind: "bank_account" });
        assert.equal(checklistStatus("c4"), "not_started");
        setChecklistStatus({ claimId: "c4", actorId: "staff-sian", actorRole: "staff", status: "partial" });
        storeClaimDocument({
          claimId: "c4",
          actorId: "staff-sian",
          actorRole: "staff",
          documentType: "impecuniosity_evidence",
          file: { buffer: Buffer.from("%PDF-1.4 statement"), filename: "statement.pdf", mimeType: "application/pdf" },
        });
        addImpecuniosityAccount({ claimId: "c4", actorId: "staff-sian", label: "Wage slips March", kind: "wage_slips" });
        assert.equal(checklistStatus("c4"), "partial");
        assert.throws(
          () => setChecklistStatus({ claimId: "c4", actorId: "staff-driver", actorRole: "driver", status: "complete" }),
          /Only a handler/,
        );
        assert.equal(checklistStatus("c4"), "partial");
        setChecklistStatus({ claimId: "c4", actorId: "staff-sian", actorRole: "staff", status: "complete" });
        assert.equal(checklistStatus("c4"), "complete");
      });
    } finally {
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    db.close();
  });

  it("blocks the impecuniosity letter and an asserting email until the checklist is Complete and an administrator has approved", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      assert.match(impecuniosityGate("c4").generationBlock || "", /Not started/);
      assert.throws(() => letterPreview("c4", "impecuniosity_disclosure"), /Nothing was produced/);
      assert.throws(
        () =>
          generateClaimDocument({
            claimId: "c4",
            templateKey: "impecuniosity_disclosure",
            actorId: "staff-sian",
            recordOnFile: false,
          }),
        /Nothing was produced/,
      );
      const filed = get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM documents WHERE claim_id = ? AND template_key = 'impecuniosity_disclosure'`,
        ["c4"],
      );
      assert.equal(Number(filed?.c), 0);

      const before = get<{ c: number }>(`SELECT COUNT(*) AS c FROM correspondence WHERE claim_id = ?`, ["c4"]);
      const refused = await sendClaimEmail({
        claimId: "c4",
        actorId: "staff-sian",
        to: "insurer@example.test",
        subject: "Financial disclosure",
        body: "We say the client could not have paid for hire without making sacrifices.",
      });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.match(refused.error, /Nothing was produced/);
      const after = get<{ c: number }>(`SELECT COUNT(*) AS c FROM correspondence WHERE claim_id = ?`, ["c4"]);
      assert.equal(Number(after?.c), Number(before?.c));

      setChecklistStatus({ claimId: "c4", actorId: "staff-sian", actorRole: "staff", status: "complete" });
      assert.throws(
        () => setImpecuniosityApproval({ claimId: "c4", actorId: "staff-sian", actorRole: "staff", approved: true }),
        /authorised user/,
      );
      assert.equal(impecuniosityApproved("c4"), false);
      assert.match(impecuniosityGate("c4").generationBlock || "", /not approved/);
      assert.throws(() => letterPreview("c4", "impecuniosity_disclosure"), /not approved/);

      setImpecuniosityApproval({ claimId: "c4", actorId: "staff-justin", actorRole: "administrator", approved: true });
      assert.equal(impecuniosityGate("c4").generationBlock, null);
      const preview = letterPreview("c4", "impecuniosity_disclosure");
      assert.match(preview.text, /impecuniosity/);
      const generated = generateClaimDocument({
        claimId: "c4",
        templateKey: "impecuniosity_disclosure",
        actorId: "staff-justin",
        recordOnFile: false,
      });
      assert.ok(generated.documentId);

      setChecklistStatus({ claimId: "c4", actorId: "staff-sian", actorRole: "staff", status: "partial" });
      assert.match(impecuniosityGate("c4").generationBlock || "", /Partial/);
      assert.throws(() => letterPreview("c4", "impecuniosity_disclosure"), /Partial/);
    });
    db.close();
  });

  it("versions a mitigation statement and does not edit the earlier one", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveMitigationStatement({
        claimId: "c4",
        actorId: "staff-sian",
        offerPosition: "no_offer",
        understandsPersonalLiability: true,
        needReason: "I need a car for work for about three weeks.",
        ownVehicleUnusable: true,
        noOtherVehicle: true,
        statementOn: "2026-10-01",
      });
      assert.throws(
        () =>
          saveMitigationStatement({
            claimId: "c4",
            actorId: "staff-sian",
            offerPosition: "declined",
            declinedOfferReason: "Too small.",
            understandsPersonalLiability: true,
            needReason: "Corrected account.",
            ownVehicleUnusable: false,
            noOtherVehicle: true,
          }),
        /earlier statement is kept/,
      );
      saveMitigationStatement({
        claimId: "c4",
        actorId: "staff-sian",
        correctionReason: "Client corrected how long they needed the car.",
        offerPosition: "declined",
        declinedOfferReason: "The car offered was too small.",
        understandsPersonalLiability: true,
        needReason: "I need it for about six weeks.",
        ownVehicleUnusable: true,
        noOtherVehicle: false,
      });
      const rows = listMitigationStatements("c4");
      assert.equal(rows.length, 2);
      assert.equal(rows[0].need_reason, "I need a car for work for about three weeks.");
      assert.equal(rows[0].offer_position, "no_offer");
      assert.equal(rows[1].need_reason, "I need it for about six weeks.");
      assert.equal(rows[1].correction_reason, "Client corrected how long they needed the car.");
      assert.match(MITIGATION_QUESTIONNAIRE.needBecause, /I need a hire vehicle because/);
    });
    db.close();
  });

  it("leaves the impecuniosity assertion out of a hire pack until both gates are open", () => {
    const db = prepared();
    withDatabase(db, () => {
      saveFinancialCircumstances(means);
      const withheldPack = getHirePack("c4");
      assert.ok(withheldPack);
      const withheld = renderHirePack(withheldPack);
      assert.match(withheld, /does not rely on impecuniosity/);
      assert.doesNotMatch(withheld, /could not have paid for hire without making sacrifices/i);
      assert.doesNotMatch(withheld, /I could not reasonably have funded a replacement vehicle from my own resources/);
      setChecklistStatus({ claimId: "c4", actorId: "staff-justin", actorRole: "administrator", status: "complete" });
      setImpecuniosityApproval({ claimId: "c4", actorId: "staff-justin", actorRole: "administrator", approved: true });
      const allowedPack = getHirePack("c4");
      assert.ok(allowedPack);
      const allowed = renderHirePack(allowedPack);
      assert.match(allowed, /Client's own answer/);
      assert.match(allowed, /could not have paid without that sacrifice/);
      assert.match(allowed, /I could not pay for a hire car myself/);
    });
    db.close();
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { get, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { produceDraftInvoice } from "../src/lib/db/draft-invoice.ts";
import { generateStorageRecoveryDocument } from "../src/lib/db/hire-pack.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  guardStorageRecoveryClaim,
  signStorageRecoveryOnScreen,
  storageRecoveryState,
  storeSignedStorageRecoveryPaper,
} from "../src/lib/db/storage-recovery-signing.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { CAS_HIRE_TERMS_HTML } from "../src/lib/documents/cas-hire-terms.ts";
import { storageRecoveryTermsHtml } from "../src/lib/documents/storage-recovery-agreement.ts";
import { DRAFT_WORDING_NOT_APPROVED } from "../src/lib/documents/template-approval.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r17-"));
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function drawnSignature(): string {
  const canvas = createCanvas(600, 180);
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.moveTo(40, 120);
  ctx.lineTo(520, 110);
  ctx.stroke();
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

async function recoveryOnlyClaim(registration = "CP19 SRA") {
  const form = new FormData();
  form.set("client_forename", "Owain");
  form.set("client_surname", "Storage");
  form.set("client_mobile", "07700900765");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-5));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  if (registration) form.set("veh_registration", registration);
  const claim = await createClaimFromIntake(intakeFromFormData(form));
  const recovery = new FormData();
  recovery.set("arrivedDate", isoDateFromNow(-4));
  recovery.set("arrivedTime", "11:00");
  recovery.set("recoveryLocation", "A4232, Cardiff");
  recovery.set("carCondition", "Front end crushed.");
  recovery.set("notDriveable", "unsafe");
  recovery.set("recoveryTick_standard", "yes");
  recovery.set("recoveryAmount_standard", "395");
  recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recovery });
  return claim;
}

describe("Review notes R17–R18", () => {
  it("R17: the Storage & Recovery terms are lines of the supplied Hire Pack terms, unchanged", () => {
    const terms = storageRecoveryTermsHtml();
    const lines = terms.split("\n").filter(Boolean);
    for (const line of lines) assert.ok(CAS_HIRE_TERMS_HTML.includes(line), `not in the supplied terms: ${line.slice(0, 60)}`);
    for (const clause of ["1.1", "1.5", "2.1", "2.2", "2.17", "4.12", "5.3"]) assert.match(terms, new RegExp(`<p>${clause.replace(".", "\\.")} `));
    assert.match(terms, /<strong>Storage &amp; Recovery Charges<\/strong>/);
    assert.match(terms, /<strong>Total Charges<\/strong>/);
    assert.doesNotMatch(terms, /<p>2\.5 /, "hire-only clauses are left out");
    assert.doesNotMatch(terms, /<p>5\.9 /);
    assert.doesNotMatch(terms, /<strong>Hire Vehicle<\/strong>/);
  });

  it("R17: a recovery-only client signs the agreement on screen before recovery or storage is claimed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveryOnlyClaim();
      assert.equal(storageRecoveryState(claim.id).status, "not_signed");
      assert.throws(() => guardStorageRecoveryClaim(claim.id, "recovery_payment_request_sent"), /has not signed the Storage & Recovery Agreement/);
      assert.throws(() => guardStorageRecoveryClaim(claim.id, "storage_payment_request_sent"), /has not signed/);
      guardStorageRecoveryClaim(claim.id, "other");

      await assert.rejects(
        signStorageRecoveryOnScreen({ claimId: claim.id, actorId: "staff-sian", name: "Owain Storage", signaturePng: drawnSignature(), agreed: true, device: "test", ip: "" }),
        /Produce the Storage & Recovery Agreement for signature first/,
      );
      const made = generateStorageRecoveryDocument(claim.id, "staff-sian");
      assert.deepEqual(made.missing, []);
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [made.documentId])?.body_html);
      assert.match(html, /Storage &amp; Recovery Agreement — 1 of 3/);
      assert.match(html, /Notice of the Right to Cancel/);
      assert.match(html, /Standard recovery: £395\.00 net/);
      assert.match(html, /CP19 SRA/);
      assert.ok(!html.includes(DRAFT_WORDING_NOT_APPROVED), "the supplied wording is not marked as a draft");

      await assert.rejects(
        signStorageRecoveryOnScreen({ claimId: claim.id, actorId: "staff-sian", name: "Owain Storage", signaturePng: drawnSignature(), agreed: false, device: "test", ip: "" }),
        /must tick the box/,
      );
      await signStorageRecoveryOnScreen({ claimId: claim.id, actorId: "staff-sian", name: "Owain Storage", signaturePng: drawnSignature(), agreed: true, device: "test", ip: "" });
      const state = storageRecoveryState(claim.id);
      assert.equal(state.status, "signed");
      if (state.status === "signed") {
        assert.equal(state.route, "screen");
        assert.equal(state.signerName, "Owain Storage");
        const filed = get<{ document_type: string; signed: number }>(`SELECT document_type, signed FROM documents WHERE id = ?`, [state.documentId]);
        assert.equal(filed?.document_type, "signed_storage_recovery_agreement");
        assert.equal(filed?.signed, 1);
      }
      guardStorageRecoveryClaim(claim.id, "recovery_payment_request_sent");

      const invoice = produceDraftInvoice({ claimId: claim.id, head: "customer", actorId: "staff-sian" });
      const body = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [invoice.documentId])?.body_html);
      assert.match(body, /Storage &amp; Recovery Agreement TEST-\d+-SR signed by Owain Storage on \d\d\/\d\d\/\d{4} \(signed on screen\)\. These charges are due under that agreement\./);
    });
    db.close();
  });

  it("R17: the signed paper copy can be uploaded instead; a version with details missing cannot be signed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const noReg = await recoveryOnlyClaim("");
      const made = generateStorageRecoveryDocument(noReg.id, "staff-sian");
      assert.ok(made.missing.length > 0);
      assert.throws(
        () =>
          storeSignedStorageRecoveryPaper({
            claimId: noReg.id,
            actorId: "staff-sian",
            signerName: "Owain Storage",
            file: { buffer: Buffer.from("%PDF-1.4 signed"), filename: "signed.pdf", mimeType: "application/pdf" },
          }),
        /produced with details missing/,
      );

      const claim = await recoveryOnlyClaim();
      generateStorageRecoveryDocument(claim.id, "staff-sian");
      assert.throws(
        () => storeSignedStorageRecoveryPaper({ claimId: claim.id, actorId: "staff-sian", signerName: "Owain Storage", file: { buffer: Buffer.alloc(0), filename: "x.pdf", mimeType: "application/pdf" } }),
        /Choose the signed Storage & Recovery Agreement/,
      );
      storeSignedStorageRecoveryPaper({
        claimId: claim.id,
        actorId: "staff-sian",
        signerName: "Owain Storage",
        file: { buffer: Buffer.from("%PDF-1.4 signed"), filename: "signed.pdf", mimeType: "application/pdf" },
      });
      const state = storageRecoveryState(claim.id);
      assert.equal(state.status, "signed");
      if (state.status === "signed") {
        assert.equal(state.route, "paper");
        assert.equal(state.signedAt.slice(0, 10), new Date().toISOString().slice(0, 10), "the signed date is the upload, never earlier");
      }
    });
    db.close();
    assert.match(read("src/app/actions.ts"), /guardStorageRecoveryClaim\(claimId, eventType\)/);
  });

  it("R18: the legal-review points are flagged for the solicitor, and the terms are unchanged", () => {
    const questions = read("docs/QUESTIONS-FOR-JUSTIN.md");
    assert.match(questions, /## For your solicitor/);
    assert.match(questions, /Consumer Credit \(Exempt Agreements\) Order 1989/);
    assert.match(questions, /Doorstep signing and cancellation rights/);
    assert.match(CAS_HIRE_TERMS_HTML, /under article 3\(1\)\(a\)\(i\) of the Consumer Credit \(Exempt Agreements\) Order 1989/);
  });
});

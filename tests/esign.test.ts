import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { clientAgreementHtml, latestEsign, openSigningLink, sendSigningLink, signAtDoorstep, signWithLink } from "../src/lib/db/esign.ts";
import { generateHireAgreementDocument } from "../src/lib/db/hire-agreement.ts";
import { chooseHireCar, completeHireHandover, loadHireArea, saveHireNeed } from "../src/lib/db/hire-choice.ts";
import { hireHandoverBlock } from "../src/lib/db/hire-readiness.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { londonTodayIso } from "../src/lib/dates.ts";
import { readStoredFile } from "../src/lib/storage/files.ts";
import { prepareAgreementItems, recordPassingPrehireChecks } from "./prehire-setup.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-esign-"));
process.env.EMAIL_SEND_MODE = "simulate";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const DEVICE = "Mozilla/5.0 (Linux; Android 14) test phone";

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  // Fictional files: the client's own car group was never looked up, which the group check (R27) accepts with a reason.
  db.exec(`UPDATE vehicles SET gta_unclassified_reason = 'Fictional test car: group not looked up' WHERE gta_group IS NULL AND id IN (SELECT client_vehicle_id FROM claims)`);
  return db;
}

/** A drawn line, standing in for a client's signature. */
function drawnSignature(): string {
  const canvas = createCanvas(600, 180);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#101c24";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(40, 120);
  ctx.bezierCurveTo(120, 20, 220, 170, 320, 70);
  ctx.lineTo(520, 110);
  ctx.stroke();
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

function readyForSigning(claimId = "c1", driverId?: string) {
  saveHireNeed({ claimId, choice: "yes", reason: "Car cannot be driven.", actorId: "staff-sian", submitKey: `need-${claimId}` });
  chooseHireCar({
    claimId,
    fleetVehicleId: "fv-10",
    method: "deliver",
    date: londonTodayIso(),
    time: "10:00",
    address: "1 Test Street, Cardiff",
    actorId: "staff-sian",
    submitKey: `choose-${claimId}`,
    driverId,
  });
  recordPassingPrehireChecks(claimId);
  prepareAgreementItems(claimId);
  return generateHireAgreementDocument(claimId, "staff-sian");
}

function tokenFrom(url: string) {
  return url.split("/sign/")[1];
}

async function pdfText(relpath: string): Promise<{ pages: number; text: string }> {
  const data = new Uint8Array(readStoredFile(relpath).buffer);
  const pdf = await getDocument({ data, useSystemFonts: false }).promise;
  let text = "";
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
  }
  return { pages: pdf.numPages, text };
}

describe("e-signing by link", () => {
  it("sends a one-time link by simulated email, files the signed PDF with an audit trail, and satisfies the handover rule", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const agreement = readyForSigning();
      assert.match(String(hireHandoverBlock("c1")), /Upload the signed hire agreement/);
      const sent = await sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "aled.morgan@example.test", origin: "http://localhost:3000" });
      assert.equal(sent.simulated, true);
      const mail = get<{ to_address: string; sent_status: string; body: string }>(
        `SELECT to_address, sent_status, body FROM correspondence WHERE claim_id = 'c1' AND template_key = 'hire_agreement_signing_link'`,
      );
      assert.equal(mail?.to_address, "aled.morgan@example.test");
      assert.equal(mail?.sent_status, "simulated_sent");
      assert.ok(mail?.body.includes(sent.url));
      const token = tokenFrom(sent.url);
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM esign_requests WHERE token_sha256 = ?`, [token])?.n, 0);
      const view = openSigningLink(token);
      assert.equal(view.documentTitle, `Hire Agreement ${agreement.agreementNumber}`);

      await assert.rejects(() => signWithLink({ token, name: "Aled Morgan", signaturePng: drawnSignature(), agreed: false, device: DEVICE, ip: "10.0.0.5" }), /Tick the box/);
      await assert.rejects(() => signWithLink({ token, name: "Aled Morgan", signaturePng: "", agreed: true, device: DEVICE, ip: "10.0.0.5" }), /draw your signature/);
      const signed = await signWithLink({ token, name: "Aled Morgan", signaturePng: drawnSignature(), agreed: true, device: DEVICE, ip: "10.0.0.5" });

      const row = get<{ status: string; signer_name: string; device: string; ip: string; document_version: number; document_sha256: string; signed_document_id: string; witness_staff_id: string | null }>(
        `SELECT status, signer_name, device, ip, document_version, document_sha256, signed_document_id, witness_staff_id FROM esign_requests WHERE claim_id = 'c1'`,
      );
      assert.equal(row?.status, "signed");
      assert.equal(row?.signer_name, "Aled Morgan");
      assert.equal(row?.device, DEVICE);
      assert.equal(row?.ip, "10.0.0.5");
      assert.equal(row?.document_version, 1);
      assert.match(String(row?.document_sha256), /^[0-9a-f]{64}$/);
      assert.equal(row?.witness_staff_id, null);
      assert.equal(row?.signed_document_id, signed.documentId);
      const doc = get<{ title: string; document_type: string; mime_type: string; signed: number; stored_relpath: string }>(
        `SELECT title, document_type, mime_type, signed, stored_relpath FROM documents WHERE id = ?`,
        [signed.documentId],
      );
      assert.equal(doc?.title, "Signed hire agreement");
      assert.equal(doc?.document_type, "signed_hire_agreement");
      assert.equal(doc?.mime_type, "application/pdf");
      assert.equal(doc?.signed, 1);
      const pdf = await pdfText(String(doc?.stored_relpath));
      assert.ok(pdf.pages >= 2);
      assert.match(pdf.text, /Agreement number/);
      assert.match(pdf.text, /Signed by: Aled Morgan/);
      assert.match(pdf.text, /version 1/);
      assert.match(pdf.text, /test phone/);
      assert.equal(hireHandoverBlock("c1"), null);
      assert.equal(loadHireArea("c1")?.esign?.status, "signed");
      assert.throws(() => openSigningLink(token), /already been signed/);
    });
    db.close();
  });

  it("stops an older link, and a link for an agreement that has since changed", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      readyForSigning();
      const first = await sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "aled.morgan@example.test", origin: "http://localhost:3000" });
      const second = await sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "aled.morgan@example.test", origin: "http://localhost:3000" });
      assert.throws(() => openSigningLink(tokenFrom(first.url)), /replaced/);
      generateHireAgreementDocument("c1", "staff-sian");
      assert.throws(() => openSigningLink(tokenFrom(second.url)), /agreement has changed/);
      assert.throws(() => openSigningLink("not-a-real-token"), /not recognised/);
      await assert.rejects(() => sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "not an email", origin: "http://localhost:3000" }), /email address/);
    });
    db.close();
  });

  it("does not offer signing before the agreement exists, or on a courtesy car", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      saveHireNeed({ claimId: "c1", choice: "yes", reason: "Needed.", actorId: "staff-sian", submitKey: "need-only" });
      chooseHireCar({ claimId: "c1", fleetVehicleId: "fv-10", method: "collect", date: londonTodayIso(), time: "10:00", address: "", actorId: "staff-sian", submitKey: "c-only" });
      await assert.rejects(() => sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "a@example.test", origin: "http://x" }), /Produce the agreement/);
      await assert.rejects(
        () => signAtDoorstep({ claimId: "c4", actorId: "staff-sian", name: "Dafydd Jones", signaturePng: drawnSignature(), agreed: true, device: DEVICE, ip: "" }),
        /courtesy car/,
      );
    });
    db.close();
  });
});

describe("e-signing at the doorstep", () => {
  it("lets the assigned driver's phone take the signature, records the witness and device, and the hire starts", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      readyForSigning("c1", "staff-driver");
      await assert.rejects(
        () => signAtDoorstep({ claimId: "c1", actorId: "staff-mechanic", name: "Aled Morgan", signaturePng: drawnSignature(), agreed: true, device: DEVICE, ip: "" }),
        /cannot record a handover|not assigned/,
      );
      await assert.rejects(
        () => signAtDoorstep({ claimId: "c1", actorId: "staff-driver", name: " ", signaturePng: drawnSignature(), agreed: true, device: DEVICE, ip: "" }),
        /full name/,
      );
      const signed = await signAtDoorstep({ claimId: "c1", actorId: "staff-driver", name: "Aled Morgan", signaturePng: drawnSignature(), agreed: true, device: DEVICE, ip: "192.168.1.20" });
      const view = latestEsign("c1");
      assert.equal(view?.route, "doorstep");
      assert.equal(view?.witnessName, "Demo Driver");
      assert.equal(view?.signedDocumentId, signed.documentId);
      const relpath = String(get<{ stored_relpath: string }>(`SELECT stored_relpath FROM documents WHERE id = ?`, [signed.documentId])?.stored_relpath);
      assert.match((await pdfText(relpath)).text, /Witnessed by: Demo Driver/);
      completeHireHandover({
        claimId: "c1",
        mileage: 100,
        fuelLevel: "full",
        driverId: "staff-driver",
        date: londonTodayIso(),
        // The car goes out after the client signs, so the handover time is now.
        time: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()),
        actorId: "staff-sian",
        submitKey: "doorstep-handover",
      });
      const agreement = get<{ signed: number; rate_pence_per_day: number }>(
        `SELECT a.signed, a.rate_pence_per_day FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = 'c1'`,
      );
      assert.equal(agreement?.signed, 1);
      assert.equal(agreement?.rate_pence_per_day, 6653);
    });
    db.close();
  });
});

describe("e-signing setup", () => {
  it("creates the signing table during migrate", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.ok(get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'esign_requests'`));
    });
    db.close();
  });
});

describe("what the client signs", () => {
  it("refuses an agreement that was produced with details missing, and leaves the CRM's page note off", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const agreement = readyForSigning();
      const html = String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = ?`, [agreement.documentId])?.body_html);
      assert.match(html, /class="internal-note"/);
      assert.doesNotMatch(clientAgreementHtml(html), /internal-note|The hire vehicle page is included/);
      db.prepare(`UPDATE documents SET missing_json = '["daily rate"]' WHERE id = ?`).run(agreement.documentId);
      await assert.rejects(
        () => sendSigningLink({ claimId: "c1", actorId: "staff-sian", to: "aled.morgan@example.test", origin: "http://localhost:3000" }),
        /produced with details missing/,
      );
    });
    db.close();
  });
});

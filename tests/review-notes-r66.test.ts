import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { all, get, run, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { saveReportOutcome } from "../src/lib/db/report-outcome.ts";
import { logEngineerReportReceived } from "../src/lib/db/chronology.ts";
import { approveDocument } from "../src/lib/db/document-approvals.ts";
import { signClientDocumentOnScreen, signClientDocumentWithLink } from "../src/lib/db/client-document-signing.ts";
import {
  recordTotalLossStepNine,
  resolveValuationDispute,
  saveTotalLossStepSix,
  sendValuationToClient,
  sendValuationToInsurer,
  totalLossStepSixLine,
  valuationState,
} from "../src/lib/db/total-loss-steps.ts";
import { loadClaimSteps } from "../src/lib/claims/load-claim-steps.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r66-"));
process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function signature(): string {
  const canvas = createCanvas(600, 180);
  const pen = canvas.getContext("2d");
  pen.beginPath();
  pen.moveTo(40, 120);
  pen.lineTo(520, 110);
  pen.stroke();
  return `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
}

/** A fictional total-loss file with the engineer's figures recorded at step 6. */
async function totalLossFile() {
  const form = new FormData();
  form.set("client_forename", "Tegwen");
  form.set("client_surname", "Colled");
  form.set("client_mobile", "07700900774");
  form.set("client_email", "tegwen.colled@example.test");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-10));
  form.set("accidentTime", "08:45");
  form.set("location", "A48, Pontarddulais (fictional)");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("veh_registration", "TE66 TLS");
  form.set("veh_make", "Ford");
  form.set("veh_model", "Fiesta");
  form.set("tp1_veh_registration", "TP66 ABC");
  form.set("tp1_insurerName", "Example Mutual Insurance");
  form.set("tp1_insurerEmail", "claims@example-mutual.test");
  const claim = await createClaimFromIntake(intakeFromFormData(form));
  // Step 5 keeps the engineer on the file.
  run(`UPDATE claims SET engineer_id = ? WHERE id = ?`, ["eng-test-assessor", claim.id]);
  const day = isoDateFromNow(-1);
  logEngineerReportReceived({ claimId: claim.id, actorId: "staff-sian", occurredAt: day });
  saveReportOutcome({ claimId: claim.id, actorId: "staff-sian", outcome: "total_loss", estimateNet: "", estimateVat: "", estimateGross: "", pav: "10000", salvageCategory: "S", salvageDeduction: "1000", occurredOn: day });
  saveTotalLossStepSix({ claimId: claim.id, inspectedOn: isoDateFromNow(-3), finance: "no", lender: "", casRequest: "" });
  return claim;
}

const step = (claimId: string, key: string) => loadClaimSteps(claimId)!.find((item) => item.key === key)!;

describe("R66 — steps 6 to 9 of a total loss, on the Steps page", () => {
  it("step 6 shows its figures; 7 is refused until Draft 8a is approved, then the client signs A by link and 7 is done", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await totalLossFile();
      assert.equal(totalLossStepSixLine(claim.id), "Total loss · £10,000.00 pre-accident · Cat S · salvage £1,000.00 · claiming £9,000.00 · no finance · report not uploaded");
      assert.match(String(step(claim.id, "engineer_report").detail), /^Total loss · £10,000\.00 pre-accident/);
      assert.deepEqual(step(claim.id, "agree").forms, ["tl_valuation"]);
      await assert.rejects(sendValuationToClient({ claimId: claim.id, actorId: "staff-sian", to: "tegwen.colled@example.test", attachReport: false, origin: "http://127.0.0.1" }), /needs Justin's approval/);

      approveDocument({ templateKey: "draft_tl_client", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      const link = await sendValuationToClient({ claimId: claim.id, actorId: "staff-sian", to: "tegwen.colled@example.test", attachReport: false, origin: "http://127.0.0.1" });
      assert.equal(step(claim.id, "agree").statusText, "Waiting on the client's signed answer");
      const token = link.url.split("/sign-form/")[1]!;
      await assert.rejects(signClientDocumentWithLink({ token, name: "Tegwen Colled", signaturePng: signature(), agreed: true, startNow: false, device: "phone", ip: "" }), /Tick option A, B or C/);
      await signClientDocumentWithLink({ token, name: "Tegwen Colled", signaturePng: signature(), agreed: true, startNow: false, device: "phone", ip: "", answer: { choice: "A", reason: "", finance: "no", lender: "" } });
      assert.equal(step(claim.id, "agree").state, "done");
      assert.equal(valuationState(claim.id).answer, "A");
      assert.match(totalLossStepSixLine(claim.id), /claiming £10,000\.00/, "A asks for the pre-accident value; the salvage is released");

      // Step 8: Draft 8b with the report and the signed acceptance; the payment chase starts.
      await assert.rejects(sendValuationToInsurer({ claimId: claim.id, actorId: "staff-sian", to: "claims@example-mutual.test", cc: "" }), /needs Justin's approval/);
      approveDocument({ templateKey: "draft_tl_insurer", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      await sendValuationToInsurer({ claimId: claim.id, actorId: "staff-sian", to: "claims@example-mutual.test", cc: "" });
      const sent = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'total_loss_notice_sent'`, [claim.id]);
      assert.match(String(sent?.details), /asking for £10,000\.00\. The payment chase starts from this time/);
      const email = get<{ attachments_json: string }>(`SELECT attachments_json FROM correspondence WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1`, [claim.id]);
      assert.equal(JSON.parse(String(email?.attachments_json)).length, 2, "the letter and the client's signed acceptance (no report uploaded on this file)");
      assert.equal(step(claim.id, "send_report").state, "done");

      // Step 9: payment and salvage on the card.
      const said = recordTotalLossStepNine({ claimId: claim.id, actorId: "staff-sian", paymentPence: 1_000_000, submitKey: "r66-pay-1", salvageCollectedOn: isoDateFromNow(0), proceedsPence: 95_000 });
      assert.match(said, /Payment of £10,000\.00 recorded\. Salvage collected/);
      assert.ok(get<{ id: string }>(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'salvage_collected'`, [claim.id]));
    });
    db.close();
  });

  it("the client choosing C sets a task and blocks step 8 until a handler resolves it; B asks net of salvage", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      approveDocument({ templateKey: "draft_tl_client", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      approveDocument({ templateKey: "draft_tl_insurer", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      const claim = await totalLossFile();
      const { generateClaimDocument } = await import("../src/lib/db/chronology.ts");
      generateClaimDocument({ claimId: claim.id, templateKey: "draft_tl_client", actorId: "staff-sian", recordOnFile: false });
      await signClientDocumentOnScreen({
        claimId: claim.id,
        key: "draft_tl_client",
        actorId: "staff-sian",
        name: "Tegwen Colled",
        signaturePng: signature(),
        agreed: true,
        startNow: false,
        device: "test",
        ip: "",
        answer: { choice: "C", reason: "Similar cars advertised at £11,500.", finance: "yes", lender: "Example Finance (fictional)" },
      });
      assert.equal(valuationState(claim.id).disputeOpen, true);
      assert.equal(step(claim.id, "agree").statusText, "Client disputes valuation");
      assert.deepEqual(step(claim.id, "send_report").forms, [], "step 8 waits");
      assert.ok(all<{ title: string }>(`SELECT title FROM tasks WHERE claim_id = ?`, [claim.id]).some((task) => /^Client disputes valuation – TEST-/.test(task.title)));
      await assert.rejects(sendValuationToInsurer({ claimId: claim.id, actorId: "staff-sian", to: "claims@example-mutual.test", cc: "" }), /disputes the valuation/);
      resolveValuationDispute({ claimId: claim.id, actorId: "staff-sian", note: "Engineer revised the value; new valuation to follow." });
      assert.equal(valuationState(claim.id).disputeOpen, false);
    });
    db.close();
  });
});

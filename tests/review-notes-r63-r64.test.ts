import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, run, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { updateClaimWorkflowStatus } from "../src/lib/db/queries.ts";
import { generateClaimDocument, letterPreview } from "../src/lib/db/chronology.ts";
import { actOnFirstLetter, firstLettersFor, firstLettersView } from "../src/lib/db/first-letters.ts";
import { approveDocument, isDocumentApproved } from "../src/lib/db/document-approvals.ts";
import { unapprovedLegalAttachment } from "../src/lib/db/legal-approval.ts";
import { DRAFT_WORDING_NOT_APPROVED } from "../src/lib/documents/template-approval.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r63-"));
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

/** A fictional file with the given liability status. */
async function newFile(claimType: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("client_forename", "Llinos");
  form.set("client_surname", "Llythyr");
  form.set("client_mobile", "07700900772");
  form.set("client_email", "llinos.llythyr@example.test");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-2));
  form.set("accidentTime", "09:30");
  form.set("location", "A483, Llandeilo (fictional)");
  form.set("claimType", claimType);
  form.set("roadworthiness", "roadworthy");
  form.set("veh_registration", "TE63 LTR");
  form.set("veh_make", "Ford");
  form.set("veh_model", "Focus");
  form.set("tp1_veh_registration", "TP63 ABC");
  form.set("tp1_insurerName", "Example Mutual Insurance");
  form.set("tp1_insurerEmail", "claims@example-mutual.test");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return createClaimFromIntake(intakeFromFormData(form));
}

const keys = (status: string) => firstLettersFor(status).map((entry) => entry.key);

describe("R63/R64 — first letters by liability status, and the draft documents", () => {
  it("picks the pack from the drafts table; a fault file never gets the initial letter to the third-party insurer", () => {
    assert.deepEqual(keys("non_fault"), ["initial_tp_insurer", "draft_own_insurer_notice", "client_welcome", "draft_client_authority"]);
    assert.deepEqual(keys("fault"), ["draft_own_insurer_network", "client_welcome_fault", "draft_repair_authority"]);
    assert.deepEqual(keys("split"), ["draft_split_tp", "draft_own_insurer_network", "draft_split_client", "draft_client_authority"]);
    assert.deepEqual(keys("disputed"), ["draft_liability_position", "draft_own_insurer_notice", "client_welcome", "draft_client_authority"]);
    assert.deepEqual(keys(""), keys("disputed"), "not yet known uses the disputed letters");
    assert.equal(keys("fault").includes("initial_tp_insurer"), false);
  });

  it("marks every draft as waiting for approval, refuses to send or mark it sent, and keeps it out of email attachments", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile("non_fault");
      const view = firstLettersView(claim.id)!;
      assert.equal(view.items.find((item) => item.key === "initial_tp_insurer")?.approved, true, "CAS's supplied letter needs no approval");
      const authority = view.items.find((item) => item.key === "draft_client_authority")!;
      assert.equal(authority.approved, false);
      assert.match(authority.html, new RegExp(DRAFT_WORDING_NOT_APPROVED));
      await assert.rejects(actOnFirstLetter({ claimId: claim.id, actorId: "staff-sian", key: "draft_client_authority", intent: "send" }), /waiting for Justin's approval/);
      await assert.rejects(actOnFirstLetter({ claimId: claim.id, actorId: "staff-sian", key: "draft_client_authority", intent: "mark_sent" }), /waiting for Justin's approval/);
      const generated = await actOnFirstLetter({ claimId: claim.id, actorId: "staff-sian", key: "draft_client_authority", intent: "generate" });
      assert.match(String(unapprovedLegalAttachment(claim.id, [generated.documentId])), /waiting for Justin's approval of the wording/);
      assert.throws(() => generateClaimDocument({ claimId: claim.id, templateKey: "draft_own_insurer_notice", actorId: "staff-sian", markSent: true }), /cannot be marked as sent yet/);
    });
    db.close();
  });

  it("needs Justin, and the solicitor's check date for Drafts 1, 2, 4 and 5, before a draft is approved", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      assert.throws(() => approveDocument({ templateKey: "draft_client_authority", actorId: "staff-sian", solicitorCheckedOn: isoDateFromNow(-1) }), /Only Justin/);
      assert.throws(() => approveDocument({ templateKey: "draft_client_authority", actorId: "staff-justin" }), /date the solicitor checked/);
      approveDocument({ templateKey: "draft_client_authority", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      assert.equal(isDocumentApproved("draft_client_authority"), true);
      approveDocument({ templateKey: "draft_own_insurer_network", actorId: "staff-justin" });
      assert.equal(isDocumentApproved("draft_own_insurer_network"), true, "Draft 3 needs no solicitor date");
      assert.throws(() => approveDocument({ templateKey: "draft_courtesy_car", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) }), /outline only/);
    });
    db.close();
  });

  it("fault file: the own-insurer letter asks for the claim reference and network code, and sending it does step 4", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile("fault");
      const letter = letterPreview(claim.id, "draft_own_insurer_network");
      assert.match(letter.text, /your network \(approved repairer\) code, so that the repair can be networked to us/);
      assert.doesNotMatch(letter.text, /Your Reference:/, "the insurer's reference line is left out until it is held");
      approveDocument({ templateKey: "draft_own_insurer_network", actorId: "staff-justin" });
      run(`INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES (?, 'insurer', ?, ?)`, [claim.id, JSON.stringify({ email: "claims@own-insurer.test" }), new Date().toISOString()]);
      const sent = await actOnFirstLetter({ claimId: claim.id, actorId: "staff-sian", key: "draft_own_insurer_network", intent: "send" });
      assert.match(sent.outcome, /sent to claims@own-insurer.test \(simulated/);
      const step = get<{ n: number }>(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND event_type = 'initial_letter_own_insurer'`, [claim.id]);
      assert.equal(step?.n, 1);
    });
    db.close();
  });

  it("leaves out what is not held: the MID sentence with no MID search, and Draft 6's account until the handler types it", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile("disputed");
      const position = letterPreview(claim.id, "draft_liability_position");
      assert.doesNotMatch(position.text, /MID search/);
      assert.ok(position.missing.includes("Our client's account (typed or checked by the handler)"));
      const typed = generateClaimDocument({ claimId: claim.id, templateKey: "draft_liability_position", actorId: "staff-sian", accountLine: "our client was stationary at the lights" });
      assert.match(typed.letter.text, /Our client's account is that our client was stationary at the lights\. We reserve/);

      const withMid = await newFile("disputed", { midResult: "insurer", midCheckedOn: isoDateFromNow(-1), midRegistration: "TP63 ABC", midInsurerName: "Example Mutual Insurance", midPolicy: "POL-TEST-1" });
      assert.match(letterPreview(withMid.id, "draft_liability_position").text, /An MID search on .+ showed the vehicle insured by you under policy POL-TEST-1\./);
    });
    db.close();
  });

  it("changing Non-fault to Split offers 5a and 5b and keeps the letters already made", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile("non_fault");
      await actOnFirstLetter({ claimId: claim.id, actorId: "staff-sian", key: "client_welcome", intent: "send" });
      updateClaimWorkflowStatus(claim.id, { liabilityStatus: "split", splitTpPercent: "50" }, "staff-sian");
      const view = firstLettersView(claim.id)!;
      const now = view.items.map((item) => item.key);
      assert.ok(now.includes("draft_split_tp") && now.includes("draft_split_client"));
      assert.match(view.items.find((item) => item.key === "draft_split_tp")!.html, /shared 50% \/ 50%/);
      assert.deepEqual(view.earlier.map((item) => item.key), ["client_welcome"], "the welcome already sent stays on the file");
      assert.equal(view.earlier[0]!.done?.action, "sent");
    });
    db.close();
  });
});

describe("R64 — the client signs Drafts 1 and 2 like the hire agreement", () => {
  it("refuses until approved and produced after approval, needs the clause tick, then signs on screen and by link", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(600, 180);
    const pen = canvas.getContext("2d");
    pen.beginPath();
    pen.moveTo(40, 120);
    pen.lineTo(520, 110);
    pen.stroke();
    const signaturePng = `data:image/png;base64,${canvas.encodeSync("png").toString("base64")}`;
    const signing = await import("../src/lib/db/client-document-signing.ts");
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile("non_fault", { client_postcode: "SA19 6AA", client_address: "1 Fictional Row", client_town: "Llandeilo" });
      assert.match(String(signing.signingRefusal(claim.id, "draft_client_authority")), /waiting for Justin's approval/);
      generateClaimDocument({ claimId: claim.id, templateKey: "draft_client_authority", actorId: "staff-sian" });
      approveDocument({ templateKey: "draft_client_authority", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      assert.match(String(signing.signingRefusal(claim.id, "draft_client_authority")), /produced before Justin approved/);
      generateClaimDocument({ claimId: claim.id, templateKey: "draft_client_authority", actorId: "staff-sian" });
      assert.equal(signing.signingRefusal(claim.id, "draft_client_authority"), null);
      const screen = { claimId: claim.id, key: "draft_client_authority" as const, actorId: "staff-sian", name: "Llinos Llythyr", signaturePng, agreed: true, device: "test", ip: "127.0.0.1" };
      await assert.rejects(signing.signClientDocumentOnScreen({ ...screen, startNow: false }), /tick clause 10/);
      await signing.signClientDocumentOnScreen({ ...screen, startNow: true });
      const signed = signing.clientDocumentSignature(claim.id, "draft_client_authority");
      assert.equal(signed?.route, "screen");
      assert.equal(get<{ document_type: string }>(`SELECT document_type FROM documents WHERE id = ?`, [signed!.signedDocumentId])?.document_type, "signed_draft_client_authority");

      // Draft 2 by link, on a fault file.
      const fault = await newFile("fault", { client_postcode: "SA19 6AA", client_address: "1 Fictional Row", client_town: "Llandeilo" });
      run(`UPDATE claims SET own_insurer_name = 'Example Own Insurance', own_policy_ref = 'POL-OWN-1', own_excess_pence = 25000 WHERE id = ?`, [fault.id]);
      approveDocument({ templateKey: "draft_repair_authority", actorId: "staff-justin", solicitorCheckedOn: isoDateFromNow(-1) });
      generateClaimDocument({ claimId: fault.id, templateKey: "draft_repair_authority", actorId: "staff-sian" });
      const link = await signing.sendClientDocumentLink({ claimId: fault.id, key: "draft_repair_authority", actorId: "staff-sian", to: "llinos.llythyr@example.test", origin: "http://127.0.0.1" });
      const token = link.url.split("/sign-form/")[1]!;
      assert.equal(signing.openClientDocumentLink(token).tickClause, "9");
      await assert.rejects(signing.signClientDocumentWithLink({ token, name: "Llinos Llythyr", signaturePng, agreed: true, startNow: false, device: "phone", ip: "" }), /tick clause 9/);
      await signing.signClientDocumentWithLink({ token, name: "Llinos Llythyr", signaturePng, agreed: true, startNow: true, device: "phone", ip: "" });
      assert.equal(signing.clientDocumentSignature(fault.id, "draft_repair_authority")?.route, "link");
      assert.throws(() => signing.openClientDocumentLink(token), /already been signed/);
    });
    db.close();
  });
});

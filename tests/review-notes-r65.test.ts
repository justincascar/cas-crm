import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { all, get, run, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  defaultEngineerFor,
  dispatchView,
  instructionContent,
  instructionGaps,
  saveEngineerDispatchSettings,
  sendEngineerInstruction,
  sendToAudatexEstimator,
} from "../src/lib/db/engineer-dispatch.ts";
import { SEEDED_ENGINEER } from "../src/lib/db/engineers.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r65-"));
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

async function newFile(withLocation = true) {
  const form = new FormData();
  form.set("client_forename", "Peredur");
  form.set("client_surname", "Peiriannydd");
  form.set("client_mobile", "07700900773");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-2));
  form.set("accidentTime", "09:30");
  form.set("location", "A40, Carmarthen (fictional)");
  form.set("circumstances", "Fictional: client stationary, hit from behind.");
  form.set("damageDescription", "Rear bumper and boot lid pushed in.");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("veh_registration", "TE65 ENG");
  form.set("veh_make", "Ford");
  form.set("veh_model", "Focus");
  form.set("veh_colour", "Blue");
  form.set("tp1_veh_registration", "TP65 ABC");
  form.set("tp1_insurerName", "Example Mutual Insurance");
  const claim = await createClaimFromIntake(intakeFromFormData(form));
  if (withLocation) {
    run(`INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES (?, 'vehicle', ?, ?)`, [
      claim.id,
      JSON.stringify({ clientLocation1: "CAS yard, 171 Cwmgarw Road, Brynamman", clientLocationPostcode: "SA18 1DG" }),
      new Date().toISOString(),
    ]);
  }
  return claim;
}

function addPhoto(claimId: string) {
  const dir = process.env.CAS_FILES_DIR!;
  const rel = `claims/${claimId}/photo-${Math.random().toString(36).slice(2)}.jpg`;
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]));
  run(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, original_filename, stored_relpath, mime_type, byte_size, created_at)
     VALUES (?, ?, 'Damage photo', 'file', 'other', 'damage.jpg', ?, 'image/jpeg', 10, ?)`,
    [`doc-photo-${Math.random().toString(36).slice(2)}`, claimId, rel, new Date().toISOString()],
  );
}

describe("R65 — step 5 sends the engineer and Audatex instructions in one click", () => {
  it("sends the instruction to the fictional engineer on a TEST file with everything, the PDF and photos, the handler copied in", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile();
      addPhoto(claim.id);
      assert.equal(defaultEngineerFor(claim.id), SEEDED_ENGINEER.id, "TEST files use the fictional engineer (R40)");
      assert.deepEqual(instructionGaps(claim.id, SEEDED_ENGINEER.id), []);
      const content = instructionContent(claim.id, SEEDED_ENGINEER.id);
      for (const expected of [/TE65 ENG/, /07700 ?900773/, /Blue/, /stationary, hit from behind/, /boot lid/, /Unroadworthy/, /Example Mutual Insurance/, /Liability status: Non-fault/, /pre-accident value and the salvage category/, /Handler: Sian Evans/]) {
        assert.match(content.body, expected);
      }
      const sent = await sendEngineerInstruction({ claimId: claim.id, actorId: "staff-sian", engineerId: SEEDED_ENGINEER.id, sendWithoutPhotos: false });
      assert.equal(sent.simulated, true);
      const email = get<{ to_address: string; attachments_json: string }>(`SELECT to_address, attachments_json FROM correspondence WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1`, [claim.id]);
      assert.match(String(email?.to_address), new RegExp(`^${SEEDED_ENGINEER.email}; cc `));
      assert.equal(JSON.parse(String(email?.attachments_json)).length, 2, "the instruction PDF and one photo");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'engineer_instructed'`, [claim.id]);
      assert.match(String(event?.details), /^Instruction sent to Rhodri Testun/);
    });
    db.close();
  });

  it("blocks a file with no vehicle location, and warns (not blocks) when there are no photos", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const noLocation = await newFile(false);
      const gaps = instructionGaps(noLocation.id, SEEDED_ENGINEER.id);
      assert.ok(gaps.some((gap) => gap.blocking && gap.label === "No vehicle location recorded on the file" && gap.href.endsWith("/details/vehicle")));
      await assert.rejects(sendEngineerInstruction({ claimId: noLocation.id, actorId: "staff-sian", engineerId: SEEDED_ENGINEER.id, sendWithoutPhotos: true }), /Not sent\. Missing: No vehicle location/);

      const noPhotos = await newFile();
      assert.ok(instructionGaps(noPhotos.id, SEEDED_ENGINEER.id).every((gap) => !gap.blocking));
      await assert.rejects(sendEngineerInstruction({ claimId: noPhotos.id, actorId: "staff-sian", engineerId: SEEDED_ENGINEER.id, sendWithoutPhotos: false }), /no photos on the file/);
      await sendEngineerInstruction({ claimId: noPhotos.id, actorId: "staff-sian", engineerId: SEEDED_ENGINEER.id, sendWithoutPhotos: true });
    });
    db.close();
  });

  it("Audatex: the estimator from Settings gets a task due today; both can be sent from the same file", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      saveEngineerDispatchSettings({ defaultEngineerId: "", extraCc: "claims.shared@example.test", estimatorId: "staff-tom" });
      const claim = await newFile();
      addPhoto(claim.id);
      await sendEngineerInstruction({ claimId: claim.id, actorId: "staff-sian", engineerId: SEEDED_ENGINEER.id, sendWithoutPhotos: false });
      const email = get<{ to_address: string }>(`SELECT to_address FROM correspondence WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1`, [claim.id]);
      assert.match(String(email?.to_address), /claims\.shared@example\.test/, "the extra CC from Settings");
      const handed = await sendToAudatexEstimator({ claimId: claim.id, actorId: "staff-sian" });
      assert.equal(handed.estimatorName, "Tom Hughes");
      const tasks = all<{ title: string; handler_id: string }>(`SELECT title, handler_id FROM tasks WHERE claim_id = ?`, [claim.id]);
      assert.ok(tasks.some((task) => task.handler_id === "staff-tom" && /^Prepare Audatex estimate – TEST-/.test(task.title)));
      const view = dispatchView(claim.id, "Chosen: engineer and Audatex.");
      assert.match(String(view.instructed?.details), /^Instruction sent to Rhodri Testun/);
      assert.match(String(view.audatexSent?.details), /^Sent to Tom Hughes for the Audatex estimate/);
      assert.throws(() => saveEngineerDispatchSettings({ defaultEngineerId: "", extraCc: "not-an-email", estimatorId: "" }), /not an email address/);
    });
    db.close();
  });
});

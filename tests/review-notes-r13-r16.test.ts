import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { chaseForClaim } from "../src/lib/db/chase.ts";
import { generateClaimDocument, letterPreview, recordClaimEvent } from "../src/lib/db/chronology.ts";
import { all, get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { unapprovedLegalAttachment } from "../src/lib/db/legal-approval.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { cardFeeOnAmount, recoveryCardFeePercent, setRecoveryCardFeePercent } from "../src/lib/db/recovery-fee-settings.ts";
import { seed } from "../src/lib/db/seed.ts";
import { recoveryClaimForClaim } from "../src/lib/db/storage-charge.ts";
import { isoDateFromNow, nowUtcIso } from "../src/lib/dates.ts";
import { describeSendingHours } from "../src/lib/domain/sending-hours.ts";
import { GTA_DRAFT_MARK, GTA_STATEMENT_APPROVED, GTA_STATEMENT_TEXT, withGtaStatement } from "../src/lib/documents/gta-statement.ts";
import { sendBlockedForUnapproved } from "../src/lib/documents/template-approval.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r13-"));
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

async function newClaim() {
  const form = new FormData();
  form.set("client_forename", "Bethan");
  form.set("client_surname", "Review");
  form.set("client_mobile", "07700900321");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-6));
  form.set("accidentTime", "09:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  return createClaimFromIntake(intakeFromFormData(form));
}

function reportSent(claimId: string) {
  recordClaimEvent({
    claimId,
    eventType: "engineer_report_sent_to_insurer",
    occurredAt: nowUtcIso(),
    details: "Report and estimate sent to the insurer.",
    actorId: "staff-sian",
    source: "staff",
  });
}

describe("Review notes R13–R16", () => {
  it("R13: sending the report to the insurer starts the 3-day chase, worded for the outcome on the file", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const unknown = await newClaim();
      assert.equal(chaseForClaim("repair_authorisation", unknown.id)?.clockAt ?? null, null, "no chase before the report is sent");
      reportSent(unknown.id);
      const started = get<{ details: string }>(
        `SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`,
        [unknown.id],
      );
      assert.match(String(started?.details), /for its decision on the vehicle damage claim.*Outcome: not set yet/);
      assert.ok(chaseForClaim("repair_authorisation", unknown.id)?.clockAt, "the chase clock is running");
      const task = get<{ title: string }>(`SELECT title FROM tasks WHERE claim_id = ? AND title LIKE 'Set the outcome%'`, [unknown.id]);
      assert.ok(task, "the handler is asked to set the outcome");
      reportSent(unknown.id);
      assert.equal(
        all(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`, [unknown.id]).length,
        1,
        "recording the same send again does not start a second chase",
      );

      const totalLoss = await newClaim();
      run(`UPDATE claims SET total_loss = 1 WHERE id = ?`, [totalLoss.id]);
      reportSent(totalLoss.id);
      const tl = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`, [totalLoss.id]);
      assert.match(String(tl?.details), /total-loss payment \(the pre-accident value less salvage/);
      assert.equal(get(`SELECT id FROM tasks WHERE claim_id = ? AND title LIKE 'Set the outcome%'`, [totalLoss.id]), undefined);

      const repairable = await newClaim();
      run(
        `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES (?, 'assessed-damage', ?, ?)`,
        [repairable.id, JSON.stringify({ totalLoss: "no" }), nowUtcIso()],
      );
      reportSent(repairable.id);
      const rp = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`, [repairable.id]);
      assert.match(String(rp?.details), /to arrange payment of repairs/);
    });
    db.close();
    const chronology = read("src/lib/db/chronology.ts");
    assert.match(chronology, /repair payment outstanding/);
    assert.match(chronology, /total-loss payment outstanding/);
    assert.match(chronology, /decision outstanding/);
  });

  it("R14: the chaser sending hours are Monday to Friday, 09:00 to 17:00, and shown as confirmed", () => {
    assert.match(describeSendingHours({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }), /Monday to Friday/);
    const settings = read("src/app/settings/page.tsx");
    assert.doesNotMatch(settings, /Not yet confirmed by CAS/);
    assert.match(settings, /Justin confirmed Monday to Friday, 09:00 to 17:00 UK time on 29\/10\/2026/);
  });

  it("R15 (changed by R19): the recovery form has no card fee tick; the percentage stays in Settings", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      assert.equal(recoveryCardFeePercent(), 4.5);
      const recoveryForm = (extra: Record<string, string> = {}) => {
        const form = new FormData();
        form.set("arrivedDate", isoDateFromNow(-5));
        form.set("arrivedTime", "11:00");
        form.set("recoveryLocation", "M4 junction 33");
        form.set("carCondition", "Rear quarter crushed.");
        form.set("notDriveable", "obstructing");
        form.set("recoveryTick_standard", "yes");
        form.set("recoveryAmount_standard", "395");
        for (const [key, value] of Object.entries(extra)) form.set(key, value);
        return form;
      };
      const lines = (claimId: string) =>
        JSON.parse(String(get<{ charge_lines_json: string }>(`SELECT charge_lines_json FROM recovery_jobs WHERE claim_id = ?`, [claimId])?.charge_lines_json || "[]")) as Array<{
          key: string;
          label: string;
          netPence: number;
          vatPence: number;
        }>;

      const plain = await newClaim();
      recordRecoveryDone({ claimId: plain.id, actorId: "staff-sian", form: recoveryForm() });
      assert.equal(lines(plain.id).some((line) => line.key === "cardFee"), false, "no card fee unless ticked");

      const card = await newClaim();
      recordRecoveryDone({ claimId: card.id, actorId: "staff-sian", form: recoveryForm({ recoveryTick_cardFee: "yes" }) });
      assert.equal(lines(card.id).some((line) => line.key === "cardFee"), false, "an old tick in a posted form adds nothing");
      assert.equal(recoveryClaimForClaim(card.id).netPence, 39500);
      assert.equal(cardFeeOnAmount(47400, 4.5), 2133);

      setRecoveryCardFeePercent("3");
      assert.equal(recoveryCardFeePercent(), 3);
      assert.throws(() => setRecoveryCardFeePercent("lots"), /percentage/);
    });
    db.close();
    assert.doesNotMatch(read("src/components/claims/RecoveryFeeFields.tsx"), /recoveryTick_cardFee/);
  });

  it("R16 (approved by R20): the not-a-GTA-subscriber paragraph is optional and carries no draft mark", () => {
    assert.equal(GTA_STATEMENT_APPROVED, true);
    const body = "Dear Sirs,\n\nText.\n\nYours faithfully,\n\nSian";
    const added = withGtaStatement(body);
    assert.ok(added.indexOf(GTA_STATEMENT_TEXT) < added.indexOf("Yours faithfully"));
    assert.ok(!added.includes(GTA_DRAFT_MARK));
    assert.equal(sendBlockedForUnapproved({ templateKey: "rebuttal_rate", body: added }), null, "the approved paragraph does not block sending");

    const db = prepared();
    withDatabase(db, () => {
      const without = letterPreview("c1", "rebuttal_rate");
      assert.ok(!without.html.includes("General Terms of Agreement"), "off unless ticked");
      const withIt = letterPreview("c1", "rebuttal_rate", undefined, undefined, true);
      assert.ok(withIt.html.includes("not a subscriber to the General Terms of Agreement"));
      const cover = letterPreview("c1", "hire_pack_cover", undefined, undefined, true);
      assert.ok(cover.html.includes("not a subscriber to the General Terms of Agreement"), "offered on the payment pack cover letter");
      const other = letterPreview("c1", "liability_chaser", undefined, undefined, true);
      assert.ok(!other.html.includes("General Terms of Agreement"), "only on the rebuttals and the payment pack");

      const made = generateClaimDocument({ claimId: "c1", templateKey: "hire_pack_cover", actorId: "staff-sian", recordOnFile: false, includeGtaStatement: true });
      assert.equal(unapprovedLegalAttachment("c1", [made.documentId]), null);
      const plain = generateClaimDocument({ claimId: "c1", templateKey: "hire_pack_cover", actorId: "staff-sian", recordOnFile: false });
      assert.equal(unapprovedLegalAttachment("c1", [plain.documentId]), null);
    });
    db.close();
  });
});

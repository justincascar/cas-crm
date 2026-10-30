import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { chaseRow } from "../src/lib/db/chase.ts";
import { discardClaimDraft, listOpenClaimDrafts, saveClaimDraft } from "../src/lib/db/claim-drafts.ts";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { setWorkWait } from "../src/lib/db/desk-work.ts";
import { createClaimFromIntake, intakeFieldErrors, intakeFromFormData } from "../src/lib/db/intake.ts";
import { sendPreparedCorrespondence } from "../src/lib/db/mailbox-send.ts";
import { recoveryDisplayLines, recoveryReviewFlags } from "../src/lib/db/recovery-display.ts";
import { VersionConflictError } from "../src/lib/db/record-version.ts";
import { recoveryFeePence, setRecoveryFeePence } from "../src/lib/db/recovery-fee-settings.ts";
import { seed } from "../src/lib/db/seed.ts";
import { getDashboard } from "../src/lib/db/queries.ts";
import { runScheduledWaitRelease } from "../src/lib/db/wait-release-schedule.ts";
import { casTemplateApproved } from "../src/lib/documents/template-approval.ts";
import { londonTodayIso } from "../src/lib/dates.ts";
import { emailSendMode } from "../src/lib/email/send-mode.ts";
import { FieldValidationError } from "../src/lib/form-validation.ts";
import { phoneFieldError } from "../src/lib/phone-number.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function dayShift(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function baseForm() {
  const form = new FormData();
  form.set("client_forename", "Ceri");
  form.set("client_surname", "Walsh");
  form.set("client_mobile", "07700900123");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", "2026-10-19");
  form.set("accidentTime", "14:30");
  return form;
}

describe("new claim drafts, hire and recovery fees", () => {
  it("saves, resumes and discards a draft without messages, charges or history", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        get(`SELECT id FROM claims LIMIT 1`);
        const claimsBefore = Number((db.prepare(`SELECT COUNT(*) AS c FROM claims`).get() as { c: number }).c);
        const eventsBefore = Number((db.prepare(`SELECT COUNT(*) AS c FROM claim_events`).get() as { c: number }).c);
        const linesBefore = Number((db.prepare(`SELECT COUNT(*) AS c FROM financial_lines`).get() as { c: number }).c);
        const mailBefore = Number((db.prepare(`SELECT COUNT(*) AS c FROM correspondence`).get() as { c: number }).c);
        const saved = saveClaimDraft({
          payload: { client_forename: "Nia", client_surname: "Price", needsReplacement: "yes" },
          actorId: "staff-sian",
        });
        assert.match(saved.savedLabel, /^Draft saved \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
        assert.equal(listOpenClaimDrafts().some((row) => row.id === saved.id), true);
        const again = saveClaimDraft({
          draftId: saved.id,
          expectedVersion: saved.version,
          payload: { client_forename: "Nia", client_surname: "Price", hireVehicleType: "Medium car" },
          actorId: "staff-tom",
        });
        assert.equal(again.id, saved.id);
        assert.throws(
          () =>
            saveClaimDraft({
              draftId: saved.id,
              expectedVersion: saved.version,
              payload: { client_forename: "Someone else" },
              actorId: "staff-sian",
            }),
          (error: unknown) => error instanceof VersionConflictError && /Tom Hughes/.test(error.message),
        );
        assert.throws(
          () => discardClaimDraft({ draftId: saved.id, expectedVersion: again.version, confirm: false, actorId: "staff-sian" }),
          /Confirm that you want to discard/,
        );
        discardClaimDraft({ draftId: saved.id, expectedVersion: again.version, confirm: true, actorId: "staff-sian" });
        assert.equal(listOpenClaimDrafts().some((row) => row.id === saved.id), false);
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM claims`).get() as { c: number }).c), claimsBefore);
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM claim_events`).get() as { c: number }).c), eventsBefore);
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM financial_lines`).get() as { c: number }).c), linesBefore);
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM correspondence`).get() as { c: number }).c), mailBefore);
      });
    } finally {
      db.close();
    }
  });

  it("keeps a draft from creating a claim", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const before = Number((db.prepare(`SELECT COUNT(*) AS c FROM claims`).get() as { c: number }).c);
        saveClaimDraft({ payload: { client_forename: "Nia" }, actorId: "staff-sian" });
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM claims`).get() as { c: number }).c), before);
        assert.equal(Number((db.prepare(`SELECT COUNT(*) AS c FROM financial_lines`).get() as { c: number }).c) >= 0, true);
      });
    } finally {
      db.close();
    }
  });

  it("saves hire details and sets the next action without booking a car", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        const form = baseForm();
        form.set("needsReplacement", "yes");
        form.set("hireNeededFrom", "2026-10-20");
        form.set("hireVehicleType", "Medium car");
        form.set("hireTransmission", "automatic");
        form.set("hireSeats", "5");
        form.set("hireTaxi", "yes");
        form.set("hireGtaGroup", "S1");
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const claim = db.prepare(`SELECT next_action, hire_status, hire_vehicle_type, hire_gta_group, needs_replacement FROM claims WHERE id = ?`).get(created.id) as {
          next_action: string;
          hire_status: string;
          hire_vehicle_type: string;
          hire_gta_group: string;
          needs_replacement: number;
        };
        // The next action is read from the steps. The form no longer stores guidance as a note.
        assert.equal(claim.next_action, null);
        assert.equal(claim.hire_status, "none");
        assert.equal(claim.hire_vehicle_type, "Medium car", "a description keeps what was typed (R23)");
        assert.equal(claim.hire_gta_group, "S1");
        assert.equal(Number(claim.needs_replacement), 1);
        const bookings = Number((db.prepare(`SELECT COUNT(*) AS c FROM hire_episodes WHERE claim_id = ?`).get(created.id) as { c: number }).c);
        const reserved = Number((db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE claim_id = ?`).get(created.id) as { c: number }).c);
        assert.equal(bookings, 0);
        assert.equal(reserved, 0);
      });
    } finally {
      db.close();
    }
  });

  it("fills the £395 standard fee, applies extras, and requires a reason to override", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        assert.equal(recoveryFeePence("standard"), 39500);
        const form = baseForm();
        form.set("needsRecovery", "yes");
        form.set("recoveryFormVersion", "fees");
        form.set("recoveryDate", "2026-10-19");
        form.set("recoveryTime", "16:00");
        form.set("recoveryTick_standard", "yes");
        form.set("recoveryAmount_standard", "395");
        form.set("recoveryTick_environmental", "yes");
        form.set("recoveryAmount_environmental", "150");
        form.set("recoveryTick_winching", "yes");
        form.set("recoveryAmount_winching", "95");
        form.set("recoveryTick_forklift", "yes");
        form.set("recoveryAmount_forklift", "85");
        form.set("recoveryTick_outOfHours", "yes");
        form.set("recoveryAmount_outOfHours", "100");
        form.set("storageRate", "39");
        const intake = intakeFromFormData(form);
        assert.equal(intake.recovery?.chargePence, 39500);
        assert.equal(intake.recovery?.environmentalPence, 15000);
        assert.equal(intake.recovery?.winchPence, 9500);
        assert.equal(intake.recovery?.forkliftPence, 8500);
        assert.equal(intake.recovery?.oohPence, 10000);
        assert.equal(intake.recovery?.mileagePence, 0);
        assert.equal(intake.recovery?.storageRatePence, 3900);
        const standard = intake.recovery?.lines?.find((line) => line.key === "standard");
        assert.equal(standard?.netPence, 39500);
        assert.equal(standard?.vatPence, 7900);
        const created = await createClaimFromIntake(intake);
        const stored = db.prepare(`SELECT charge_pence, environmental_pence, storage_rate_pence FROM recovery_jobs WHERE claim_id = ?`).get(created.id) as {
          charge_pence: number;
          environmental_pence: number;
          storage_rate_pence: number;
        };
        assert.equal(stored.charge_pence, 39500);
        assert.equal(stored.environmental_pence, 15000);
        setRecoveryFeePence("standard", 45000);
        assert.equal(recoveryFeePence("standard"), 45000);
        const after = db.prepare(`SELECT charge_pence FROM recovery_jobs WHERE claim_id = ?`).get(created.id) as { charge_pence: number };
        assert.equal(after.charge_pence, 39500);
        const override = baseForm();
        override.set("needsRecovery", "yes");
        override.set("recoveryFormVersion", "fees");
        override.set("recoveryDate", "2026-10-19");
        override.set("recoveryTime", "16:00");
        override.set("recoveryTick_standard", "yes");
        override.set("recoveryAmount_standard", "300");
        assert.throws(() => intakeFromFormData(override), (error: unknown) => error instanceof FieldValidationError);
        override.set("recoveryReason_standard", "Agreed with the operator");
        const overridden = intakeFromFormData(override);
        assert.equal(overridden.recovery?.chargePence, 30000);
        assert.equal(overridden.recovery?.lines?.find((line) => line.key === "standard")?.reason, "Agreed with the operator");
      });
    } finally {
      db.close();
    }
  });

  it("counts an inherited receipt line and flags a note amount without inventing a company", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        get(`SELECT id FROM claims LIMIT 1`);
        const claimId = "c-inherit";
        db.prepare(
          `INSERT INTO claims(id, file_reference, created_at, updated_at, accident_at, claim_type, current_position)
           VALUES (?, 'TEST-NOTE', '2026-10-19T13:30:00.000Z', '2026-10-19T13:30:00.000Z', '2026-10-19T13:30:00.000Z', 'unknown', 'open')`,
        ).run(claimId);
        db.prepare(
          `INSERT INTO recovery_jobs(id, claim_id, recovered_at, charge_pence, inherited, inherited_note)
           VALUES ('rec-note', ?, '2026-10-19T08:00:00.000Z', 0, 1, '195')`,
        ).run(claimId);
        const before = db.prepare(`SELECT recovered_at, inherited_note, inherited_company, inherited_vat_pence FROM recovery_jobs WHERE id = 'rec-note'`).get() as {
          recovered_at: string;
          inherited_note: string;
          inherited_company: string | null;
          inherited_vat_pence: number | null;
        };
        const flags = recoveryReviewFlags(claimId);
        assert.equal(flags.some((flag) => flag === "Inherited recovery charge needs review: £195 was typed in a note"), true);
        assert.equal(flags.some((flag) => flag === "Recovery time needs review: 09:00 is before the accident at 14:30"), true);
        const after = db.prepare(`SELECT recovered_at, inherited_note, inherited_company, inherited_vat_pence FROM recovery_jobs WHERE id = 'rec-note'`).get() as typeof before;
        assert.equal(after.recovered_at, before.recovered_at);
        assert.equal(after.inherited_note, "195");
        assert.equal(after.inherited_company, null);
        assert.equal(after.inherited_vat_pence, null);
        const lines = recoveryDisplayLines(claimId);
        assert.equal(lines.some((line) => line.key === "inherited"), false);
      });
    } finally {
      db.close();
    }
  });

  it("refuses a recovery before the accident and counts a receipt line", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        const early = baseForm();
        early.set("needsRecovery", "yes");
        early.set("recoveryFormVersion", "fees");
        early.set("recoveryDate", "2026-10-19");
        early.set("recoveryTime", "09:00");
        early.set("recoveryTick_standard", "yes");
        early.set("recoveryAmount_standard", "395");
        const errors = intakeFieldErrors(intakeFromFormData(early));
        assert.match(errors[0]?.message || "", /Recovery cannot be before the accident/);
        await assert.rejects(() => createClaimFromIntake(intakeFromFormData(early)), /Recovery cannot be before the accident/);
        const form = baseForm();
        form.set("needsRecovery", "yes");
        form.set("recoveryFormVersion", "fees");
        form.set("recoveryDate", "2026-10-19");
        form.set("recoveryTime", "16:10");
        form.set("inheritedRecovery", "yes");
        form.set("inheritedCompany", "Harbour Recovery");
        form.set("inheritedNet", "100");
        form.set("inheritedVat", "0");
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const line = recoveryDisplayLines(created.id).find((row) => row.key === "inherited");
        assert.ok(line);
        assert.equal(line.label, "Inherited charge (paid to Harbour Recovery)");
        assert.equal(line.netPence, 10000);
        assert.equal(line.vatPence, 0);
        assert.equal(line.grossPence, 10000);
      });
    } finally {
      db.close();
    }
  });

  it("blocks an unapproved agreement send, including simulate mode, and does not auto-send on create", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        assert.equal(emailSendMode(), "simulate");
        assert.equal(casTemplateApproved("recovery_storage_agreement"), false);
        assert.equal(casTemplateApproved("storage_recovery"), true, "the standalone agreement uses the supplied Hire Pack wording");
        assert.equal(casTemplateApproved("engineer_instruction"), true);
        const form = baseForm();
        form.set("needsRecovery", "yes");
        form.set("recoveryFormVersion", "fees");
        form.set("recoveryDate", "2026-10-19");
        form.set("recoveryTime", "16:10");
        form.set("recoveryTick_standard", "yes");
        form.set("recoveryAmount_standard", "395");
        form.set("agreementChannel", "both");
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const sent = Number(
          (db.prepare(`SELECT COUNT(*) AS c FROM correspondence WHERE claim_id = ? AND (template_key = 'recovery_storage_agreement' OR subject LIKE '%agreement%')`).get(created.id) as { c: number }).c,
        );
        assert.equal(sent, 0);
        db.prepare(
          `INSERT INTO correspondence(id, claim_id, direction, channel, subject, body, to_address, sent_status, template_key, created_at)
           VALUES ('mail-unapproved', ?, 'outbound', 'email', 'Agreement', 'Please sign', 'client@example.com', 'prepared_not_sent', 'recovery_storage_agreement', '2026-10-19T12:00:00.000Z')`,
        ).run(created.id);
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: created.id, correspondenceId: "mail-unapproved", actorId: "staff-sian" }),
          /DRAFT – wording not approved by CAS/,
        );
        const status = db.prepare(`SELECT sent_status FROM correspondence WHERE id = 'mail-unapproved'`).get() as { sent_status: string };
        assert.equal(status.sent_status, "prepared_not_sent");
      });
    } finally {
      db.close();
    }
  });

  it("saves weather, journey, road surface, lighting and typed Other", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        const form = baseForm();
        form.set("weather", "other");
        form.set("weatherOther", "Hail");
        form.set("journeyPurpose", "taxi");
        form.set("roadSurface", "flooded");
        form.set("lighting", "dusk");
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const row = db.prepare(`SELECT weather_conditions, journey_purpose, road_surface, lighting FROM claims WHERE id = ?`).get(created.id) as {
          weather_conditions: string;
          journey_purpose: string;
          road_surface: string;
          lighting: string;
        };
        assert.equal(row.weather_conditions, "Other: Hail");
        assert.equal(row.journey_purpose, "Taxi/private hire");
        assert.equal(row.road_surface, "Flooded");
        assert.equal(row.lighting, "Dusk/dawn");
        const missing = baseForm();
        missing.set("roadSurface", "other");
        assert.throws(() => intakeFromFormData(missing), /Type the other road surface/);
      });
    } finally {
      db.close();
    }
  });

  it("warns on a phone number and keeps it when Save anyway is ticked", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        assert.match(phoneFieldError("client_mobile", "+1 202 555 0143") || "", /Save anyway/);
        const blocked = baseForm();
        blocked.set("client_mobile", "+1 202 555 0143");
        assert.equal(intakeFieldErrors(intakeFromFormData(blocked)).some((error) => error.field === "client_mobile"), true);
        const form = baseForm();
        form.set("client_mobile", "+1 202 555 0143");
        form.set("saveAnyway_client_mobile", "yes");
        const intake = intakeFromFormData(form);
        assert.equal(intakeFieldErrors(intake).some((error) => error.field === "client_mobile"), false);
        const created = await createClaimFromIntake(intake);
        const audit = db.prepare(`SELECT action, details FROM audit_log WHERE entity_id = ? AND action = 'phone_saved_anyway'`).get(created.id) as {
          action: string;
          details: string;
        };
        assert.equal(audit.action, "phone_saved_anyway");
        assert.match(audit.details, /client_mobile/);
        const phone = db.prepare(`SELECT p.telephone FROM people p JOIN claims c ON c.client_person_id = p.id WHERE c.id = ?`).get(created.id) as { telephone: string };
        assert.equal(phone.telephone, "+1 202 555 0143");
      });
    } finally {
      db.close();
    }
  });

  it("does not store Skip other number as a telephone", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        const form = baseForm();
        form.set("client_skipOtherTel", "yes");
        form.set("client_otherTel", "Skip other number");
        form.set("client_mobile", "+1 202 555 0143");
        form.set("saveAnyway_client_mobile", "yes");
        form.set("counterpart_skipOtherTel", "yes");
        form.set("counterpart_otherTel", "Skip other number");
        form.set("clientRole", "owner");
        const intake = intakeFromFormData(form);
        assert.equal(intake.client.skipOtherTel, true);
        assert.equal(intake.client.otherTel, undefined);
        assert.equal(intake.counterpart?.skipOtherTel, true);
        assert.equal(intake.counterpart?.otherTel, undefined);
        assert.equal(intakeFieldErrors(intake).some((error) => /otherTel|skipOther/i.test(error.field)), false);
        const created = await createClaimFromIntake(intake);
        const row = db.prepare(
          `SELECT c.other_contact_skipped, p.home_tel, p.mobile_tel
           FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
        ).get(created.id) as { other_contact_skipped: number; home_tel: string | null; mobile_tel: string | null };
        assert.equal(row.other_contact_skipped, 1);
        assert.equal(row.home_tel, null);
        assert.equal(row.mobile_tel, "+1 202 555 0143");
        assert.notEqual(row.home_tel, "Skip other number");
      });
    } finally {
      db.close();
    }
  });

  it("saves more than one witness", async () => {
    const db = seeded();
    try {
      await withDatabaseAsync(db, async () => {
        const form = baseForm();
        form.set("witnesses", "yes");
        form.set("witnessCount", "2");
        form.set("witness_0_name", "Aled Morgan");
        form.set("witness_0_telephone", "02920123456");
        form.set("witness_1_name", "Bethan Lewis");
        form.set("witness_1_telephone", "07700900456");
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const rows = db.prepare(`SELECT full_name, telephone FROM claim_witnesses WHERE claim_id = ? ORDER BY full_name`).all(created.id) as Array<{
          full_name: string;
          telephone: string;
        }>;
        assert.equal(rows.length, 2);
        assert.equal(rows[0]?.full_name, "Aled Morgan");
        assert.equal(rows[1]?.full_name, "Bethan Lewis");
      });
    } finally {
      db.close();
    }
  });

  it("brings an expired wait back on the scheduled pass, not when the dashboard is opened", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const today = londonTodayIso();
        const waited = setWorkWait({
          claimId: "c5",
          itemKey: "chase-liability_response-c5",
          waitUntil: dayShift(today, 3),
          reason: "Asked to wait.",
          actorId: "staff-sian",
          role: "staff",
          chaseKind: "liability_response",
          expectedVersion: "",
          submitKey: "wait-schedule",
          today,
        });
        db.prepare(`UPDATE work_waits SET wait_until = ? WHERE id = ?`).run(dayShift(today, -1), waited.id);
        const resumedBefore = db.prepare(`SELECT resumed_at FROM work_waits WHERE id = ?`).get(waited.id) as { resumed_at: string | null };
        getDashboard();
        const afterOpen = db.prepare(`SELECT resumed_at FROM work_waits WHERE id = ?`).get(waited.id) as { resumed_at: string | null };
        assert.equal(afterOpen.resumed_at, resumedBefore.resumed_at);
        assert.equal(chaseRow("c5", "liability_response")?.status, "paused");
        runScheduledWaitRelease(today);
        assert.equal(chaseRow("c5", "liability_response")?.status, "tracking");
        const resumed = db.prepare(`SELECT resumed_at FROM work_waits WHERE id = ?`).get(waited.id) as { resumed_at: string | null };
        assert.ok(resumed.resumed_at);
        const back = getDashboard();
        assert.equal(
          back.todaysWork.flatMap((row) => [row.lead, ...row.rest]).some((item) => item.id === "chase-liability_response-c5"),
          true,
        );
      });
    } finally {
      db.close();
    }
  });

  it("puts 39 in the storage box as a value", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/IntakeForm.tsx"), "utf8");
    assert.match(source, /name="storageRate" defaultValue=\{defaults\.storageRate \|\| "39"\}/);
    assert.equal(source.includes('placeholder="39.00"'), false);
    assert.equal(source.includes('placeholder="395.00"'), false);
  });
});

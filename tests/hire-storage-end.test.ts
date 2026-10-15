import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase, get, run } from "../src/lib/db/connection.ts";
import { letterPreview, recordClaimEvent } from "../src/lib/db/chronology.ts";
import { buildHireAgreementView, renderHireAgreement } from "../src/lib/db/hire-agreement.ts";
import { getHirePack, renderHirePack } from "../src/lib/db/hire-pack.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { countClaims } from "../src/lib/db/queries.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  claimStorageChargeEnded,
  confirmStorageAuthorisationEnd,
  hireGapForClaim,
  storageAuthorisationEndForClaim,
} from "../src/lib/db/storage-authorisation-end.ts";
import { confirmTotalLossOffHire, totalLossOffHireForClaim } from "../src/lib/db/total-loss-off-hire.ts";
import { FieldValidationError } from "../src/lib/form-validation.ts";

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
  get<{ id: string }>(`SELECT id FROM claims WHERE id = 'c3'`);
}

function storageRow(claimId: string) {
  const row = get<{
    storage_billing_end_on: string | null;
    storage_status: string | null;
    storage_rate_pence: number | null;
    storage_authorisation_review: string | null;
    repaired_vehicle_returned: number | null;
    repair_status: string | null;
    total_loss: number | null;
  }>(
    `SELECT storage_billing_end_on, storage_status, storage_rate_pence, storage_authorisation_review,
            repaired_vehicle_returned, repair_status, total_loss
     FROM claims WHERE id = ?`,
    [claimId],
  );
  assert.ok(row);
  return row;
}

function hireRow(claimId: string) {
  const row = get<{ billing_end_at: string | null; collection_at: string | null; rate_pence_per_day: number | null }>(
    `SELECT billing_end_at, collection_at, rate_pence_per_day FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`,
    [claimId],
  );
  assert.ok(row);
  return row;
}

function ensureStart(claimId: string) {
  run(
    `UPDATE claims SET storage_started_on = '2026-09-01' WHERE id = ? AND (storage_started_on IS NULL OR trim(storage_started_on) = '')`,
    [claimId],
  );
}

function authorise(claimId: string, at: string) {
  recordClaimEvent({
    claimId,
    eventType: "repairs_authorised",
    occurredAt: at,
    actorId: "staff-tom",
    details: "Repair authorisation received.",
  });
}

function storageForm(claimId: string, endDate: string, reason = "") {
  const row = get<{ storage_started_on: string | null; storage_rate_pence: number | null }>(
    `SELECT storage_started_on, storage_rate_pence FROM claims WHERE id = ?`,
    [claimId],
  );
  return {
    startDate: row?.storage_started_on || "",
    endDate,
    endDateReason: reason,
    dailyRate: row?.storage_rate_pence == null ? "" : String(row.storage_rate_pence),
  };
}

describe("repairable storage end from authorisation", () => {
  it("proposes the authorisation date and stores it only once confirmed", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const hireBefore = hireRow("c3");
      const rateBefore = storageRow("c3").storage_rate_pence;
      assert.equal(storageRow("c3").storage_billing_end_on, null);
      assert.equal(storageAuthorisationEndForClaim("c3").kind, "open");
      authorise("c3", "2026-09-10T10:00");
      const proposed = storageAuthorisationEndForClaim("c3");
      assert.equal(proposed.kind, "suggest");
      if (proposed.kind === "suggest") assert.equal(proposed.date, "2026-09-10");
      assert.equal(storageRow("c3").storage_billing_end_on, null);
      assert.equal(storageRow("c3").storage_status, "active");
      ensureStart("c3");
      confirmStorageAuthorisationEnd({ claimId: "c3", actorId: "staff-tom", choice: "suggested" });
      const after = storageRow("c3");
      assert.equal(after.storage_billing_end_on, "2026-09-10");
      assert.equal(after.storage_status, "active");
      assert.equal(after.storage_rate_pence, rateBefore);
      assert.equal(storageAuthorisationEndForClaim("c3").kind, "matches");
      const hireAfter = hireRow("c3");
      assert.equal(hireAfter.billing_end_at, hireBefore.billing_end_at);
      assert.equal(hireAfter.rate_pence_per_day, hireBefore.rate_pence_per_day);
    });
  });

  it("leaves storage open when there is no authorisation, including a chase or a payment", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const c6Before = storageRow("c6").storage_billing_end_on;
      assert.equal(storageAuthorisationEndForClaim("c6").kind, "open");
      assert.equal(storageRow("c6").storage_billing_end_on, c6Before);
      recordClaimEvent({
        claimId: "c3",
        eventType: "repair_authorisation_requested",
        occurredAt: "2026-09-08T09:00",
        actorId: "staff-tom",
        details: "Asked the insurer to authorise the repair.",
      });
      recordClaimEvent({
        claimId: "c3",
        eventType: "repair_payment_received",
        occurredAt: "2026-09-09T09:00",
        actorId: "staff-tom",
        details: "Repair payment received. This is not authorisation.",
      });
      assert.equal(storageAuthorisationEndForClaim("c3").kind, "open");
      assert.equal(storageRow("c3").storage_billing_end_on, null);
    });
  });

  it("flags a confirmed or proposed storage end when the file is later marked a total loss, and does not change the date", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      authorise("c3", "2026-09-10T10:00");
      ensureStart("c3");
      confirmStorageAuthorisationEnd({ claimId: "c3", actorId: "staff-tom", choice: "suggested" });
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
      saveScreenData("c3", "assessed-damage", { totalLoss: "yes" }, "staff-tom");
      const confirmed = storageAuthorisationEndForClaim("c3");
      assert.equal(confirmed.kind, "review");
      if (confirmed.kind === "review") assert.equal(confirmed.existingDate, "2026-09-10");
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
      assert.equal(storageRow("c3").storage_authorisation_review, "total_loss");
      assert.equal(Number(storageRow("c3").total_loss), 1);

      authorise("c5", "2026-09-11T10:00");
      assert.equal(storageAuthorisationEndForClaim("c5").kind, "suggest");
      assert.equal(storageRow("c5").storage_billing_end_on, null);
      saveScreenData("c5", "assessed-damage", { totalLoss: "yes" }, "staff-tom");
      const proposed = storageAuthorisationEndForClaim("c5");
      assert.equal(proposed.kind, "review");
      if (proposed.kind === "review") assert.equal(proposed.existingDate, null);
      assert.equal(storageRow("c5").storage_billing_end_on, null);
    });
  });

  it("asks for review when authorisation is revised or withdrawn, and does not overwrite a confirmed date", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      authorise("c3", "2026-09-10T10:00");
      ensureStart("c3");
      confirmStorageAuthorisationEnd({ claimId: "c3", actorId: "staff-tom", choice: "suggested" });
      authorise("c3", "2026-09-15T11:00");
      const revised = storageAuthorisationEndForClaim("c3");
      assert.equal(revised.kind, "conflict");
      if (revised.kind === "conflict") {
        assert.equal(revised.existingDate, "2026-09-10");
        assert.equal(revised.suggestedDate, "2026-09-15");
      }
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");

      run(`DELETE FROM claim_events WHERE claim_id = 'c5' AND event_type = 'repairs_authorised'`);
      authorise("c5", "2026-09-12T10:00");
      ensureStart("c5");
      confirmStorageAuthorisationEnd({ claimId: "c5", actorId: "staff-tom", choice: "suggested" });
      assert.equal(storageRow("c5").storage_billing_end_on, "2026-09-12");
      recordClaimEvent({
        claimId: "c5",
        eventType: "repairs_authorised_cleared",
        occurredAt: "2026-09-16T10:00",
        actorId: "staff-tom",
        details: "Authorisation withdrawn.",
      });
      const withdrawn = storageAuthorisationEndForClaim("c5");
      assert.equal(withdrawn.kind, "review");
      if (withdrawn.kind === "review") assert.equal(withdrawn.existingDate, "2026-09-12");
      assert.equal(storageRow("c5").storage_billing_end_on, "2026-09-12");
    });
  });

  it("refuses a manual storage date that differs from authorisation unless a reason is recorded", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      authorise("c3", "2026-09-10T10:00");
      ensureStart("c3");
      saveScreenData("c3", "storage", storageForm("c3", "2026-09-10"), "staff-tom");
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
      assert.throws(
        () => saveScreenData("c3", "storage", storageForm("c3", "2026-09-12"), "staff-tom"),
        (error: unknown) => {
          assert.ok(error instanceof FieldValidationError);
          assert.match(error.message, /Record a reason/);
          return true;
        },
      );
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
      saveScreenData(
        "c3",
        "storage",
        storageForm("c3", "2026-09-12", "Insurer asked for the vehicle to stay until the parts arrived."),
        "staff-tom",
      );
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-12");
      const reason = get<{ details: string | null }>(
        `SELECT details FROM claim_events
         WHERE claim_id = 'c3' AND event_type = 'storage_end_date_confirmed'
         ORDER BY recorded_at DESC LIMIT 1`,
      );
      assert.match(String(reason?.details || ""), /Insurer asked for the vehicle to stay/);
      assert.match(String(reason?.details || ""), /12\/09\/2026/);
    });
  });

  it("proposes the repairs-started date when repairs start before authorisation", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      assert.equal(storageRow("c6").storage_billing_end_on, null);
      recordClaimEvent({
        claimId: "c6",
        eventType: "repairs_started",
        occurredAt: "2026-09-01T09:00",
        actorId: "staff-tom",
        details: "Repairs started.",
      });
      const startedOnly = storageAuthorisationEndForClaim("c6");
      assert.equal(startedOnly.kind, "suggest");
      if (startedOnly.kind === "suggest") {
        assert.equal(startedOnly.date, "2026-09-01");
        assert.equal(startedOnly.basis, "repairs_started");
      }
      assert.equal(storageRow("c6").storage_billing_end_on, null);
      authorise("c6", "2026-09-11T10:00");
      const both = storageAuthorisationEndForClaim("c6");
      assert.equal(both.kind, "suggest");
      if (both.kind === "suggest") {
        assert.equal(both.date, "2026-09-01");
        assert.equal(both.earlierThanAuthorisation, true);
      }
      assert.equal(storageRow("c6").storage_billing_end_on, null);
      ensureStart("c6");
      confirmStorageAuthorisationEnd({ claimId: "c6", actorId: "staff-tom", choice: "suggested" });
      assert.equal(storageRow("c6").storage_billing_end_on, "2026-09-01");
    });
  });

  it("proposes the authorisation date when that date comes first", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      authorise("c4", "2026-09-10T10:00");
      const first = storageAuthorisationEndForClaim("c4");
      assert.equal(first.kind, "suggest");
      if (first.kind === "suggest") {
        assert.equal(first.date, "2026-09-10");
        assert.equal(first.basis, "authorisation");
      }
      recordClaimEvent({
        claimId: "c4",
        eventType: "repairs_started",
        occurredAt: "2026-09-18T09:00",
        actorId: "staff-megan",
        details: "Repairs started later.",
      });
      const later = storageAuthorisationEndForClaim("c4");
      assert.equal(later.kind, "suggest");
      if (later.kind === "suggest") assert.equal(later.date, "2026-09-10");
      assert.equal(storageRow("c4").storage_billing_end_on, null);
    });
  });

  it("flags a confirmed storage end later than repairs started and does not change it", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      authorise("c3", "2026-09-10T10:00");
      ensureStart("c3");
      confirmStorageAuthorisationEnd({ claimId: "c3", actorId: "staff-tom", choice: "suggested" });
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
      recordClaimEvent({
        claimId: "c3",
        eventType: "repairs_started",
        occurredAt: "2026-09-01T09:00",
        actorId: "staff-tom",
        details: "Repairs had already started.",
      });
      const flagged = storageAuthorisationEndForClaim("c3");
      assert.equal(flagged.kind, "review");
      if (flagged.kind === "review") {
        assert.equal(flagged.reasons.includes("Storage end is after repairs started, review"), true);
        assert.equal(flagged.existingDate, "2026-09-10");
      }
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-10");
    });
  });
});

describe("hire period uses the stored chargeable end", () => {
  it("uses the stored hire end on the letter and the hire pack when return and collection differ", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const claimedBefore = get<{ claimed_pence: number }>(`SELECT claimed_pence FROM financial_lines WHERE id = 'f-c3-hire'`);
      assert.ok(claimedBefore);
      run(`UPDATE hire_episodes SET billing_end_at = '2026-09-22', collection_at = '2026-09-20' WHERE id = 'h-c3'`);
      run(
        `INSERT INTO hire_pack_data(claim_id, date_in, updated_at) VALUES ('c3', '2026-09-18T14:00:00.000Z', '2026-09-18T14:00:00.000Z')`,
      );
      recordClaimEvent({
        claimId: "c3",
        eventType: "vehicle_returned",
        occurredAt: "2026-09-18T15:00",
        actorId: "staff-tom",
        details: "Repaired vehicle returned to customer",
      });
      const gap = hireGapForClaim("c3");
      assert.ok(gap?.gap);
      assert.equal(gap.returnedDay, "2026-09-18");
      assert.equal(gap.collectedDay, "2026-09-20");
      assert.equal(gap.gap.dayCount, 2);
      assert.equal(gap.gap.message, "Hire charged 2 days beyond vehicle return");
      assert.equal(hireRow("c3").billing_end_at, "2026-09-22");
      const claimedAfter = get<{ claimed_pence: number }>(`SELECT claimed_pence FROM financial_lines WHERE id = 'f-c3-hire'`);
      assert.equal(claimedAfter?.claimed_pence, claimedBefore.claimed_pence);

      const letter = letterPreview("c3", "hire_pack_cover");
      assert.match(letter.text, /to 22\/09\/2026/);
      assert.equal(letter.text.includes("18/09/2026"), false);
      assert.equal(letter.text.includes("20/09/2026"), false);
      assert.equal(letter.missing.includes("Hire end date"), false);

      const pack = getHirePack("c3");
      assert.ok(pack);
      const packHtml = renderHirePack(pack);
      assert.match(packHtml, /Date in: 22\/09\/2026/);
      assert.equal(/Date in: 18\/09\/2026/.test(packHtml), false);
      assert.equal(/Date in: 20\/09\/2026/.test(packHtml), false);
      const agreement = renderHireAgreement(buildHireAgreementView(pack, "TEST-AGR", 8900));
      assert.match(agreement, /Date in: 22\/09\/2026/);
      assert.equal(/Date in: 18\/09\/2026/.test(agreement), false);
      assert.equal(/Date in: 20\/09\/2026/.test(agreement), false);
    });
  });

  it("says hire continuing when no hire end is stored, and does not use the return date", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      assert.equal(hireRow("c3").billing_end_at, null);
      run(
        `INSERT INTO hire_pack_data(claim_id, date_in, updated_at) VALUES ('c3', '2026-09-18T14:00:00.000Z', '2026-09-18T14:00:00.000Z')`,
      );
      recordClaimEvent({
        claimId: "c3",
        eventType: "vehicle_returned",
        occurredAt: "2026-09-18T15:00",
        actorId: "staff-tom",
        details: "Repaired vehicle returned to customer",
      });
      const letter = letterPreview("c3", "hire_pack_cover");
      assert.match(letter.text, /to Hire continuing/);
      assert.equal(letter.text.includes("18/09/2026"), false);
      assert.equal(letter.missing.includes("Hire end date"), true);
      const pack = getHirePack("c3");
      assert.ok(pack);
      const packHtml = renderHirePack(pack);
      assert.match(packHtml, /Date in: Hire continuing/);
      assert.equal(/Date in: 18\/09\/2026/.test(packHtml), false);
      const agreement = renderHireAgreement(buildHireAgreementView(pack, "TEST-AGR", 8900));
      assert.match(agreement, /Date in: Hire continuing/);
      assert.equal(hireRow("c3").billing_end_at, null);
    });
  });
});

describe("returned status, existing dates, and total-loss hire", () => {
  it("sets the returned status when the repaired-vehicle history line is recorded", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const before = storageRow("c8");
      assert.equal(Number(before.repaired_vehicle_returned), 0);
      const endBefore = before.storage_billing_end_on;
      recordClaimEvent({
        claimId: "c8",
        eventType: "vehicle_returned",
        occurredAt: "2026-10-01T11:00",
        actorId: "staff-megan",
        details: "Repaired vehicle returned to customer",
      });
      const after = storageRow("c8");
      assert.equal(Number(after.repaired_vehicle_returned), 1);
      assert.equal(after.repair_status, "complete");
      assert.equal(after.storage_billing_end_on, endBefore);
    });
  });

  it("does not change existing confirmed hire or storage ends", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const c7 = storageRow("c7").storage_billing_end_on;
      const c8 = storageRow("c8").storage_billing_end_on;
      const c10Storage = storageRow("c10").storage_billing_end_on;
      const c10Hire = hireRow("c10").billing_end_at;
      assert.ok(c7);
      assert.ok(c8);
      assert.ok(c10Storage);
      assert.ok(c10Hire);
      storageAuthorisationEndForClaim("c7");
      storageAuthorisationEndForClaim("c8");
      storageAuthorisationEndForClaim("c10");
      hireGapForClaim("c7");
      hireGapForClaim("c8");
      hireGapForClaim("c10");
      assert.equal(storageRow("c7").storage_billing_end_on, c7);
      assert.equal(storageRow("c8").storage_billing_end_on, c8);
      assert.equal(storageRow("c10").storage_billing_end_on, c10Storage);
      assert.equal(hireRow("c10").billing_end_at, c10Hire);
      run(`UPDATE claims SET storage_billing_end_on = '2026-09-14' WHERE id = 'c3'`);
      storageAuthorisationEndForClaim("c3");
      hireGapForClaim("c3");
      assert.equal(storageRow("c3").storage_billing_end_on, "2026-09-14");
      const c7View = storageAuthorisationEndForClaim("c7");
      assert.equal(c7View.kind, "matches");
      if (c7View.kind === "matches") assert.equal(c7View.date, String(c7).slice(0, 10));
      const c8View = storageAuthorisationEndForClaim("c8");
      assert.equal(c8View.kind, "review");
      if (c8View.kind === "review") {
        assert.equal(c8View.reasons.includes("Storage end is after repairs started, review"), true);
        assert.equal(c8View.existingDate, String(c8).slice(0, 10));
      }
      assert.equal(storageAuthorisationEndForClaim("c10").kind, "open");
    });
  });

  it("still confirms total-loss off-hire seven days after the qualifying payment, and leaves storage alone", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const storageBefore = storageRow("c9");
      const rateBefore = hireRow("c9").rate_pence_per_day;
      run(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 1000000 WHERE id = 'f-c9-vd'`);
      run(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES ('pay-full', 'c9', 'total_loss_payment_received', 'Payment', '', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', 'staff-justin', 'staff')`,
      );
      const suggestion = totalLossOffHireForClaim("c9");
      assert.equal(suggestion?.kind, "suggest");
      if (suggestion?.kind === "suggest") assert.equal(suggestion.date, "2026-10-08");
      confirmTotalLossOffHire({ claimId: "c9", actorId: "staff-justin", choice: "suggested" });
      assert.equal(hireRow("c9").billing_end_at, "2026-10-08");
      assert.equal(hireRow("c9").rate_pence_per_day, rateBefore);
      const storageAfter = storageRow("c9");
      assert.equal(storageAfter.storage_billing_end_on, storageBefore.storage_billing_end_on);
      assert.equal(storageAfter.storage_rate_pence, storageBefore.storage_rate_pence);
      assert.equal(storageAfter.storage_status, storageBefore.storage_status);
      storageAuthorisationEndForClaim("c9");
      assert.equal(hireRow("c9").billing_end_at, "2026-10-08");
      assert.equal(storageRow("c9").storage_billing_end_on, storageBefore.storage_billing_end_on);
    });
  });

  it("keeps a vehicle on the storage list after the confirmed end, and drops it from chargeable storage", () => {
    const db = prepared();
    withDatabase(db, () => {
      warmup();
      const physicalBefore = countClaims("storage");
      const chargeableBefore = countClaims("storage_chargeable");
      assert.equal(storageRow("c3").storage_status, "active");
      assert.equal(claimStorageChargeEnded("c3"), false);
      run(`UPDATE claims SET storage_billing_end_on = '2020-01-01' WHERE id = 'c3'`);
      assert.equal(storageRow("c3").storage_status, "active");
      assert.equal(countClaims("storage"), physicalBefore);
      assert.equal(countClaims("storage_chargeable"), chargeableBefore - 1);
      assert.equal(claimStorageChargeEnded("c3"), true);
    });
  });
});

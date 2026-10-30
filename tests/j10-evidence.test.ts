import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { produceDraftInvoice } from "../src/lib/db/draft-invoice.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import { addStorageChronologyEntry, listStorageChronology } from "../src/lib/db/storage-chronology.ts";
import { storageAuthorisationEndForClaim } from "../src/lib/db/storage-authorisation-end.ts";
import { listVehicleMovements, recordVehicleMovement } from "../src/lib/db/vehicle-movements.ts";
import { listChargeOffers, recordSplitOffer } from "../src/lib/db/vehicle-offers.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { repairStorageEndProposal } from "../src/lib/domain/storage-authorisation-end.ts";
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

async function recoveryClaim(jurisdiction = "") {
  const form = new FormData();
  form.set("client_forename", "Gethin");
  form.set("client_surname", "Evidence");
  form.set("client_mobile", "07700900654");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-5));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  if (jurisdiction) form.set("jurisdiction", jurisdiction);
  return createClaimFromIntake(intakeFromFormData(form));
}

function recoveryForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("arrivedDate", isoDateFromNow(-4));
  form.set("arrivedTime", "11:00");
  form.set("recoveryLocation", "A470 northbound, Pontypridd");
  form.set("carCondition", "Front end crushed, coolant leaking.");
  form.set("notDriveable", "obstructing");
  form.set("recoveryTick_standard", "yes");
  form.set("recoveryAmount_standard", "395");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

describe("J10 — recovery and storage evidence", () => {
  it("records where the car was, its condition and why it could not be driven, and the recovery as the first movement", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveryClaim();
      assert.throws(
        () => recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm({ notDriveable: "" }) }),
        (error: unknown) => error instanceof FieldValidationError && error.field === "notDriveable",
      );
      assert.throws(
        () => recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm({ carCondition: "" }) }),
        (error: unknown) => error instanceof FieldValidationError && error.field === "carCondition",
      );
      recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm() });
      const job = get<{ car_condition: string; not_driveable_reason: string }>(`SELECT car_condition, not_driveable_reason FROM recovery_jobs WHERE claim_id = ?`, [claim.id]);
      assert.equal(job?.not_driveable_reason, "obstructing");
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND event_type = 'recovery_completed'`, [claim.id]);
      assert.match(String(event?.details), /Could not be driven: obstructing the road/);
      const moves = listVehicleMovements(claim.id);
      assert.equal(moves.length, 1);
      assert.equal(moves[0].from, "A470 northbound, Pontypridd");
      assert.equal(moves[0].necessity, "accident");
      recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm() });
      assert.equal(listVehicleMovements(claim.id).length, 1, "recording the recovery again does not add a second movement");
      recordVehicleMovement({
        claimId: claim.id,
        actorId: "staff-sian",
        movedOn: isoDateFromNow(-2),
        from: "CAS yard",
        to: "Bridgend Bodyshop",
        purpose: "Inspection by the repairer",
        necessity: "workshop",
      });
      assert.equal(listVehicleMovements(claim.id)[1].necessityLabel, "Convenience – workshop");
      assert.throws(
        () => recordVehicleMovement({ claimId: claim.id, actorId: "staff-sian", movedOn: isoDateFromNow(-1), from: "A", to: "B", purpose: "Move", necessity: "" }),
        /required by the accident or for convenience/,
      );
    });
    db.close();
  });

  it("keeps a storage chronology, and proposes the earliest date the car could have been moved, with the reason", async () => {
    assert.deepEqual(repairStorageEndProposal("2026-10-20", null, "2026-10-15"), { date: "2026-10-15", basis: "earliest_move", earlierThanAuthorisation: true });
    assert.equal(repairStorageEndProposal("2026-10-20", null, "2026-10-25")?.basis, "authorisation");
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveryClaim();
      recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm() });
      assert.throws(
        () => addStorageChronologyEntry({ claimId: claim.id, actorId: "staff-sian", kind: "earliest_move", occurredOn: isoDateFromNow(-2), note: "" }),
        /Say why/,
      );
      addStorageChronologyEntry({ claimId: claim.id, actorId: "staff-sian", kind: "inspection_access", occurredOn: isoDateFromNow(-3), note: "Engineer inspected at the yard" });
      addStorageChronologyEntry({ claimId: claim.id, actorId: "staff-sian", kind: "earliest_move", occurredOn: isoDateFromNow(-2), note: "Inspection done; the car could have gone to the repairer" });
      const labels = listStorageChronology(claim.id).map((entry) => entry.label);
      assert.deepEqual(labels, ["Inspection access", "Earliest date the car could reasonably have been moved"]);
      const view = storageAuthorisationEndForClaim(claim.id);
      assert.equal(view.kind, "suggest");
      if (view.kind === "suggest") {
        assert.equal(view.date, isoDateFromNow(-2));
        assert.equal(view.basis, "earliest_move");
      }
    });
    db.close();
  });

  it("produces a customer invoice for recovery and storage, saying liability depends on the signed terms", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await recoveryClaim();
      recordRecoveryDone({ claimId: claim.id, actorId: "staff-sian", form: recoveryForm() });
      const made = produceDraftInvoice({ claimId: claim.id, head: "customer", actorId: "staff-sian" });
      const doc = get<{ title: string; body_html: string }>(`SELECT title, body_html FROM documents WHERE id = ?`, [made.documentId]);
      assert.equal(doc?.title, "Draft customer invoice — Recovery and storage");
      assert.match(String(doc?.body_html), /To: Gethin Evidence/);
      assert.match(String(doc?.body_html), /No signed Storage &amp; Recovery Agreement is on the file yet/);
    });
    db.close();
  });

  it("splits an offer that covers more than one head before it is recorded, and refuses a split that does not add up", () => {
    const db = prepared();
    withDatabase(db, () => {
      const base = { claimId: "c3", actorId: "staff-sian", totalPence: 100000, offeredOn: isoDateFromNow(-1), note: "", submitKey: "split-1" };
      assert.throws(
        () => recordSplitOffer({ ...base, parts: [{ head: "repairs", pence: 60000 }, { head: "storage", pence: 30000 }] }),
        /adds up to £900\.00, not the offer of £1,000\.00/,
      );
      assert.throws(() => recordSplitOffer({ ...base, parts: [{ head: "repairs", pence: 100000 }] }), /at least two heads/);
      recordSplitOffer({ ...base, parts: [{ head: "repairs", pence: 70000 }, { head: "storage", pence: 30000 }] });
      const storage = listChargeOffers("c3", "storage").find((offer) => offer.amountPence === 30000);
      assert.ok(storage);
      assert.match(String(storage?.note), /Part of a combined offer of £1,000\.00/);
    });
    db.close();
  });

  it("records the jurisdiction at intake, England & Wales unless chosen", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const ni = await recoveryClaim("northern_ireland");
      const plain = await recoveryClaim();
      assert.equal(get<{ jurisdiction: string }>(`SELECT jurisdiction FROM claims WHERE id = ?`, [ni.id])?.jurisdiction, "northern_ireland");
      assert.equal(get<{ jurisdiction: string }>(`SELECT jurisdiction FROM claims WHERE id = ?`, [plain.id])?.jurisdiction, "england_wales");
      run(`UPDATE claims SET jurisdiction = 'scotland' WHERE id = ?`, [plain.id]);
    });
    db.close();
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/page.tsx"), "utf8");
    assert.match(page, /NORTHERN_IRELAND_REMINDER/);
  });
});

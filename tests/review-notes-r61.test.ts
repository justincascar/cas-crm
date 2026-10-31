import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { run, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordRecoveryDone } from "../src/lib/db/record-recovery.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  guardStorageRecoveryClaim,
  hireAgreementIncludesStorageRecovery,
  listStorageRecoveryNotCovered,
  recoveryNeededNotRecorded,
  storageRecoveryNotCovered,
  storageRecoveryState,
} from "../src/lib/db/storage-recovery-signing.ts";
import { isoDateFromNow, nowUtcIso } from "../src/lib/dates.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-review-r61-"));
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

/** A fictional non-fault file: unroadworthy, recovery needed, nothing recorded yet. */
async function newFile() {
  const form = new FormData();
  form.set("client_forename", "Aled");
  form.set("client_surname", "Prawf");
  form.set("client_mobile", "07700900771");
  form.set("handlerId", "staff-sian");
  form.set("accidentDate", isoDateFromNow(-3));
  form.set("accidentTime", "08:00");
  form.set("claimType", "non_fault");
  form.set("roadworthiness", "unroadworthy");
  form.set("needsRecovery", "yes");
  form.set("veh_registration", "TE61 ABC");
  return createClaimFromIntake(intakeFromFormData(form));
}

/** The hire agreement as produced and signed: with or without the Storage & Recovery page. */
function signHireAgreement(claimId: string, withStoragePage: boolean) {
  const page = withStoragePage ? "<h2>Storage &amp; Recovery Agreement</h2><p>Fictional page.</p>" : "";
  run(
    `INSERT INTO documents(id, claim_id, title, kind, template_key, version, body_html, created_at)
     VALUES (?, ?, 'Hire agreement TEST-HA-000099', 'hire_agreement', 'hire_agreement', 1, ?, ?)`,
    [`doc-ha-${claimId}`, claimId, `<p>Agreement number: <strong>TEST-HA-000099</strong></p>${page}`, nowUtcIso()],
  );
  run(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, created_at) VALUES (?, ?, 'Signed hire agreement', 'upload', 'signed_hire_agreement', ?)`,
    [`doc-signed-${claimId}`, claimId, nowUtcIso()],
  );
}

function recordRecovery(claimId: string) {
  const recovery = new FormData();
  recovery.set("arrivedDate", isoDateFromNow(-2));
  recovery.set("arrivedTime", "11:00");
  recovery.set("recoveryLocation", "Roadside, A474 (fictional)");
  recovery.set("carCondition", "Rear crushed (fictional).");
  recovery.set("notDriveable", "unsafe");
  recovery.set("recoveryTick_standard", "yes");
  recovery.set("recoveryAmount_standard", "395");
  recordRecoveryDone({ claimId, actorId: "staff-sian", form: recovery });
}

describe("R61 — recovery recorded after a hire agreement signed without the Storage & Recovery page", () => {
  it("asks before the agreement is produced while recovery is needed but not recorded", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile();
      assert.equal(recoveryNeededNotRecorded(claim.id), true);
      recordRecovery(claim.id);
      assert.equal(recoveryNeededNotRecorded(claim.id), false, "once recorded, the agreement includes the page");
    });
    db.close();
  });

  it("says plainly that the signed agreement does not cover recovery and storage, and refuses the payment request", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile();
      signHireAgreement(claim.id, false);
      assert.equal(hireAgreementIncludesStorageRecovery(claim.id), false);
      assert.equal(storageRecoveryNotCovered(claim.id), null, "nothing to say before any recovery or storage is recorded");

      recordRecovery(claim.id);
      const gap = storageRecoveryNotCovered(claim.id);
      assert.equal(gap?.agreementNumber, "TEST-HA-000099");
      assert.equal(
        gap?.message,
        "The signed hire agreement TEST-HA-000099 does not cover recovery and storage. Get the Storage & Recovery Agreement signed.",
      );
      assert.ok(listStorageRecoveryNotCovered().some((item) => item.claimId === claim.id), "listed on the dashboard");
      assert.throws(() => guardStorageRecoveryClaim(claim.id, "recovery_payment_request_sent"), /has not signed the Storage & Recovery Agreement/);
      assert.throws(() => guardStorageRecoveryClaim(claim.id, "storage_payment_request_sent"), /has not signed the Storage & Recovery Agreement/);
    });
    db.close();
  });

  it("says nothing when the signed hire agreement includes the Storage & Recovery page", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const claim = await newFile();
      recordRecovery(claim.id);
      signHireAgreement(claim.id, true);
      assert.equal(hireAgreementIncludesStorageRecovery(claim.id), true);
      assert.equal(storageRecoveryState(claim.id).status, "covered_by_hire");
      assert.equal(storageRecoveryNotCovered(claim.id), null);
      assert.doesNotThrow(() => guardStorageRecoveryClaim(claim.id, "recovery_payment_request_sent"));
      assert.equal(listStorageRecoveryNotCovered().some((item) => item.claimId === claim.id), false);
    });
    db.close();
  });
});

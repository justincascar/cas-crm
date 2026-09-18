import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  liabilityStatusLabel,
  normalizeLiabilityStatus,
  normalizeRoadworthiness,
  roadworthinessLabel,
} from "../src/lib/domain/claim-status.ts";
import { withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { listClaimEvents } from "../src/lib/db/chronology.ts";
import { getClaim, updateClaimWorkflowStatus } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("liability status and roadworthiness", () => {
  it("treats unknown and awaiting assessment as not yet decided, not as Fault or Roadworthy", () => {
    assert.equal(normalizeLiabilityStatus("unknown"), "");
    assert.equal(normalizeLiabilityStatus(""), "");
    assert.equal(normalizeLiabilityStatus("fault"), "fault");
    assert.equal(normalizeLiabilityStatus("non_fault"), "non_fault");
    assert.equal(normalizeLiabilityStatus("disputed"), "disputed");
    assert.equal(liabilityStatusLabel("unknown"), "Not yet decided");
    assert.equal(liabilityStatusLabel("disputed"), "Disputed / unclear");
    assert.equal(normalizeRoadworthiness("awaiting_assessment"), "");
    assert.equal(normalizeRoadworthiness("needs_review"), "");
    assert.equal(normalizeRoadworthiness("roadworthy"), "roadworthy");
    assert.equal(normalizeRoadworthiness("unroadworthy"), "unroadworthy");
    assert.equal(roadworthinessLabel(""), "Not yet decided");
    assert.equal(roadworthinessLabel("unroadworthy"), "Unroadworthy");
  });

  it("reads intake with both fields unset rather than defaulting to fault or roadworthy", () => {
    const form = new FormData();
    form.set("client_forename", "Aled");
    form.set("client_surname", "Morgan");
    const intake = intakeFromFormData(form);
    assert.equal(intake.claimType, "");
    assert.equal(intake.roadworthiness, "");
  });

  it("creates a claim with both fields unset, then saves each independently", async () => {
    const db = seeded();
    await withDatabaseAsync(db, async () => {
      const created = await createClaimFromIntake({
        handlerId: "staff-sian",
        clientRole: "owner_driver",
        client: { forename: "Aled", surname: "Morgan", dob: "1988-04-12" },
        vehicle: {},
        thirdParties: [],
        accidentDate: "2026-09-01",
      });
      const opened = getClaim(created.id);
      assert.ok(opened);
      assert.equal(normalizeLiabilityStatus(String(opened.claim.claim_type)), "");
      assert.equal(normalizeRoadworthiness(String(opened.claim.roadworthiness)), "");
      assert.equal(
        listClaimEvents(created.id).some((event) => event.event_type === "liability_status_changed"),
        false,
      );

      updateClaimWorkflowStatus(created.id, { liabilityStatus: "non_fault" }, "staff-sian");
      const afterLiability = getClaim(created.id);
      assert.equal(String(afterLiability?.claim.claim_type), "non_fault");
      assert.equal(normalizeRoadworthiness(String(afterLiability?.claim.roadworthiness)), "");
      const liabilityEvent = listClaimEvents(created.id).find((event) => event.event_type === "liability_status_changed");
      assert.ok(liabilityEvent);
      assert.match(String(liabilityEvent.details), /Non-fault/);
      assert.equal(liabilityEvent.actor_name, "Sian Evans");

      updateClaimWorkflowStatus(created.id, { roadworthiness: "unroadworthy" }, "staff-tom");
      const afterRoadworthiness = getClaim(created.id);
      assert.equal(String(afterRoadworthiness?.claim.claim_type), "non_fault");
      assert.equal(String(afterRoadworthiness?.claim.roadworthiness), "unroadworthy");
      const roadworthinessEvent = listClaimEvents(created.id).find((event) => event.event_type === "roadworthiness_changed");
      assert.ok(roadworthinessEvent);
      assert.match(String(roadworthinessEvent.details), /Unroadworthy/);
      assert.equal(roadworthinessEvent.actor_name, "Tom Hughes");
    });
    db.close();
  });

  it("changes liability on an existing test claim without touching roadworthiness, and records who changed it", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = getClaim("c3");
      assert.equal(String(before?.claim.claim_type), "non_fault");
      assert.equal(String(before?.claim.roadworthiness), "unroadworthy");
      updateClaimWorkflowStatus("c3", { liabilityStatus: "disputed" }, "staff-justin");
      const after = getClaim("c3");
      assert.equal(String(after?.claim.claim_type), "disputed");
      assert.equal(String(after?.claim.roadworthiness), "unroadworthy");
      const event = listClaimEvents("c3").find((row) => row.event_type === "liability_status_changed");
      assert.ok(event);
      assert.match(String(event.details), /Non-fault/);
      assert.match(String(event.details), /Disputed \/ unclear/);
      assert.equal(event.actor_name, "Justin Roberts");
    });
    db.close();
  });

  it("does not silently default seeded TEST claims to Fault or Roadworthy", () => {
    const db = seeded();
    const rows = db
      .prepare("SELECT id, file_reference, claim_type, roadworthiness FROM claims ORDER BY file_reference")
      .all() as Array<{ id: string; file_reference: string; claim_type: string; roadworthiness: string }>;
    const byRef = Object.fromEntries(rows.map((row) => [row.file_reference, row]));
    assert.equal(byRef["TEST-0001"]?.claim_type, "unknown");
    assert.equal(byRef["TEST-0001"]?.roadworthiness, "awaiting_assessment");
    assert.equal(liabilityStatusLabel(byRef["TEST-0001"]?.claim_type), "Not yet decided");
    assert.equal(roadworthinessLabel(byRef["TEST-0001"]?.roadworthiness), "Not yet decided");
    assert.equal(byRef["TEST-0003"]?.claim_type, "non_fault");
    assert.equal(byRef["TEST-0003"]?.roadworthiness, "unroadworthy");
    assert.equal(byRef["TEST-0004"]?.claim_type, "fault");
    assert.equal(byRef["TEST-0004"]?.roadworthiness, "roadworthy");
    assert.equal(byRef["TEST-0005"]?.claim_type, "non_fault");
    assert.notEqual(byRef["TEST-0005"]?.claim_type, "disputed");
    db.close();
  });
});

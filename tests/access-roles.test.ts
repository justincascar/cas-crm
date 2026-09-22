import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { pathAllowedForRole } from "../src/lib/auth/roles.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { createStaffAccount } from "../src/lib/db/staff-admin.ts";
import { recordVehicleHandover } from "../src/lib/db/handover.ts";
import { addRepairEvidence, assignDayJob, canReadDocument, listMyJobs } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { readStoredFile } from "../src/lib/storage/files.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function handover(actorId: string, claimId = "c3") {
  return {
    claimId,
    eventKind: "hire_delivered",
    hireEpisodeId: claimId === "c3" ? "h-c3" : "",
    mileage: "15000",
    fuelLevel: "half",
    conditionNote: "",
    actorId,
    photos: [] as Array<{ buffer: Buffer; filename: string; mimeType: string }>,
  };
}

describe("driver and mechanic access", () => {
  it("blocks a driver and a mechanic from office pages, including a direct URL", () => {
    for (const role of ["driver", "mechanic"]) {
      assert.equal(pathAllowedForRole(role, "/financials"), false);
      assert.equal(pathAllowedForRole(role, "/claims/c3"), false);
      assert.equal(pathAllowedForRole(role, "/claims/c3/work/general"), false);
      assert.equal(pathAllowedForRole(role, "/claims/c3/hire-pack"), false);
      assert.equal(pathAllowedForRole(role, "/settings"), false);
      assert.equal(pathAllowedForRole(role, "/communications"), false);
    }
    assert.equal(pathAllowedForRole("driver", "/claims/c3/handover"), true);
    assert.equal(pathAllowedForRole("driver", "/claims/c3/repair"), false);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c3/repair"), true);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c3/handover"), false);
    assert.equal(pathAllowedForRole("administrator", "/financials"), true);
    assert.equal(pathAllowedForRole("staff", "/claims/c3"), true);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/handover/page.tsx"), "utf8");
    assert.doesNotMatch(page, /Spare wheel/);
    assert.doesNotMatch(page, /Tyres visibly legal/);
  });

  it("lets a driver record mileage and fuel only on today's assigned booking", () => {
    const db = prepared();
    withDatabase(db, () => {
      const created = createStaffAccount({
        name: "Temp Driver",
        username: "tempdriver",
        email: "temp.driver@example.test",
        password: "password1",
        role: "driver",
        actorId: "staff-justin",
      });
      if (!created.ok) throw new Error(created.error);
      assert.equal(listMyJobs(created.id).length, 0);
      assert.throws(() => recordVehicleHandover(handover(created.id)), /not assigned to you today/);
      assignDayJob({
        assigneeId: created.id,
        jobKind: "handover",
        claimId: "",
        hireEpisodeId: "h-c3",
        actorId: "staff-justin",
      });
      const saved = recordVehicleHandover(handover(created.id));
      assert.equal(saved.incomplete, true);
      assert.throws(
        () => recordVehicleHandover({ ...handover(created.id), eventKind: "client_recovered", hireEpisodeId: "" }),
        /not assigned to you today/,
      );
      assert.throws(() => recordVehicleHandover(handover(created.id, "c4")), /not assigned|Choose the hire booking|not on this file/);
      const jobs = listMyJobs(created.id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].jobKind, "handover");
      assert.equal(jobs[0].fileReference, "TEST-0003");
    });
    db.close();
  });

  it("lets a mechanic store a geometry report on the assigned repair and blocks another file", () => {
    const previous = process.env.CAS_FILES_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-repair-"));
    process.env.CAS_FILES_DIR = dir;
    const db = prepared();
    try {
      withDatabase(db, () => {
        const created = createStaffAccount({
          name: "Temp Mechanic",
          username: "tempmechanic",
          email: "temp.mechanic@example.test",
          password: "password1",
          role: "mechanic",
          actorId: "staff-justin",
        });
        if (!created.ok) throw new Error(created.error);
        assert.throws(
          () =>
            addRepairEvidence({
              claimId: "c3",
              actorId: created.id,
              actorRole: "mechanic",
              kind: "geometry",
              note: "Alignment",
              file: { buffer: Buffer.from("%PDF-1.4 geometry"), filename: "alignment.pdf", mimeType: "application/pdf" },
            }),
          /not assigned to you today/,
        );
        assignDayJob({
          assigneeId: created.id,
          jobKind: "repair",
          claimId: "c3",
          hireEpisodeId: "",
          actorId: "staff-sian",
        });
        const saved = addRepairEvidence({
          claimId: "c3",
          actorId: created.id,
          actorRole: "mechanic",
          kind: "geometry",
          note: "Alignment",
          file: { buffer: Buffer.from("%PDF-1.4 geometry"), filename: "alignment.pdf", mimeType: "application/pdf" },
        });
        const doc = db.prepare(
          `SELECT d.id, d.document_type, d.stored_relpath FROM repair_evidence r JOIN documents d ON d.id = r.document_id WHERE r.id = ?`,
        ).get(saved.id) as { id: string; document_type: string; stored_relpath: string };
        assert.equal(doc.document_type, "repair_evidence");
        assert.equal(readStoredFile(doc.stored_relpath).buffer.toString("utf8"), "%PDF-1.4 geometry");
        assert.equal(canReadDocument({ id: created.id, role: "mechanic" }, doc.id), true);
        assert.equal(canReadDocument({ id: "staff-driver", role: "driver" }, doc.id), false);
        assert.throws(
          () =>
            addRepairEvidence({
              claimId: "c4",
              actorId: created.id,
              actorRole: "mechanic",
              kind: "progress_photo",
              note: "",
              file: { buffer: Buffer.from("img"), filename: "wing.png", mimeType: "image/png" },
            }),
          /not assigned to you today/,
        );
        const jobs = listMyJobs(created.id);
        assert.equal(jobs.some((job) => job.jobKind === "repair" && job.claimId === "c3"), true);
      });
    } finally {
      db.close();
      if (previous === undefined) delete process.env.CAS_FILES_DIR;
      else process.env.CAS_FILES_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows today's assignment to an administrator and an empty list when nothing is assigned", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.equal(listMyJobs("staff-justin").length, 0);
      assert.equal(listMyJobs("staff-sian").length, 0);
      assignDayJob({
        assigneeId: "staff-justin",
        jobKind: "handover",
        claimId: "",
        hireEpisodeId: "h-c3",
        actorId: "staff-justin",
      });
      const jobs = listMyJobs("staff-justin");
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].href, "/claims/c3/handover");
      assert.equal(listMyJobs("staff-tom").length, 0);
    });
    db.close();
  });
});

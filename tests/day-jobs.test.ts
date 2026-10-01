import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ensureStaffAuth } from "../src/lib/auth/ensure.ts";
import { createStaffAccount } from "../src/lib/db/staff-admin.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { ensureDemoDayJobs } from "../src/lib/db/demo-jobs.ts";
import { listVehicleHandovers, recordVehicleHandover } from "../src/lib/db/handover.ts";
import { assignDayJob, listMyJobs } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { formatUkDateTime, isoDateFromNow, londonTodayIso } from "../src/lib/dates.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function driver(name: string, username: string) {
  const created = createStaffAccount({
    name,
    username,
    email: `${username}@example.test`,
    password: "password1",
    role: "driver",
    actorId: "staff-justin",
  });
  if (!created.ok) throw new Error(created.error);
  return created.id;
}

describe("assigning a driver and a date", () => {
  it("keeps the demonstration driver's daily test job and does not show a future hire delivery today", () => {
    const db = prepared();
    withDatabase(db, () => {
      ensureStaffAuth(db);
      ensureDemoDayJobs(db);
      const today = listMyJobs("staff-driver");
      assert.equal(today.some((job) => job.jobKind === "handover" && job.fileReference === "TEST-0003" && job.workDate === londonTodayIso()), true);
      const tomorrow = isoDateFromNow(1);
      assignDayJob({
        assigneeId: "staff-driver",
        jobKind: "hire_delivery",
        claimId: "",
        hireEpisodeId: "h-c3",
        actorId: "staff-justin",
        workDate: tomorrow,
      });
      assert.equal(listMyJobs("staff-driver").some((job) => job.jobKind === "hire_delivery"), false);
      assert.equal(listMyJobs("staff-driver", tomorrow).some((job) => job.jobKind === "hire_delivery" && job.jobLabel === "Hire car delivery"), true);
    });
    db.close();
  });

  it("shows a same-day completed job today, with the named driver and the time that was entered", () => {
    const db = prepared();
    withDatabase(db, () => {
      const assignee = driver("Day Driver", "daydriver");
      const whoDidIt = driver("Other Driver", "otherdriver");
      const saved = assignDayJob({
        assigneeId: assignee,
        jobKind: "hire_collection",
        claimId: "",
        hireEpisodeId: "h-c3",
        actorId: "staff-sian",
        workDate: londonTodayIso(),
        completed: true,
        actualDriverId: whoDidIt,
        actualOccurredAt: "2026-09-22T08:05",
      });
      const job = listMyJobs(assignee).find((row) => row.id === saved.id);
      assert.ok(job);
      assert.equal(job.completed, true);
      assert.equal(job.actualDriverId, whoDidIt);
      assert.equal(job.jobLabel, "Hire car collection");
      assert.match(formatUkDateTime(job.actualOccurredAt), /22\/09\/2026 08:05/);
      assert.notEqual(job.actualDriverId, "staff-sian");
    });
    db.close();
  });

  it("logs a recovery from two days ago against that day, not against today", () => {
    const db = prepared();
    withDatabase(db, () => {
      const assignee = driver("Road Driver", "roaddriver");
      const whoDidIt = driver("Night Driver", "nightdriver");
      const past = isoDateFromNow(-2);
      const saved = assignDayJob({
        assigneeId: assignee,
        jobKind: "client_recovery",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: past,
        completed: true,
        actualDriverId: whoDidIt,
        actualOccurredAt: `${past}T23:40`,
      });
      assert.equal(listMyJobs(assignee).some((job) => job.id === saved.id), false);
      const job = listMyJobs(assignee, past).find((row) => row.id === saved.id);
      assert.ok(job);
      assert.equal(job.jobKind, "client_recovery");
      assert.equal(job.workDate, past);
      assert.equal(job.actualDriverId, whoDidIt);
      assert.match(formatUkDateTime(job.actualOccurredAt), /23:40/);
      assignDayJob({
        assigneeId: assignee,
        jobKind: "client_return",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: past,
      });
      assert.equal(listMyJobs(assignee, past).some((job) => job.jobKind === "client_return"), true);
      const carried = listMyJobs(assignee).find((job) => job.jobKind === "client_return");
      assert.ok(carried);
      assert.equal(carried.overdue, true);
      assert.equal(carried.workDate, past);
    });
    db.close();
  });

  it("refuses a future job marked already done, and refuses a completed job with no real time", () => {
    const db = prepared();
    withDatabase(db, () => {
      const assignee = driver("Future Driver", "futuredriver");
      assert.throws(
        () =>
          assignDayJob({
            assigneeId: assignee,
            jobKind: "hire_delivery",
            claimId: "",
            hireEpisodeId: "h-c3",
            actorId: "staff-justin",
            workDate: isoDateFromNow(3),
            completed: true,
            actualDriverId: assignee,
            actualOccurredAt: "2026-09-20T01:00",
          }),
        /future date cannot be marked as already done/,
      );
      assert.throws(
        () =>
          assignDayJob({
            assigneeId: assignee,
            jobKind: "client_recovery",
            claimId: "c3",
            hireEpisodeId: "",
            actorId: "staff-justin",
            workDate: londonTodayIso(),
            completed: true,
            actualDriverId: assignee,
            actualOccurredAt: "",
          }),
        /Enter the date and time this happened/,
      );
      assert.equal(listMyJobs(assignee).length, 0);
    });
    db.close();
  });

  it("keeps an unfinished job on the list as overdue, and leaves today's and future jobs unmarked", () => {
    const db = prepared();
    withDatabase(db, () => {
      const assignee = driver("Overdue Driver", "overduedriver");
      const yesterday = isoDateFromNow(-1);
      const older = isoDateFromNow(-12);
      const today = londonTodayIso();
      const future = isoDateFromNow(4);
      const late = assignDayJob({
        assigneeId: assignee,
        jobKind: "hire_delivery",
        claimId: "",
        hireEpisodeId: "h-c3",
        actorId: "staff-justin",
        workDate: yesterday,
      });
      const stillOpen = assignDayJob({
        assigneeId: assignee,
        jobKind: "client_recovery",
        claimId: "c4",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: older,
      });
      const dueToday = assignDayJob({
        assigneeId: assignee,
        jobKind: "hire_collection",
        claimId: "",
        hireEpisodeId: "h-c4",
        actorId: "staff-justin",
        workDate: today,
      });
      assignDayJob({
        assigneeId: assignee,
        jobKind: "client_return",
        claimId: "c4",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: future,
      });
      const finished = assignDayJob({
        assigneeId: assignee,
        jobKind: "hire_collection",
        claimId: "",
        hireEpisodeId: "h-c7",
        actorId: "staff-justin",
        workDate: yesterday,
        completed: true,
        actualDriverId: assignee,
        actualOccurredAt: `${yesterday}T16:00`,
      });
      const listed = listMyJobs(assignee);
      const overdue = listed.find((job) => job.id === late.id);
      const olderJob = listed.find((job) => job.id === stillOpen.id);
      const todays = listed.find((job) => job.id === dueToday.id);
      assert.ok(overdue);
      assert.equal(overdue.overdue, true);
      assert.equal(overdue.workDate, yesterday);
      assert.equal(overdue.completed, false);
      assert.ok(olderJob);
      assert.equal(olderJob.overdue, true);
      assert.equal(olderJob.workDate, older);
      assert.ok(todays);
      assert.equal(todays.overdue, false);
      assert.equal(todays.completed, false);
      assert.equal(listed.some((job) => job.workDate === future), false);
      assert.equal(listed.some((job) => job.id === finished.id), false);
      ensureStaffAuth(db);
      ensureDemoDayJobs(db);
      assert.equal(listMyJobs("staff-driver").some((job) => job.jobKind === "handover" && job.workDate === today), true);
      assert.equal(listMyJobs("staff-driver").some((job) => job.overdue), false);
      assert.equal(listMyJobs("staff-mechanic").some((job) => job.jobKind === "repair" && job.overdue), false);
    });
    db.close();
  });

  it("stores the handover's actual driver and time separately from the person who typed it and from the save time", () => {
    const db = prepared();
    withDatabase(db, () => {
      const whoDidIt = driver("Recovery Driver", "recoverydriver");
      const before = Date.now();
      const saved = recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_recovered",
        hireEpisodeId: "",
        mileage: "54000",
        fuelLevel: "half",
        conditionNote: "Roadside, written up later.",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: whoDidIt,
        actualOccurredAt: "2026-09-20T02:15",
      });
      const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
      assert.ok(row);
      assert.equal(row.actualDriverId, whoDidIt);
      assert.equal(row.actualDriverName, "Recovery Driver");
      assert.equal(row.recordedBy, "staff-sian");
      assert.match(formatUkDateTime(row.occurredAt), /20\/09\/2026 02:15/);
      assert.ok(new Date(row.createdAt).getTime() >= before - 2000);
      assert.notEqual(row.occurredAt, row.createdAt);
      assert.throws(
        () =>
          recordVehicleHandover({
            claimId: "c3",
            eventKind: "client_recovered",
            hireEpisodeId: "",
            mileage: "1",
            fuelLevel: "empty",
            conditionNote: "",
            actorId: "staff-sian",
            photos: [],
            actualDriverId: "",
            actualOccurredAt: "",
          }),
        /Enter the date and time this happened/,
      );
    });
    db.close();
  });

  it("lets a member of staff be recorded as the person who did the handover", () => {
    const db = prepared();
    withDatabase(db, () => {
      const mechanic = createStaffAccount({
        name: "Bay Mechanic",
        username: "baymechhandover",
        email: "baymechhandover@example.test",
        password: "password1",
        role: "mechanic",
        actorId: "staff-justin",
      });
      if (!mechanic.ok) throw new Error(mechanic.error);
      const saved = recordVehicleHandover({
        claimId: "c3",
        eventKind: "hire_delivered",
        hireEpisodeId: "h-c3",
        mileage: "12000",
        fuelLevel: "full",
        conditionNote: "Justin delivered it.",
        actorId: "staff-sian",
        photos: [],
        actualDriverId: "staff-justin",
        actualOccurredAt: "2026-09-22T09:15",
      });
      const row = listVehicleHandovers("c3").find((item) => item.id === saved.id);
      assert.equal(row?.actualDriverId, "staff-justin");
      assert.equal(row?.actualDriverName, "Justin Roberts");
      assert.equal(row?.recordedBy, "staff-sian");
      assert.throws(
        () =>
          recordVehicleHandover({
            claimId: "c3",
            eventKind: "hire_delivered",
            hireEpisodeId: "h-c3",
            mileage: "12001",
            fuelLevel: "full",
            conditionNote: "",
            actorId: "staff-sian",
            photos: [],
            actualDriverId: mechanic.id,
            actualOccurredAt: "2026-09-22T09:20",
          }),
        /Choose the person who did this job/,
      );
    });
    db.close();
  });

  it("lets a driver assigned only a client's-vehicle job record that recovery", () => {
    const db = prepared();
    withDatabase(db, () => {
      const assignee = driver("Yard Driver", "yarddriver");
      assignDayJob({
        assigneeId: assignee,
        jobKind: "client_recovery",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-justin",
        workDate: londonTodayIso(),
      });
      const saved = recordVehicleHandover({
        claimId: "c3",
        eventKind: "client_recovered",
        hireEpisodeId: "",
        mileage: "100",
        fuelLevel: "quarter",
        conditionNote: "",
        actorId: assignee,
        photos: [],
        actualDriverId: assignee,
        actualOccurredAt: `${londonTodayIso()}T11:00`,
      });
      assert.ok(saved.id);
      assert.throws(
        () =>
          recordVehicleHandover({
            claimId: "c3",
            eventKind: "hire_delivered",
            hireEpisodeId: "h-c3",
            mileage: "100",
            fuelLevel: "quarter",
            conditionNote: "",
            actorId: assignee,
            photos: [],
            actualDriverId: assignee,
            actualOccurredAt: `${londonTodayIso()}T11:05`,
          }),
        /not assigned to you today/,
      );
    });
    db.close();
  });

  it("lets a member of staff be assigned a recovery and be named as the person who did it", () => {
    const db = prepared();
    withDatabase(db, () => {
      const mechanic = createStaffAccount({
        name: "Bay Mechanic",
        username: "baymechanic",
        email: "baymechanic@example.test",
        password: "password1",
        role: "mechanic",
        actorId: "staff-justin",
      });
      if (!mechanic.ok) throw new Error(mechanic.error);
      const saved = assignDayJob({
        assigneeId: "staff-justin",
        jobKind: "client_recovery",
        claimId: "c3",
        hireEpisodeId: "",
        actorId: "staff-sian",
        workDate: londonTodayIso(),
        completed: true,
        actualDriverId: "staff-sian",
        actualOccurredAt: `${londonTodayIso()}T09:15`,
      });
      const job = listMyJobs("staff-justin").find((row) => row.id === saved.id);
      assert.ok(job);
      assert.equal(job.actualDriverId, "staff-sian");
      assert.throws(
        () =>
          assignDayJob({
            assigneeId: mechanic.id,
            jobKind: "hire_delivery",
            claimId: "",
            hireEpisodeId: "h-c3",
            actorId: "staff-justin",
            workDate: londonTodayIso(),
          }),
        /Choose a driver, or a member of staff/,
      );
    });
    db.close();
  });

  it("offers all four job types and a date on the assign form", () => {
    const form = fs.readFileSync(path.join(process.cwd(), "src/components/jobs/AssignJobForm.tsx"), "utf8");
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/jobs/page.tsx"), "utf8");
    assert.match(form, /Assign a job/);
    assert.match(form, /Hire car delivery/);
    assert.match(form, /Hire car collection/);
    assert.match(form, /Recover client's vehicle/);
    assert.match(form, /Return client's vehicle after repair/);
    assert.match(form, /Already completed/);
    assert.match(form, /datetime-local/);
    assert.match(form, /action=\{action\}/);
    assert.match(page, /Assigned for/);
    assert.match(page, /Not done/);
    assert.match(page, /still not done from an earlier day/);
    assert.match(page, /Overdue/);
    assert.match(page, /AssignJobForm/);
    assert.doesNotMatch(page, /Assign a job for today/);
    const handover = fs.readFileSync(path.join(process.cwd(), "src/components/handover/HandoverStartForm.tsx"), "utf8");
    assert.match(handover, /Driver who did this/);
    assert.match(handover, /Date and time this happened/);
    assert.match(handover, /datetime-local/);
  });
});

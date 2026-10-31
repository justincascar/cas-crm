import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { buildClaimSummaryModel } from "../src/lib/claims/claim-summary.ts";
import { get, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import {
  closeStaleBooking,
  confirmFleetRecordCheck,
  fleetAvailability,
  fleetCountsToday,
  listFleetRecordsToCheck,
} from "../src/lib/db/fleet-availability.ts";
import { generateHireAgreementDocument, setGtaMarkupPercent } from "../src/lib/db/hire-agreement.ts";
import { hireChargeForClaim } from "../src/lib/db/hire-charge.ts";
import {
  chooseHireCar,
  completeHireHandover,
  loadHireArea,
  saveHireNeed,
  setHireDailyRate,
  uploadSignedHireAgreement,
} from "../src/lib/db/hire-choice.ts";
import { gtaTableFor, listGtaTables, parseGtaFigures, saveGtaTable, settingsDailyRatePence } from "../src/lib/db/gta-rates.ts";
import { agreementMandatoryGaps, hireHandoverBlock } from "../src/lib/db/hire-readiness.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { listDriverJobs, listMyJobs, reassignDayJob } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { listHireDrivers, recordLicenceCheck } from "../src/lib/db/prehire-checks.ts";
import { createReservation, listClaims } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow, londonTodayIso } from "../src/lib/dates.ts";
import { GTA_REFERENCE_RATES_PENCE, standardDailyRatePence } from "../src/lib/documents/gta.ts";
import { evaluateFleetAvailability, type FleetBooking, type FleetCarRecord } from "../src/lib/domain/fleet-availability.ts";
import { prepareAgreementItems, recordPassingPrehireChecks, TEST_LICENCE_NUMBER } from "./prehire-setup.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-hire-readiness-"));

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const SIGNED = { buffer: Buffer.from("%PDF-1.4"), filename: "signed-hire-agreement.pdf", mimeType: "application/pdf" };

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  // Fictional files: the client's own car group was never looked up, which the group check (R27) accepts with a reason.
  db.exec(`UPDATE vehicles SET gta_unclassified_reason = 'Fictional test car: group not looked up' WHERE gta_group IS NULL AND id IN (SELECT client_vehicle_id FROM claims)`);
  return db;
}

function car(id: string, status = "available"): FleetCarRecord {
  return { id, registration: id.toUpperCase(), status, removed: false };
}

function booking(input: Partial<FleetBooking> & { fleetVehicleId: string }): FleetBooking {
  return {
    id: `b-${input.fleetVehicleId}`,
    kind: "reservation",
    claimId: "other",
    fileReference: "TEST-0099",
    startAt: "2026-10-01T09:00:00.000Z",
    endAt: "2026-10-12T18:00:00.000Z",
    handedOver: true,
    ...input,
  };
}

function needYes(claimId: string, key: string) {
  saveHireNeed({ claimId, choice: "yes", reason: "Own car cannot be driven and is needed for work.", actorId: "staff-sian", submitKey: key });
}

function choose(claimId: string, fleetVehicleId: string, key: string, extra: { date?: string; driverId?: string } = {}) {
  return chooseHireCar({
    claimId,
    fleetVehicleId,
    method: "deliver",
    date: extra.date || isoDateFromNow(5),
    time: "10:00",
    address: "1 Test Street, Cardiff",
    actorId: "staff-sian",
    submitKey: key,
    driverId: extra.driverId,
  });
}

describe("one fleet availability rule", () => {
  const today = "2026-10-28";
  const window = { startDay: "2026-10-28", endDay: "2027-01-24", today };

  it("holds a car whose booking ended weeks ago but was never returned, and lists it to check", () => {
    const [row] = evaluateFleetAvailability({ ...window, cars: [car("fv-2", "on_hire")], bookings: [booking({ fleetVehicleId: "fv-2" })] });
    assert.equal(row.free, false);
    assert.equal(row.heldBy, "TEST-0099");
    assert.equal(row.state, "on_hire");
    assert.match(row.checks[0]?.text || "", /ended 12\/10\/2026, but the car has not been returned/);
  });

  it("holds a car shown as on hire with no booking at all", () => {
    const [row] = evaluateFleetAvailability({ ...window, cars: [car("fv-4", "on_hire")], bookings: [] });
    assert.equal(row.free, false);
    assert.equal(row.reason, "Shown as on hire");
    assert.match(row.checks[0]?.text || "", /no open hire or booking/);
  });

  it("holds a car in maintenance, and a car shown as reserved", () => {
    const rows = evaluateFleetAvailability({ ...window, cars: [car("fv-6", "maintenance"), car("fv-1", "reserved")], bookings: [] });
    assert.equal(rows[0].free, false);
    assert.equal(rows[0].reason, "In maintenance");
    assert.equal(rows[1].free, false);
    assert.equal(rows[1].reason, "Shown as reserved");
  });

  it("treats the same London day as a clash and the next day as free", () => {
    const future = booking({ fleetVehicleId: "fv-10", handedOver: false, startAt: "2026-11-01T09:00:00.000Z", endAt: "2026-11-05T22:00:00.000Z" });
    const sameDay = evaluateFleetAvailability({ cars: [car("fv-10")], bookings: [future], startDay: "2026-11-05", endDay: "2026-11-05", today });
    assert.equal(sameDay[0].free, false);
    assert.equal(sameDay[0].heldBy, "TEST-0099");
    const nextDay = evaluateFleetAvailability({ cars: [car("fv-10")], bookings: [future], startDay: "2026-11-06", endDay: "2026-11-06", today });
    assert.equal(nextDay[0].free, true);
  });

  it("does not hold a car against the file that has it", () => {
    const own = booking({ fleetVehicleId: "fv-10", claimId: "mine", handedOver: false, startAt: "2026-11-01T09:00:00.000Z", endAt: "2027-01-28T23:59:00.000Z" });
    const [row] = evaluateFleetAvailability({ ...window, cars: [car("fv-10", "reserved")], bookings: [own], ignoreClaimId: "mine" });
    assert.equal(row.free, true);
  });
});

describe("the server refuses a car that is not free", () => {
  it("refuses an on-hire car whose booking is past its end, a status-only car, maintenance, a reserved car and a same-day clash", () => {
    const db = prepared();
    withDatabase(db, () => {
      needYes("c1", "need-c1");
      needYes("c12", "need-c12");
      // CAS 2 is out on TEST-0003. Its booking ended ten days ago and the car has not come back.
      db.prepare(`UPDATE reservations SET end_at = ? WHERE id = 'r-c3'`).run(`${isoDateFromNow(-10)}T18:00:00.000Z`);
      assert.throws(() => choose("c1", "fv-2", "past"), /booked on TEST-0003/);
      // CAS 4 is marked on hire with nothing behind it.
      db.prepare(`UPDATE fleet_vehicles SET status = 'on_hire' WHERE id = 'fv-4'`).run();
      assert.throws(() => choose("c1", "fv-4", "status"), /not available \(shown as on hire\)/);
      assert.throws(() => choose("c1", "fv-6", "maintenance"), /not available \(in maintenance\)/);
      assert.throws(() => choose("c1", "fv-1", "reserved"), /booked on TEST-0002/);
      // CAS 10 is free until c1 takes it. The same day for another file is then a clash.
      choose("c1", "fv-10", "c1-takes-10");
      assert.throws(() => choose("c12", "fv-10", "clash"), /This car has just been booked on TEST-0001/);
      // A staff booking from Hire / Fleet uses the same rule.
      assert.throws(
        () => createReservation({ fleetVehicleId: "fv-4", startAt: `${isoDateFromNow(2)}T09:00:00.000Z`, endAt: `${isoDateFromNow(3)}T09:00:00.000Z`, kind: "staff", createdBy: "staff-sian" }),
        /not available/,
      );
      const offered = loadHireArea("c12", { transmission: "", seats: "" });
      const ids = [...(offered?.cars || []), ...(offered?.carsMissingDetails || [])].map((item) => item.id);
      for (const held of ["fv-1", "fv-2", "fv-3", "fv-4", "fv-5", "fv-6", "fv-7", "fv-8", "fv-9", "fv-10"]) {
        assert.equal(ids.includes(held), false, `${held} should not be offered`);
      }
    });
    db.close();
  });

  it("lists disagreements on Fleet records to check, and a person can confirm or close them", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE reservations SET end_at = ? WHERE id = 'r-c3'`).run(`${isoDateFromNow(-10)}T18:00:00.000Z`);
      db.prepare(
        `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
         VALUES ('r-stale', 'fv-10', NULL, ?, ?, 'staff', 'reserved', 0, 'staff-sian', ?)`,
      ).run(`${isoDateFromNow(-9)}T09:00:00.000Z`, `${isoDateFromNow(-8)}T09:00:00.000Z`, new Date().toISOString());
      const listed = listFleetRecordsToCheck();
      const overdue = listed.find((row) => row.fleetVehicleId === "fv-2");
      assert.ok(overdue?.confirmable);
      const stale = listed.find((row) => row.fleetVehicleId === "fv-10");
      assert.equal(stale?.closeBookingId, "r-stale");
      assert.ok(fleetCountsToday().check >= 2);
      confirmFleetRecordCheck({ fleetVehicleId: "fv-2", checkKey: String(overdue?.key), actorId: "staff-sian" });
      assert.equal(listFleetRecordsToCheck().some((row) => row.key === overdue?.key), false);
      // Still with the customer, so still not free.
      assert.equal(fleetAvailability({ startAt: londonTodayIso(), endAt: londonTodayIso() }).find((row) => row.carId === "fv-2")?.free, false);
      closeStaleBooking({ reservationId: "r-stale", actorId: "staff-sian" });
      assert.equal(get<{ status: string }>(`SELECT status FROM reservations WHERE id = 'r-stale'`)?.status, "cancelled");
    });
    db.close();
  });
});

describe("daily rate kept on the hire", () => {
  it("stores the Settings rate for the group charged at reservation, with the date, and a Settings change does not alter it", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE vehicles SET gta_group = 'S3' WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c1')`).run();
      needYes("c1", "need-rate");
      const chosen = choose("c1", "fv-10", "rate-choose");
      const expected = standardDailyRatePence("S3", 30);
      const episode = get<{ rate_pence_per_day: number; rate_taken_on: string; rate_group: string }>(
        `SELECT rate_pence_per_day, rate_taken_on, rate_group FROM hire_episodes WHERE id = ?`,
        [chosen.episodeId],
      );
      assert.equal(episode?.rate_pence_per_day, expected);
      assert.equal(episode?.rate_taken_on, londonTodayIso());
      assert.equal(episode?.rate_group, "S3");
      setGtaMarkupPercent("50");
      choose("c1", "fv-10", "rate-choose-again", { date: isoDateFromNow(6) });
      assert.equal(loadHireArea("c1")?.ratePence, expected);
      recordPassingPrehireChecks("c1");
      prepareAgreementItems("c1");
      const agreement = generateHireAgreementDocument("c1", "staff-sian");
      assert.equal(agreement.view.dailyRatePence, expected);
    });
    db.close();
  });

  it("says the rate is missing when there is no group, and never invents one", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE vehicles SET gta_group = NULL WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c1')`).run();
      needYes("c1", "need-none");
      choose("c1", "fv-10", "none-choose");
      const area = loadHireArea("c1");
      assert.equal(area?.rateMissing, true);
      assert.equal(area?.ratePence, null);
      assert.equal(area?.next.label, "Set the daily rate");
      assert.match(String(hireHandoverBlock("c1")), /licence check|daily rate/i);
      setHireDailyRate({ claimId: "c1", group: "S2", actorId: "staff-sian", submitKey: "set-s2" });
      assert.equal(loadHireArea("c1")?.ratePence, standardDailyRatePence("S2", 30));
    });
    db.close();
  });
});

describe("final agreement needs every mandatory item", () => {
  const cases: Array<[string, string, (db: DatabaseSync) => void]> = [
    ["Hirer's name", "hirer's name", (db) => db.prepare(`UPDATE people SET full_name = '' WHERE id = 'p-aled'`).run()],
    ["Hirer's address", "hirer's address", (db) => db.prepare(`UPDATE people SET address_line1 = 'Unknown' WHERE id = 'p-aled'`).run()],
    ["Date of birth", "date of birth", (db) => db.prepare(`UPDATE people SET date_of_birth = NULL WHERE id = 'p-aled'`).run()],
    ["Licence number", "licence number", (db) => db.prepare(`UPDATE people SET licence_number = NULL WHERE id = 'p-aled'`).run()],
    [
      "Licence expiry date",
      "licence expiry date",
      (db) => {
        db.prepare(`UPDATE people SET licence_expires_on = NULL WHERE id = 'p-aled'`).run();
        db.prepare(`UPDATE hire_pack_data SET licence_expires_on = NULL WHERE claim_id = 'c1'`).run();
        db.prepare(`UPDATE licence_checks SET licence_expires_on = '' WHERE claim_id = 'c1'`).run();
      },
    ],
    ["Hire car (make, model and registration)", "hire car", (db) => db.prepare(`UPDATE hire_episodes SET fleet_vehicle_id = NULL WHERE claim_id = 'c1'`).run()],
    [
      "Planned handover date",
      "planned handover date",
      (db) => {
        db.prepare(`UPDATE day_assignments SET cancelled_at = '2026-10-28T00:00:00.000Z' WHERE claim_id = 'c1'`).run();
        db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE claim_id = 'c1'`).run();
      },
    ],
    ["Daily rate", "daily rate", (db) => db.prepare(`UPDATE hire_episodes SET rate_pence_per_day = NULL WHERE claim_id = 'c1'`).run()],
    [
      "Group charged",
      "group charged",
      (db) => {
        db.prepare(`UPDATE hire_pack_data SET group_charged = NULL WHERE claim_id = 'c1'`).run();
        db.prepare(`UPDATE vehicles SET gta_group = NULL WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = 'c1')`).run();
      },
    ],
    ["Why a hire car is needed", "why a hire car is needed", (db) => db.prepare(`UPDATE hire_pack_data SET need_reason = '' WHERE claim_id = 'c1'`).run()],
  ];

  for (const [label, words, remove] of cases) {
    it(`refuses the agreement and links the gap when this is missing: ${label}`, () => {
      const db = prepared();
      withDatabase(db, () => {
        needYes("c1", `need-${words}`);
        choose("c1", "fv-10", `choose-${words}`);
        recordPassingPrehireChecks("c1");
        prepareAgreementItems("c1");
        assert.deepEqual(agreementMandatoryGaps("c1"), []);
        remove(db);
        const gap = agreementMandatoryGaps("c1").find((item) => item.label === label);
        assert.ok(gap, `${label} should be listed`);
        assert.match(gap.href, /^\/claims\/c1\//);
        const before = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c1' AND template_key = 'hire_agreement'`)?.n);
        // A blank name also leaves nobody to drive, so the pre-hire check refuses it first. Either way nothing is filed.
        const expected = label === "Hirer's name" ? /hirer's name|person who will drive/ : new RegExp(words.replace(/[()]/g, "\\$&"));
        assert.throws(() => generateHireAgreementDocument("c1", "staff-sian"), expected);
        assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c1' AND template_key = 'hire_agreement'`)?.n), before);
      });
      db.close();
    });
  }
});

describe("licence number on the check", () => {
  it("refuses OK to drive without a licence number, and saves a typed number to the person's record", () => {
    const db = prepared();
    withDatabase(db, () => {
      const driver = listHireDrivers("c1")[0];
      assert.equal(driver.licenceNumber, "");
      const check = { claimId: "c1", actorId: "staff-sian", driverKey: driver.key, category: "B", penaltyPoints: 0, licenceExpiresOn: "2031-05-01", checkedOn: londonTodayIso() };
      assert.throws(() => recordLicenceCheck(check), /licence number\. The check cannot be saved as OK to drive without it/);
      assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM licence_checks WHERE claim_id = 'c1'`)?.n), 0);
      recordLicenceCheck({ ...check, licenceNumber: "testx 901010 ab9cd" });
      const person = get<{ licence_number: string; licence_expires_on: string }>(`SELECT licence_number, licence_expires_on FROM people WHERE id = 'p-aled'`);
      assert.equal(person?.licence_number, TEST_LICENCE_NUMBER);
      assert.equal(person?.licence_expires_on, "2031-05-01");
      assert.equal(listHireDrivers("c1")[0].licenceNumber, TEST_LICENCE_NUMBER);
    });
    db.close();
  });
});

describe("signed agreement at handover", () => {
  function readyForHandover(db: DatabaseSync) {
    void db;
    needYes("c1", "need-h");
    choose("c1", "fv-10", "choose-h");
    recordPassingPrehireChecks("c1");
    prepareAgreementItems("c1");
    generateHireAgreementDocument("c1", "staff-sian");
  }
  const handover = (key: string, extra: Partial<Parameters<typeof completeHireHandover>[0]> = {}) =>
    completeHireHandover({
      claimId: "c1",
      mileage: 1200,
      fuelLevel: "full",
      driverId: "staff-driver",
      date: londonTodayIso(),
      time: "09:00",
      actorId: "staff-sian",
      submitKey: key,
      ...extra,
    });

  it("blocks the handover without the signed copy, and starts hire with the stored rate once it is uploaded", () => {
    const db = prepared();
    withDatabase(db, () => {
      readyForHandover(db);
      assert.throws(() => handover("no-copy"), /Upload the signed hire agreement first/);
      assert.equal(get<{ started_at: string | null }>(`SELECT started_at FROM hire_episodes WHERE claim_id = 'c1'`)?.started_at, null);
      handover("with-copy", { signedCopy: SIGNED });
      const doc = get<{ title: string; signed: number }>(`SELECT title, signed FROM documents WHERE claim_id = 'c1' AND document_type = 'signed_hire_agreement'`);
      assert.equal(doc?.title, "Signed hire agreement");
      assert.equal(doc?.signed, 1);
      const agreement = get<{ signed: number; rate_pence_per_day: number }>(
        `SELECT a.signed, a.rate_pence_per_day FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = 'c1'`,
      );
      assert.equal(agreement?.signed, 1);
      assert.equal(agreement?.rate_pence_per_day, 6653);
      const charge = hireChargeForClaim("c1");
      assert.equal(charge.charge.status, "calculated");
      if (charge.charge.status === "calculated") assert.equal(charge.charge.continuingRatePence, 6653);
    });
    db.close();
  });

  it("lets an authorised user hand over without the signed copy with a reason, and refuses anyone else", () => {
    const db = prepared();
    withDatabase(db, () => {
      readyForHandover(db);
      assert.throws(() => handover("sian-override", { overrideReason: "Client signs tomorrow." }), /do not have permission/);
      assert.throws(() => handover("blank-reason", { actorId: "staff-justin", overrideReason: " " }), /Upload the signed hire agreement first/);
      handover("justin-override", { actorId: "staff-justin", overrideReason: "Client signs tomorrow at the office." });
      assert.ok(get<{ started_at: string }>(`SELECT started_at FROM hire_episodes WHERE claim_id = 'c1'`)?.started_at);
      const kept = get<{ reason: string }>(`SELECT reason FROM prehire_overrides WHERE claim_id = 'c1' AND check_kind = 'signed_agreement'`);
      assert.equal(kept?.reason, "Client signs tomorrow at the office.");
      assert.equal(loadHireArea("c1")?.signed, null);
    });
    db.close();
  });

  it("asks for no agreement on a fault courtesy car", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE hire_episodes SET collection_at = '2026-10-01' WHERE claim_id = 'c4'`).run();
      needYes("c4", "need-c4");
      choose("c4", "fv-10", "choose-c4");
      recordPassingPrehireChecks("c4");
      assert.equal(loadHireArea("c4")?.rateMissing, false);
      assert.equal(hireHandoverBlock("c4"), null);
    });
    db.close();
  });
});

describe("driver jobs", () => {
  it("puts a delivery on the chosen driver's list, or shows it unassigned for the office", () => {
    const db = prepared();
    withDatabase(db, () => {
      needYes("c1", "need-d");
      needYes("c12", "need-d12");
      const day = isoDateFromNow(0);
      const chosen = choose("c1", "fv-10", "driver-choose", { date: day, driverId: "staff-driver" });
      assert.equal(listMyJobs("staff-driver", day).some((job) => job.id === chosen.jobId), true);
      const office = listDriverJobs().find((job) => job.id === chosen.jobId);
      assert.equal(office?.assigneeName, "Demo Driver");
      assert.equal(office?.place, "1 Test Street, Cardiff");
      db.prepare(`UPDATE fleet_vehicles SET status = 'available' WHERE id = 'fv-4'`).run();
      const unassigned = choose("c12", "fv-4", "unassigned-choose", { date: day });
      const row = listDriverJobs().find((job) => job.id === unassigned.jobId);
      assert.equal(row?.assigneeId, null);
      reassignDayJob({ jobId: String(unassigned.jobId), assigneeId: "staff-driver", actorId: "staff-sian" });
      assert.equal(listMyJobs("staff-driver", day).some((job) => job.id === unassigned.jobId), true);
      assert.throws(() => reassignDayJob({ jobId: String(unassigned.jobId), assigneeId: "", actorId: "staff-driver" }), /Only office staff/);
    });
    db.close();
  });
});

describe("status wording follows the steps", () => {
  it("moves the claims list position, the next action and the header on as hire steps complete", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const form = new FormData();
      form.set("client_forename", "Rhian");
      form.set("client_surname", "Steps");
      form.set("client_mobile", "07700900123");
      form.set("handlerId", "staff-sian");
      form.set("accidentDate", isoDateFromNow(-1));
      form.set("accidentTime", "14:30");
      form.set("claimType", "non_fault");
      form.set("roadworthiness", "roadworthy");
      form.set("needsReplacement", "yes");
      const created = await createClaimFromIntake(intakeFromFormData(form));
      db.prepare(`UPDATE vehicles SET gta_unclassified_reason = 'Fictional test car: group not looked up' WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = ?)`).run(created.id);
      const row = () => listClaims().find((item) => item.id === created.id);
      const header = () => buildClaimSummaryModel(created.id);
      assert.equal(get<{ next_action: string | null }>(`SELECT next_action FROM claims WHERE id = ?`, [created.id])?.next_action, null);
      assert.doesNotMatch(String(row()?.current_position), /intake captured/);
      assert.equal(header()?.staffNote, null);
      const firstPosition = String(row()?.current_position);

      needYes(created.id, "steps-need");
      db.prepare(`UPDATE fleet_vehicles SET status = 'available' WHERE id = 'fv-4'`).run();
      choose(created.id, "fv-4", "steps-choose", { date: londonTodayIso(), driverId: "staff-driver" });
      recordPassingPrehireChecks(created.id);
      prepareAgreementItems(created.id);
      db.prepare(
        `UPDATE people SET address_line1 = '12 Test Road', town = 'Cardiff', postcode = 'CF10 1AA'
         WHERE id = (SELECT client_person_id FROM claims WHERE id = ?)`,
      ).run(created.id);
      assert.match(String(row()?.current_position), /^Hire · /);
      assert.equal(row()?.next_action, "Pre-hire checks");
      generateHireAgreementDocument(created.id, "staff-sian");
      completeHireHandover({
        claimId: created.id,
        mileage: 10,
        fuelLevel: "full",
        driverId: "staff-driver",
        date: londonTodayIso(),
        time: "09:00",
        actorId: "staff-sian",
        submitKey: "steps-handover",
        signedCopy: SIGNED,
      });
      assert.doesNotMatch(String(row()?.current_position), /^Hire · /);
      assert.notEqual(String(row()?.current_position), firstPosition);
      assert.notEqual(row()?.next_action, "Arrange hire");
      assert.equal(header()?.staffNote, null);
      assert.doesNotMatch(String(header()?.stageLine), /^Hire/);
      assert.equal(header()?.runningText.includes("Daily rate missing"), false);
    });
    db.close();
  });
});

describe("GTA table in Settings", () => {
  it("copies the supplied 2026–27 table into Settings once, with its effective date and source", () => {
    const db = prepared();
    withDatabase(db, () => {
      const tables = listGtaTables();
      assert.equal(tables.length, 1);
      assert.equal(tables[0].effectiveFrom, "2026-07-01");
      assert.match(tables[0].source, /1 July 2026 – 30 June 2027/);
      assert.deepEqual(tables[0].rates, GTA_REFERENCE_RATES_PENCE);
      migrate(db);
      assert.equal(listGtaTables().length, 1);
      assert.equal(settingsDailyRatePence("S3"), 6653);
    });
    db.close();
  });

  it("uses a newer table for new reservations and leaves the rate on an existing hire unchanged", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE vehicles SET gta_group = 'S3' WHERE id IN (SELECT client_vehicle_id FROM claims WHERE id IN ('c1', 'c12'))`).run();
      needYes("c1", "gta-need-c1");
      choose("c1", "fv-10", "gta-choose-c1");
      assert.equal(loadHireArea("c1")?.ratePence, 6653);
      saveGtaTable({ effectiveFrom: londonTodayIso(), source: "Test table typed for this check", figures: "S1 40.00\nS3 60.00", actorId: "staff-sian" });
      assert.equal(gtaTableFor()?.source, "Test table typed for this check");
      assert.equal(settingsDailyRatePence("S3"), 7800);
      assert.equal(loadHireArea("c1")?.ratePence, 6653);
      db.prepare(`UPDATE fleet_vehicles SET status = 'available' WHERE id = 'fv-4'`).run();
      needYes("c12", "gta-need-c12");
      choose("c12", "fv-4", "gta-choose-c12");
      assert.equal(loadHireArea("c12")?.ratePence, 7800);
      assert.deepEqual(loadHireArea("c12")?.rateGroups, ["S1", "S3"]);
    });
    db.close();
  });

  it("takes no rate when no table is in force, and refuses figures it cannot read", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`DELETE FROM gta_rate_tables`).run();
      db.prepare(
        `INSERT INTO gta_rate_tables(id, effective_from, source, rates_json, created_at) VALUES ('later', '2099-01-01', 'Future', '{"S3":6000}', '2026-10-28T00:00:00.000Z')`,
      ).run();
      assert.equal(settingsDailyRatePence("S3"), null);
      needYes("c1", "none-need");
      choose("c1", "fv-10", "none-choose");
      assert.equal(loadHireArea("c1")?.rateMissing, true);
      assert.throws(() => setHireDailyRate({ claimId: "c1", group: "S3", actorId: "staff-sian", submitKey: "none-rate" }), /GTA table in Settings/);
      assert.throws(() => parseGtaFigures("S3 sixty pounds"), /could not be read/);
      assert.throws(() => parseGtaFigures("S3 60\nS3 61"), /listed twice/);
      assert.throws(() => saveGtaTable({ effectiveFrom: "2099-01-01", source: "Again", figures: "S3 60", actorId: "staff-sian" }), /already applies/);
      assert.throws(() => saveGtaTable({ effectiveFrom: "2026-07-01", source: " ", figures: "S3 60", actorId: "staff-sian" }), /where the figures came from/);
    });
    db.close();
  });
});

describe("signed copy before the handover", () => {
  it("accepts a copy signed beforehand, and records agreement 1 at the handover with the stored rate", () => {
    const db = prepared();
    withDatabase(db, () => {
      needYes("c1", "early-need");
      choose("c1", "fv-10", "early-choose");
      recordPassingPrehireChecks("c1");
      prepareAgreementItems("c1");
      generateHireAgreementDocument("c1", "staff-sian");
      uploadSignedHireAgreement({ claimId: "c1", actorId: "staff-sian", submitKey: "early-upload", file: SIGNED });
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = 'c1'`)?.n, 0);
      assert.equal(hireHandoverBlock("c1"), null);
      const day = isoDateFromNow(1);
      completeHireHandover({ claimId: "c1", mileage: 10, fuelLevel: "full", driverId: "staff-driver", date: day, time: "09:00", actorId: "staff-sian", submitKey: "early-handover" });
      const agreement = get<{ start_on: string; signed: number; rate_pence_per_day: number }>(
        `SELECT a.start_on, a.signed, a.rate_pence_per_day FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = 'c1'`,
      );
      assert.equal(agreement?.start_on, day);
      assert.equal(agreement?.signed, 1);
      assert.equal(agreement?.rate_pence_per_day, 6653);
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c1' AND document_type = 'signed_hire_agreement'`)?.n, 1);
    });
    db.close();
  });
});

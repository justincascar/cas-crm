import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agreementNeedsRenewalPrep,
  canReserveVehicle,
  engineerReportChaserDecision,
  hireChargesAccrualEnd,
  hirePackChaseDecision,
  faultCourtesyCreatesCreditHire,
  nextFileReference,
  repairableHireMayEnd,
  reservationStartsCharges,
  storageBillingEnd,
  storageStartFromRecovery,
  recoveryChargeTotalPence,
  totalLossOffHireDate,
  unsignedNearExpiryIsUrgent,
} from "../src/lib/domain/rules.ts";
import { offerIsNotReceipt, sumDistinctHeads } from "../src/lib/money.ts";

describe("fleet reservations", () => {
  it("blocks overlapping allocations including staff bookings", () => {
    const existing = [
      { vehicleId: "fv-1", startAt: "2026-09-15T08:00:00.000Z", endAt: "2026-09-20T18:00:00.000Z", status: "reserved" },
    ];
    const clash = canReserveVehicle({
      vehicleId: "fv-1",
      startAt: "2026-09-19T09:00:00.000Z",
      endAt: "2026-09-22T18:00:00.000Z",
      existing,
    });
    assert.equal(clash.ok, false);
    const ok = canReserveVehicle({
      vehicleId: "fv-1",
      startAt: "2026-09-20T18:00:00.000Z",
      endAt: "2026-09-22T18:00:00.000Z",
      existing,
    });
    assert.equal(ok.ok, true);
  });
});

describe("hire start and end rules", () => {
  it("does not start charges on a roadworthy reservation", () => {
    assert.equal(reservationStartsCharges({ roadworthiness: "roadworthy", chargesStarted: false }), false);
  });

  it("does not treat fault courtesy as credit hire", () => {
    assert.equal(faultCourtesyCreatesCreditHire(false), false);
  });

  it("ends repairable hire only after completion and customer return", () => {
    assert.equal(repairableHireMayEnd({ repairsComplete: true, repairedVehicleReturned: false }), false);
    assert.equal(repairableHireMayEnd({ repairsComplete: true, repairedVehicleReturned: true }), true);
  });

  it("starts total-loss off-hire only after a qualifying payment", () => {
    assert.equal(
      totalLossOffHireDate({ qualifyingPaymentAt: "2026-09-15T10:00:00.000Z", handlerConfirmedQualifying: false }),
      null,
    );
    const scheduled = totalLossOffHireDate({
      qualifyingPaymentAt: "2026-09-15T10:00:00.000Z",
      handlerConfirmedQualifying: true,
    });
    assert.ok(scheduled);
    assert.equal(new Date(scheduled).toISOString().slice(0, 10), "2026-09-22");
  });

  it("keeps storage billing end as an explicit date", () => {
    assert.equal(storageBillingEnd(null), null);
    assert.equal(storageBillingEnd("2026-09-18"), "2026-09-18");
  });

  it("starts storage on the same London day as recovery and does not invent extras", () => {
    assert.equal(storageStartFromRecovery("2026-09-15T23:30:00.000Z"), "2026-09-16");
    assert.equal(storageStartFromRecovery(null), null);
    assert.equal(
      recoveryChargeTotalPence({ charge: 39500, winch: 5000, ooh: 0, environmental: 0, forklift: 0, mileage: 0, manual: 1000 }),
      45500,
    );
  });
});

describe("agreements", () => {
  it("flags day-80 renewal preparation and unsigned expiry without inventing a signature", () => {
    assert.equal(
      agreementNeedsRenewalPrep({ startOn: "2026-06-27", asAt: "2026-09-15", renewalAlertDay: 80, maxDays: 88 }),
      true,
    );
    assert.equal(
      unsignedNearExpiryIsUrgent({ startOn: "2026-06-19", asAt: "2026-09-15", maxDays: 88, signed: false }),
      true,
    );
  });

  it("sequences demonstration references with TEST-", () => {
    assert.equal(nextFileReference("TEST-", 12), "TEST-0013");
  });
});

describe("financials and chasers", () => {
  it("does not treat an offer as a receipt or add claimed to agreed", () => {
    const totals = sumDistinctHeads([
      { claimed_pence: 100000, offered_pence: 20000, agreed_pence: 0, received_pence: 0 },
    ]);
    assert.equal(totals.claimed, 100000);
    assert.equal(totals.offered, 20000);
    assert.equal(totals.agreed, 0);
    assert.equal(totals.received, 0);
    assert.equal(offerIsNotReceipt(totals.offered, totals.received), true);
    assert.notEqual(totals.claimed + totals.agreed, totals.received);
  });

  it("sends one due engineer chaser and suppresses after a substantive reply", () => {
    const due = engineerReportChaserDecision({
      reportDispatched: true,
      unanswered: true,
      intervalDays: 3,
      daysSinceLast: 3,
      paused: false,
      substantiveReply: false,
      outOfOffice: false,
    });
    assert.equal(due.send, true);
    const reply = engineerReportChaserDecision({
      reportDispatched: true,
      unanswered: true,
      intervalDays: 3,
      daysSinceLast: 3,
      paused: false,
      substantiveReply: true,
      outOfOffice: false,
    });
    assert.equal(reply.send, false);
    const longer = engineerReportChaserDecision({
      reportDispatched: true,
      unanswered: true,
      intervalDays: 3,
      daysSinceLast: 3,
      paused: false,
      longerOverrideDays: 14,
      substantiveReply: false,
      outOfOffice: false,
    });
    assert.equal(longer.send, false);
  });

  it("runs hire-pack chases 05 then 06 then solicitor handoff, and resets after a rebuttal", () => {
    const first = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "hire_pack",
      daysSinceLastClockEvent: 3,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 150000,
    });
    assert.equal(first.send, true);
    assert.equal(first.next, "payment_chase_1");

    const second = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "chase_1",
      daysSinceLastClockEvent: 3,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 150000,
    });
    assert.equal(second.send, true);
    assert.equal(second.next, "payment_chase_2");

    const handoff = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "chase_2",
      daysSinceLastClockEvent: 3,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 150000,
    });
    assert.equal(handoff.send, false);
    assert.equal(handoff.next, "solicitor_handoff");

    const afterRebuttal = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "rebuttal",
      daysSinceLastClockEvent: 3,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 90000,
    });
    assert.equal(afterRebuttal.send, true);
    assert.equal(afterRebuttal.next, "payment_chase_1");
  });

  it("does not chase closed, disputed-awaiting-CAS or solicitor files, and keeps chasing after a partial payment", () => {
    const closed = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "hire_pack",
      daysSinceLastClockEvent: 10,
      intervalDays: 3,
      paused: false,
      closed: true,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 150000,
    });
    assert.equal(closed.send, false);
    const solicitors = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "hire_pack",
      daysSinceLastClockEvent: 10,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: true,
      outstandingBalancePence: 150000,
    });
    assert.equal(solicitors.send, false);
    const disputed = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "hire_pack",
      daysSinceLastClockEvent: 10,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: true,
      handedToSolicitors: false,
      outstandingBalancePence: 150000,
    });
    assert.equal(disputed.send, false);
    const paid = hirePackChaseDecision({
      hirePackSent: true,
      lastClockEvent: "hire_pack",
      daysSinceLastClockEvent: 10,
      intervalDays: 3,
      paused: false,
      closed: false,
      disputedAwaitingCasResponse: false,
      handedToSolicitors: false,
      outstandingBalancePence: 0,
    });
    assert.equal(paid.send, false);
  });

  it("stops hire charges at the earlier of vehicle return and total-loss cessation", () => {
    assert.equal(
      hireChargesAccrualEnd({
        vehicleReturnedAt: "2026-09-20T09:00:00.000Z",
        totalLossCessationAt: "2026-09-18T09:00:00.000Z",
      }),
      "2026-09-18T09:00:00.000Z",
    );
    assert.equal(hireChargesAccrualEnd({ vehicleReturnedAt: null, totalLossCessationAt: null }), null);
  });
});

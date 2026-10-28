import { londonTodayIso, nowUtcIso } from "../dates";
import {
  carNotFreeMessage,
  evaluateFleetAvailability,
  type FleetBooking,
  type FleetCarAvailability,
  type FleetCarRecord,
  type FleetCarState,
} from "../domain/fleet-availability";
import { londonDayOf } from "../domain/hire-availability";
import { formatVehicleRegistration } from "../text";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";

function fleetRecords(): FleetCarRecord[] {
  return all<{ id: string; status: string | null; removed_at: string | null; registration: string | null }>(
    `SELECT fv.id, fv.status, fv.removed_at, v.registration
     FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id`,
  ).map((row) => ({
    id: String(row.id),
    registration: row.registration ? formatVehicleRegistration(String(row.registration)) : "No registration",
    status: String(row.status || ""),
    removed: Boolean(row.removed_at),
  }));
}

/**
 * Open bookings and hires. A hire is open from the handover until the car is collected.
 * A reservation is open until it is cancelled, or until the hire it became has been collected or ended.
 */
export function listFleetBookings(): FleetBooking[] {
  const hires = all<{
    id: string;
    fleet_vehicle_id: string;
    claim_id: string;
    file_reference: string | null;
    started_at: string;
  }>(
    `SELECT he.id, he.fleet_vehicle_id, he.claim_id, c.file_reference, he.started_at
     FROM hire_episodes he
     JOIN claims c ON c.id = he.claim_id
     WHERE he.fleet_vehicle_id IS NOT NULL
       AND he.started_at IS NOT NULL
       AND he.billing_end_at IS NULL
       AND he.collection_at IS NULL`,
  );
  const reservations = all<{
    id: string;
    fleet_vehicle_id: string;
    claim_id: string | null;
    file_reference: string | null;
    start_at: string;
    end_at: string;
    status: string;
  }>(
    `SELECT r.id, r.fleet_vehicle_id, r.claim_id, c.file_reference, r.start_at, r.end_at, r.status
     FROM reservations r
     LEFT JOIN claims c ON c.id = r.claim_id
     WHERE r.status IN ('reserved', 'active')
       AND NOT EXISTS (
         SELECT 1 FROM hire_episodes he
         WHERE he.claim_id = r.claim_id AND he.fleet_vehicle_id = r.fleet_vehicle_id
           AND he.started_at IS NOT NULL
           AND (he.billing_end_at IS NOT NULL OR he.collection_at IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM hire_episodes open
             WHERE open.claim_id = r.claim_id AND open.fleet_vehicle_id = r.fleet_vehicle_id
               AND open.billing_end_at IS NULL AND open.collection_at IS NULL
           )
       )`,
  );
  const bookings: FleetBooking[] = [];
  const covered = new Set<string>();
  for (const hire of hires) {
    const match = reservations.find(
      (row) => row.claim_id === hire.claim_id && row.fleet_vehicle_id === hire.fleet_vehicle_id,
    );
    if (match) covered.add(match.id);
    bookings.push({
      id: match ? String(match.id) : String(hire.id),
      kind: match ? "reservation" : "hire",
      fleetVehicleId: String(hire.fleet_vehicle_id),
      claimId: String(hire.claim_id),
      fileReference: hire.file_reference ? String(hire.file_reference) : null,
      startAt: String(hire.started_at),
      endAt: match ? String(match.end_at) : null,
      handedOver: true,
    });
  }
  for (const row of reservations) {
    if (covered.has(row.id)) continue;
    bookings.push({
      id: String(row.id),
      kind: "reservation",
      fleetVehicleId: String(row.fleet_vehicle_id),
      claimId: row.claim_id ? String(row.claim_id) : null,
      fileReference: row.file_reference ? String(row.file_reference) : null,
      startAt: String(row.start_at),
      endAt: String(row.end_at),
      handedOver: String(row.status) === "active",
    });
  }
  return bookings;
}

function acknowledgedChecks(): Set<string> {
  return new Set(all<{ check_key: string }>(`SELECT check_key FROM fleet_record_checks`).map((row) => String(row.check_key)));
}

/** The single availability answer used by Choose a car, the reserve check, swaps, staff bookings and the dashboard. */
export function fleetAvailability(input: {
  startAt: string;
  endAt: string;
  ignoreClaimId?: string | null;
  today?: string;
}): FleetCarAvailability[] {
  const today = input.today || londonTodayIso();
  const startDay = londonDayOf(input.startAt) || today;
  const endDay = londonDayOf(input.endAt) || startDay;
  return evaluateFleetAvailability({
    cars: fleetRecords(),
    bookings: listFleetBookings(),
    startDay,
    endDay,
    today,
    ignoreClaimId: input.ignoreClaimId || null,
    acknowledged: acknowledgedChecks(),
  });
}

/** Throws the plain refusal when the car is not free for those dates. */
export function assertFleetCarFree(input: { fleetVehicleId: string; startAt: string; endAt: string; ignoreClaimId?: string | null }) {
  const found = fleetAvailability(input).find((row) => row.carId === input.fleetVehicleId);
  if (!found) throw new Error("That car is not on the fleet.");
  if (!found.free) throw new Error(carNotFreeMessage(found));
}

export type FleetRecordToCheck = {
  key: string;
  fleetVehicleId: string;
  registration: string;
  text: string;
  claimId: string | null;
  closeBookingId: string | null;
  confirmable: boolean;
};

export function listFleetRecordsToCheck(today = londonTodayIso()): FleetRecordToCheck[] {
  return fleetAvailability({ startAt: today, endAt: today, today })
    .filter((row) => row.state !== "removed")
    .flatMap((row) =>
      row.checks.map((check) => ({
        key: check.key,
        fleetVehicleId: row.carId,
        registration: row.registration,
        text: check.text,
        claimId: check.claimId,
        closeBookingId: check.closeBookingId,
        confirmable: check.confirmable,
      })),
    );
}

/** Today's state of every car on the fleet, for counts and the Hire / Fleet filter. */
export function fleetStatesToday(today = londonTodayIso()): Map<string, { state: FleetCarState; free: boolean; checks: number }> {
  return new Map(
    fleetAvailability({ startAt: today, endAt: today, today }).map((row) => [
      row.carId,
      { state: row.state, free: row.free, checks: row.checks.length },
    ]),
  );
}

export function fleetCountsToday(today = londonTodayIso()): Record<string, number> {
  const counts: Record<string, number> = { available: 0, reserved: 0, on_hire: 0, maintenance: 0, check: 0 };
  for (const row of fleetAvailability({ startAt: today, endAt: today, today })) {
    if (row.state === "removed") continue;
    if (row.checks.length > 0) counts.check += 1;
    if (row.state === "off_road") counts.maintenance += 1;
    else if (row.state === "on_hire") counts.on_hire += 1;
    else if (row.state === "reserved") counts.reserved += 1;
    else if (row.free) counts.available += 1;
  }
  return counts;
}

/** A person confirms an overdue booking is still with the customer. The car stays unavailable. */
export function confirmFleetRecordCheck(input: { fleetVehicleId: string; checkKey: string; actorId: string; note?: string }) {
  const listed = listFleetRecordsToCheck().find(
    (row) => row.fleetVehicleId === input.fleetVehicleId && row.key === input.checkKey && row.confirmable,
  );
  if (!listed) throw new Error("That fleet record is no longer on the list to check.");
  run(
    `INSERT INTO fleet_record_checks(id, fleet_vehicle_id, check_key, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [newId("frc"), input.fleetVehicleId, input.checkKey, (input.note || "Still with the customer.").slice(0, 500), input.actorId, nowUtcIso()],
  );
  if (listed.claimId) {
    recordClaimEvent({
      claimId: listed.claimId,
      eventType: "other",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Fleet record checked for ${listed.registration}: still with the customer. Hire charges were not changed.`,
      source: "staff",
    });
  }
}

/** Closes a booking on which no car went out. Charges are not touched, because none started. */
export function closeStaleBooking(input: { reservationId: string; actorId: string }) {
  const listed = listFleetRecordsToCheck().find((row) => row.closeBookingId === input.reservationId);
  if (!listed) throw new Error("That booking is no longer on the list to check.");
  const booking = get<{ id: string; claim_id: string | null; fleet_vehicle_id: string }>(
    `SELECT id, claim_id, fleet_vehicle_id FROM reservations WHERE id = ? AND status = 'reserved'`,
    [input.reservationId],
  );
  if (!booking) throw new Error("That booking is not open.");
  run(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`, [booking.id]);
  if (booking.claim_id) {
    recordClaimEvent({
      claimId: booking.claim_id,
      eventType: "hire_vehicle_released",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Old booking for ${listed.registration} closed from Fleet records to check. It was never handed over. Hire charges were not started.`,
      source: "staff",
    });
  }
}

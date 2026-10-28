import { formatUkDate } from "../dates";
import { londonDayOf } from "./hire-availability";

/**
 * One availability rule for every place that offers, books or counts a fleet car.
 * A car is not free for a date when any of these apply:
 *  - it has an open booking or hire covering that date
 *  - it has a booking or hire that has not been returned or closed, whatever its planned end date
 *  - its fleet status is on hire, reserved, maintenance, off road or sold (or it was removed)
 * Where the status and the bookings disagree the car is held back and named on "Fleet records to check".
 * Nothing here changes the data.
 */

export type FleetCarRecord = {
  id: string;
  registration: string;
  status: string;
  removed: boolean;
};

export type FleetBooking = {
  /** reservations.id, or the hire episode id when there is no open reservation for it. */
  id: string;
  kind: "reservation" | "hire";
  fleetVehicleId: string;
  claimId: string | null;
  fileReference: string | null;
  startAt: string;
  /** Planned end. Null for a hire with no booking end on file. */
  endAt: string | null;
  /** The car has gone out to the customer and has not come back. */
  handedOver: boolean;
};

export type FleetCarState = "available" | "reserved" | "on_hire" | "off_road" | "removed";

export type FleetRecordCheck = {
  key: string;
  text: string;
  /** A booking a person can close from the list because no car went out on it. */
  closeBookingId: string | null;
  /** A booking that is still out, which a person can confirm is still with the customer. */
  confirmable: boolean;
  claimId: string | null;
};

export type FleetCarAvailability = {
  carId: string;
  registration: string;
  free: boolean;
  state: FleetCarState;
  /** Plain words: why the car is not free. Null when free. */
  reason: string | null;
  /** File reference holding the car, or "a staff booking". */
  heldBy: string | null;
  checks: FleetRecordCheck[];
};

const OFF_ROAD_STATUS: Record<string, string> = {
  maintenance: "In maintenance",
  off_road: "Off road",
  sold: "Sold",
};

export function fleetStatusKey(status: string): string {
  return status.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function holder(booking: FleetBooking): string {
  return booking.fileReference || "a staff booking";
}

function bookingEndDay(booking: FleetBooking): string | null {
  return booking.endAt ? londonDayOf(booking.endAt) : null;
}

/** A booking that has begun and is not closed holds the car from its start, whatever its planned end. */
function bookingBlocks(booking: FleetBooking, startDay: string, endDay: string, today: string): boolean {
  const from = londonDayOf(booking.startAt);
  if (!from) return true;
  if (booking.handedOver || from <= today) return from <= endDay;
  const to = bookingEndDay(booking) || "9999-12-31";
  return from <= endDay && startDay <= to;
}

function recordChecks(car: FleetCarRecord, bookings: FleetBooking[], today: string, acknowledged: Set<string>): FleetRecordCheck[] {
  const checks: FleetRecordCheck[] = [];
  const status = fleetStatusKey(car.status);
  const out = bookings.filter((booking) => booking.handedOver);
  const waiting = bookings.filter((booking) => !booking.handedOver);
  for (const booking of out) {
    const end = bookingEndDay(booking);
    if (end && end < today) {
      const key = `overdue:${booking.id}:${end}`;
      if (!acknowledged.has(key)) {
        checks.push({
          key,
          text: `Booking on ${holder(booking)} ended ${formatUkDate(end)}, but the car has not been returned.`,
          closeBookingId: null,
          confirmable: true,
          claimId: booking.claimId,
        });
      }
    }
  }
  for (const booking of waiting) {
    const end = bookingEndDay(booking);
    if (end && end < today) {
      checks.push({
        key: `stale:${booking.id}`,
        text: `Booking on ${holder(booking)} ended ${formatUkDate(end)}, but it was never handed over or closed.`,
        closeBookingId: booking.kind === "reservation" ? booking.id : null,
        confirmable: false,
        claimId: booking.claimId,
      });
    }
  }
  if (status === "on_hire" && out.length === 0) {
    checks.push({
      key: `status-on-hire:${car.id}`,
      text:
        waiting.length > 0
          ? `Shown as on hire, but the only booking (${holder(waiting[0])}) has not been handed over.`
          : "Shown as on hire, but there is no open hire or booking for it.",
      closeBookingId: null,
      confirmable: false,
      claimId: waiting[0]?.claimId || null,
    });
  }
  if (status === "reserved" && bookings.length === 0) {
    checks.push({
      key: `status-reserved:${car.id}`,
      text: "Shown as reserved, but there is no open booking for it.",
      closeBookingId: null,
      confirmable: false,
      claimId: null,
    });
  }
  if ((status === "available" || OFF_ROAD_STATUS[status]) && out.length > 0) {
    const label = status === "available" ? "available" : OFF_ROAD_STATUS[status].toLowerCase();
    checks.push({
      key: `status-${status}:${car.id}`,
      text: `Shown as ${label}, but it is out on ${holder(out[0])} and has not been returned.`,
      closeBookingId: null,
      confirmable: false,
      claimId: out[0].claimId,
    });
  }
  return checks;
}

function currentState(car: FleetCarRecord, bookings: FleetBooking[], today: string): FleetCarState {
  if (car.removed) return "removed";
  const status = fleetStatusKey(car.status);
  if (OFF_ROAD_STATUS[status]) return "off_road";
  if (bookings.some((booking) => booking.handedOver)) return "on_hire";
  if (status === "on_hire") return "on_hire";
  const begun = bookings.some((booking) => (londonDayOf(booking.startAt) || "") <= today);
  if (begun || status === "reserved") return "reserved";
  return "available";
}

export function evaluateFleetAvailability(input: {
  cars: FleetCarRecord[];
  bookings: FleetBooking[];
  startDay: string;
  endDay: string;
  today: string;
  /** Bookings on this claim do not hold the car against itself. */
  ignoreClaimId?: string | null;
  /** Record checks a person has already confirmed. */
  acknowledged?: Set<string>;
}): FleetCarAvailability[] {
  const acknowledged = input.acknowledged || new Set<string>();
  return input.cars.map((car) => {
    const all = input.bookings.filter((booking) => booking.fleetVehicleId === car.id);
    const others = all.filter((booking) => !input.ignoreClaimId || booking.claimId !== input.ignoreClaimId);
    const own = all.length - others.length;
    const checks = recordChecks(car, all, input.today, acknowledged);
    const state = currentState(car, all, input.today);
    const status = fleetStatusKey(car.status);
    let reason: string | null = null;
    let heldBy: string | null = null;
    const blocking = others.find((booking) => bookingBlocks(booking, input.startDay, input.endDay, input.today));
    if (car.removed) reason = "Removed from the fleet";
    else if (OFF_ROAD_STATUS[status]) reason = OFF_ROAD_STATUS[status];
    else if (blocking) {
      heldBy = holder(blocking);
      reason = blocking.handedOver ? `Out on ${heldBy}` : `Booked on ${heldBy}`;
    } else if ((status === "on_hire" || status === "reserved") && !(own > 0 && others.length === 0)) {
      reason = status === "on_hire" ? "Shown as on hire" : "Shown as reserved";
    } else if (checks.some((check) => check.claimId !== input.ignoreClaimId || !input.ignoreClaimId)) {
      reason = "Fleet record to check";
    }
    return {
      carId: car.id,
      registration: car.registration,
      free: reason === null,
      state,
      reason,
      heldBy,
      checks,
    };
  });
}

/** The message a server refusal shows for a car that is not free. */
export function carNotFreeMessage(availability: FleetCarAvailability): string {
  if (availability.heldBy) return `This car has just been booked on ${availability.heldBy}. Please choose another.`;
  if (availability.reason === "Fleet record to check") {
    return `That car is held back until its fleet record is checked on Hire / Fleet. ${availability.checks[0]?.text || ""}`.trim();
  }
  return `That car is not available (${(availability.reason || "not free").toLowerCase()}). Please choose another.`;
}

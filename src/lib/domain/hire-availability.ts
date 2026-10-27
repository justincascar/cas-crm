import { AGREEMENT_LENGTH_DAYS } from "../constants";
import { londonDateIso } from "../dates";

export const HIRE_CLASH_MESSAGE_TAIL = "Please choose another.";

export function hireClashMessage(fileReference: string): string {
  return `This car has just been booked on ${fileReference}. ${HIRE_CLASH_MESSAGE_TAIL}`;
}

export const CHOOSE_CAR_BEFORE_HANDOVER =
  "Choose a car before the handover. Use Choose a car on the Hire tab.";

/** Europe/London calendar day for a date or a date-time. */
export function londonDayOf(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
    return londonDateIso(parsed);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

/**
 * Inclusive calendar-day overlap. A booking that ends on a day blocks another
 * booking that starts on that same day.
 */
export function hireDaysOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a0 = londonDayOf(aStart);
  const a1 = londonDayOf(aEnd);
  const b0 = londonDayOf(bStart);
  const b1 = londonDayOf(bEnd);
  if (!a0 || !a1 || !b0 || !b1) return false;
  return a0 <= b1 && b0 <= a1;
}

const OFF_ROAD = new Set(["maintenance", "off_road", "off-road", "sold"]);

export function fleetStatusBlocksHire(status: string, removed: boolean): boolean {
  if (removed) return true;
  const key = status.trim().toLowerCase().replaceAll(" ", "_");
  return OFF_ROAD.has(key);
}

export type HireCar = {
  id: string;
  registration: string;
  make: string;
  model: string;
  transmission: string;
  seats: number | null;
  vehicleClass: string;
  status: string;
  removed: boolean;
};

export type HireOccupation = {
  fleetVehicleId: string;
  claimId: string | null;
  fileReference: string | null;
  startAt: string;
  endAt: string;
  status: string;
};

export type ClientCarNeed = {
  transmission?: string | null;
  seats?: number | null;
  vehicleClass?: string | null;
};

export function suitableHireCars(input: {
  cars: HireCar[];
  occupied: HireOccupation[];
  startAt: string;
  endAt: string;
  ignoreClaimId?: string | null;
  client?: ClientCarNeed;
  transmission?: string;
  vehicleClass?: string;
  minSeats?: number | null;
}): HireCar[] {
  const wantTransmission = (input.transmission || input.client?.transmission || "").trim().toLowerCase();
  const wantClass = (input.vehicleClass || "").trim().toLowerCase();
  const clientClass = (input.client?.vehicleClass || "").trim().toLowerCase();
  const minSeats = input.minSeats ?? null;
  const clientSeats = input.client?.seats ?? null;
  const free = input.cars.filter((car) => {
    if (fleetStatusBlocksHire(car.status, car.removed)) return false;
    if (wantTransmission && input.transmission && car.transmission.trim().toLowerCase() !== wantTransmission) return false;
    if (wantClass && car.vehicleClass.trim().toLowerCase() !== wantClass) return false;
    if (minSeats != null && (car.seats == null || car.seats < minSeats)) return false;
    const clash = input.occupied.find((span) => {
      if (span.fleetVehicleId !== car.id) return false;
      if (input.ignoreClaimId && span.claimId === input.ignoreClaimId) return false;
      if (!["reserved", "active", "on_hire"].includes(span.status)) return false;
      return hireDaysOverlap(input.startAt, input.endAt, span.startAt, span.endAt);
    });
    return !clash;
  });
  const score = (car: HireCar) => {
    let n = 0;
    const transmission = car.transmission.trim().toLowerCase();
    const vehicleClass = car.vehicleClass.trim().toLowerCase();
    if (wantTransmission && transmission === wantTransmission) n += 4;
    if (clientClass && vehicleClass === clientClass) n += 2;
    if (clientSeats != null && car.seats != null && car.seats >= clientSeats) n += 1;
    return n;
  };
  return free.sort((a, b) => score(b) - score(a) || a.registration.localeCompare(b.registration, "en-GB"));
}

export function agreementHoldEndDay(startDay: string): string {
  const [year, month, day] = startDay.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + (AGREEMENT_LENGTH_DAYS - 1)));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type HireNeed = "yes" | "no" | "not_yet" | null;

export function parseHireNeed(details: string | null | undefined): HireNeed {
  const text = String(details || "");
  if (/not yet/i.test(text)) return "not_yet";
  if (/replacement vehicle:\s*no\b/i.test(text)) return "no";
  if (/replacement vehicle:\s*yes\b/i.test(text)) return "yes";
  return null;
}

export function hireNeedReason(details: string | null | undefined): string {
  const match = String(details || "").match(/Reason:\s*(.+)$/i);
  return match?.[1]?.trim() || "";
}

export const NOT_YET_OWN_CAR = "Not yet – client keeps own car";

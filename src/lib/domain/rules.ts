import { TOTAL_LOSS_HIRE_DAYS_AFTER_QUALIFYING_PAYMENT } from "../constants";
import { addCalendarDaysIso, daysBetweenLondon, londonDateIso } from "../dates";

export type ReservationInput = {
  vehicleId: string;
  startAt: string;
  endAt: string;
  existing: Array<{ vehicleId: string; startAt: string; endAt: string; status: string }>;
};

export function reservationsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return !(aEnd <= bStart || bEnd <= aStart);
}

export function canReserveVehicle(input: ReservationInput): { ok: true } | { ok: false; reason: string } {
  if (input.endAt <= input.startAt) {
    return { ok: false, reason: "Reservation end must be after start." };
  }
  const clash = input.existing.find(
    (row) =>
      row.vehicleId === input.vehicleId &&
      ["reserved", "active"].includes(row.status) &&
      reservationsOverlap(input.startAt, input.endAt, row.startAt, row.endAt),
  );
  if (clash) {
    return {
      ok: false,
      reason: "That vehicle is already allocated for an overlapping period, including staff bookings.",
    };
  }
  return { ok: true };
}

export function reservationStartsCharges(opts: {
  roadworthiness: string;
  chargesStarted: boolean;
}): boolean {
  // Opening a claim or making a reservation must not start charges.
  if (!opts.chargesStarted) return false;
  if (opts.roadworthiness === "roadworthy") return false;
  return opts.chargesStarted;
}

export function faultCourtesyCreatesCreditHire(creditHireFlag: boolean): boolean {
  return creditHireFlag === true;
}

export function repairableHireMayEnd(opts: {
  repairsComplete: boolean;
  repairedVehicleReturned: boolean;
}): boolean {
  return opts.repairsComplete && opts.repairedVehicleReturned;
}

export function totalLossOffHireDate(opts: {
  qualifyingPaymentAt: string | null;
  handlerConfirmedQualifying: boolean;
}): string | null {
  if (!opts.handlerConfirmedQualifying || !opts.qualifyingPaymentAt) return null;
  return addCalendarDaysIso(opts.qualifyingPaymentAt, TOTAL_LOSS_HIRE_DAYS_AFTER_QUALIFYING_PAYMENT);
}

export function storageBillingEnd(explicitEnd: string | null): string | null {
  return explicitEnd;
}

export function agreementDayNumber(startOn: string, asAt: string): number {
  return daysBetweenLondon(startOn, asAt) + 1;
}

export function agreementNeedsRenewalPrep(opts: {
  startOn: string;
  asAt: string;
  renewalAlertDay: number;
  maxDays: number;
}): boolean {
  const day = agreementDayNumber(opts.startOn, opts.asAt);
  return day >= opts.renewalAlertDay && day <= opts.maxDays;
}

export function unsignedNearExpiryIsUrgent(opts: {
  startOn: string;
  asAt: string;
  maxDays: number;
  signed: boolean;
}): boolean {
  const day = agreementDayNumber(opts.startOn, opts.asAt);
  return !opts.signed && day >= opts.maxDays - 3;
}

export function nextFileReference(prefix: string, lastNumber: number): string {
  const next = lastNumber + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function parseFileReferenceNumber(reference: string, prefix: string): number {
  if (!reference.startsWith(prefix)) return 0;
  const n = Number.parseInt(reference.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : 0;
}

export type ChaserDecision = {
  send: boolean;
  reason: string;
};

export function engineerReportChaserDecision(opts: {
  reportDispatched: boolean;
  unanswered: boolean;
  intervalDays: number;
  daysSinceLast: number | null;
  paused: boolean;
  longerOverrideDays?: number | null;
  substantiveReply: boolean;
  outOfOffice: boolean;
}): ChaserDecision {
  if (!opts.reportDispatched) return { send: false, reason: "Report has not been dispatched." };
  if (opts.paused) return { send: false, reason: "Handler pause in force." };
  if (opts.substantiveReply) return { send: false, reason: "Substantive reply suspends this chase." };
  if (opts.outOfOffice) return { send: false, reason: "Out-of-office is not a resolution; wait for review, do not treat as answered." };
  if (!opts.unanswered) return { send: false, reason: "Request is no longer unanswered." };
  const interval = opts.longerOverrideDays || opts.intervalDays;
  if (opts.daysSinceLast !== null && opts.daysSinceLast < interval) {
    return { send: false, reason: `Interval of ${interval} days not yet reached.` };
  }
  return { send: true, reason: `Due chaser after ${interval} calendar days (demonstration setting).` };
}

export function classifyUnknown(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "Unknown";
  return value;
}

/** Storage starts on the same London day as recovery. This is not a billing-end date. */
export function storageStartFromRecovery(recoveryAtIso: string | null | undefined): string | null {
  if (!recoveryAtIso) return null;
  const d = new Date(recoveryAtIso);
  if (Number.isNaN(d.getTime())) return null;
  return londonDateIso(d);
}

export function recoveryChargeTotalPence(parts: {
  charge?: number;
  winch?: number;
  ooh?: number;
  environmental?: number;
  forklift?: number;
  mileage?: number;
  manual?: number;
}): number {
  return (
    (parts.charge || 0) +
    (parts.winch || 0) +
    (parts.ooh || 0) +
    (parts.environmental || 0) +
    (parts.forklift || 0) +
    (parts.mileage || 0) +
    (parts.manual || 0)
  );
}

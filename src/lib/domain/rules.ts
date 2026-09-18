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

export type ChaseFileState = {
  closed?: boolean;
  disputedAwaitingCasResponse?: boolean;
  handedToSolicitors?: boolean;
  paused: boolean;
  substantiveReply: boolean;
  outOfOffice: boolean;
};

export function chaseStopReason(file: Pick<ChaseFileState, "closed" | "disputedAwaitingCasResponse" | "handedToSolicitors" | "paused">): string | null {
  if (file.closed) return "File is closed — stop every chase sequence.";
  if (file.handedToSolicitors) return "File has been handed to solicitors — do not chase.";
  if (file.disputedAwaitingCasResponse) return "Disputed and awaiting CAS response — do not chase.";
  if (file.paused) return "Handler pause in force.";
  return null;
}

/** Shared chase clock: interval, pause, reply, out-of-office, and file-level stop conditions. */
export function chaseDecision(opts: {
  enabled: boolean;
  enabledReason?: string;
  unanswered: boolean;
  intervalDays: number;
  daysSinceLast: number | null;
  longerOverrideDays?: number | null;
  dueReason?: string;
  file: ChaseFileState;
}): ChaserDecision {
  const stopped = chaseStopReason(opts.file);
  if (stopped) return { send: false, reason: stopped };
  if (!opts.enabled) return { send: false, reason: opts.enabledReason || "Track has not started." };
  if (opts.file.substantiveReply) return { send: false, reason: "Substantive reply suspends this chase." };
  if (opts.file.outOfOffice) {
    return { send: false, reason: "Out-of-office is not a resolution; wait for review, do not treat as answered." };
  }
  if (!opts.unanswered) return { send: false, reason: "Request is no longer unanswered." };
  const interval = opts.longerOverrideDays || opts.intervalDays;
  if (opts.daysSinceLast !== null && opts.daysSinceLast < interval) {
    return { send: false, reason: `Interval of ${interval} days not yet reached.` };
  }
  return {
    send: true,
    reason: opts.dueReason || `Due chaser after ${interval} calendar days (demonstration setting).`,
  };
}

export function engineerReportChaserDecision(opts: {
  reportDispatched: boolean;
  unanswered: boolean;
  intervalDays: number;
  daysSinceLast: number | null;
  paused: boolean;
  longerOverrideDays?: number | null;
  substantiveReply: boolean;
  outOfOffice: boolean;
  closed?: boolean;
  disputedAwaitingCasResponse?: boolean;
  handedToSolicitors?: boolean;
}): ChaserDecision {
  return chaseDecision({
    enabled: opts.reportDispatched,
    enabledReason: "Report has not been dispatched.",
    unanswered: opts.unanswered,
    intervalDays: opts.intervalDays,
    daysSinceLast: opts.daysSinceLast,
    longerOverrideDays: opts.longerOverrideDays,
    file: {
      closed: opts.closed,
      disputedAwaitingCasResponse: opts.disputedAwaitingCasResponse,
      handedToSolicitors: opts.handedToSolicitors,
      paused: opts.paused,
      substantiveReply: opts.substantiveReply,
      outOfOffice: opts.outOfOffice,
    },
  });
}

export type HirePackChaseStage = "payment_chase_1" | "payment_chase_2" | "solicitor_handoff";

export type HirePackChaseDecision = ChaserDecision & {
  next: HirePackChaseStage | null;
};

/**
 * Hire-pack payment chase (05 → 06 → solicitor handoff).
 * A rebuttal resets the clock to chase 1 rather than stacking.
 * Partial payment reduces the outstanding balance; it does not cancel the chase.
 */
export function hirePackChaseDecision(opts: {
  hirePackSent: boolean;
  lastClockEvent: "hire_pack" | "rebuttal" | "chase_1" | "chase_2" | null;
  daysSinceLastClockEvent: number | null;
  intervalDays: number;
  longerOverrideDays?: number | null;
  paused: boolean;
  closed: boolean;
  disputedAwaitingCasResponse: boolean;
  handedToSolicitors: boolean;
  outstandingBalancePence: number;
  outOfOffice?: boolean;
}): HirePackChaseDecision {
  const stopped = chaseStopReason(opts);
  if (stopped) return { send: false, next: null, reason: stopped };
  if (!opts.hirePackSent) return { send: false, next: null, reason: "Hire pack has not been sent." };
  if (opts.outOfOffice) {
    return {
      send: false,
      next: null,
      reason: "Out-of-office is not a resolution; wait for review, do not treat as answered.",
    };
  }
  if (opts.outstandingBalancePence <= 0) {
    return { send: false, next: null, reason: "Nothing outstanding — chase not required." };
  }
  const interval = opts.longerOverrideDays || opts.intervalDays;
  if (opts.daysSinceLastClockEvent !== null && opts.daysSinceLastClockEvent < interval) {
    return { send: false, next: null, reason: `Interval of ${interval} days not yet reached.` };
  }
  if (opts.lastClockEvent === "hire_pack" || opts.lastClockEvent === "rebuttal") {
    return {
      send: true,
      next: "payment_chase_1",
      reason: `Due payment chase 1 after ${interval} calendar days (demonstration setting).`,
    };
  }
  if (opts.lastClockEvent === "chase_1") {
    return {
      send: true,
      next: "payment_chase_2",
      reason: `Due payment chase 2 after ${interval} calendar days (demonstration setting).`,
    };
  }
  if (opts.lastClockEvent === "chase_2") {
    return {
      send: false,
      next: "solicitor_handoff",
      reason: "Chase sequence complete — hand off to solicitor (outside this template set).",
    };
  }
  return { send: false, next: null, reason: "Chase clock has not started." };
}

/** Hire charges stop accruing at whichever comes first: vehicle return, or total-loss cessation. */
export function hireChargesAccrualEnd(opts: {
  vehicleReturnedAt: string | null;
  totalLossCessationAt: string | null;
}): string | null {
  const dates = [opts.vehicleReturnedAt, opts.totalLossCessationAt].filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

export function chaseFileStateFromPosition(opts: {
  currentPosition?: string | null;
  hasLitigation?: boolean;
  paused?: boolean;
  caseClosedEvent?: boolean;
  handedToSolicitorsEvent?: boolean;
}): Pick<ChaseFileState, "closed" | "disputedAwaitingCasResponse" | "handedToSolicitors" | "paused"> {
  const position = (opts.currentPosition || "").toLowerCase();
  return {
    closed: Boolean(opts.caseClosedEvent) || /\bclosed\b|\bsettled in full\b/.test(position),
    disputedAwaitingCasResponse: /awaiting cas response|disputed and awaiting/.test(position),
    handedToSolicitors: Boolean(opts.hasLitigation || opts.handedToSolicitorsEvent) || /solicitor/.test(position),
    paused: Boolean(opts.paused),
  };
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

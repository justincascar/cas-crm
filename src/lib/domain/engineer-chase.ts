import { addCalendarDaysIso, daysBetweenLondon } from "../dates";
import { ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT, ENGINEER_REPORT_CHASE_DUE_LABEL } from "../constants";

export type EngineerChaseHandlerState = "tracking" | "paused" | "cancelled";

export type EngineerChaseDecisionInput = {
  instructionMarkedSentAt: string | null;
  lastChaserMarkedSentAt: string | null;
  latestReportReceivedAt: string | null;
  latestReportClearedAt: string | null;
  handlerState: EngineerChaseHandlerState;
  /** Interval used for an active (tracking) chase. Current Settings value. */
  intervalDays: number;
  asAt: string;
};

export type EngineerChaseDecision = {
  active: boolean;
  due: boolean;
  reportOnFile: boolean;
  handlerState: EngineerChaseHandlerState;
  daysOutstanding: number | null;
  clockAt: string | null;
  dueAt: string | null;
  reason: string;
  label: string | null;
};

export function parseChaseIntervalDays(
  raw: string | number | null | undefined,
  fallback: number = ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT,
): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const left = a && String(a).trim() ? String(a) : null;
  const right = b && String(b).trim() ? String(b) : null;
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

export function engineerReportIsOnFile(opts: {
  instructionMarkedSentAt: string | null;
  latestReportReceivedAt: string | null;
  latestReportClearedAt: string | null;
}): boolean {
  if (!opts.latestReportReceivedAt) return false;
  if (opts.latestReportClearedAt && opts.latestReportClearedAt >= opts.latestReportReceivedAt) return false;
  if (opts.instructionMarkedSentAt && opts.latestReportReceivedAt < opts.instructionMarkedSentAt) return false;
  return true;
}

function chaseClockAt(opts: Pick<EngineerChaseDecisionInput, "instructionMarkedSentAt" | "lastChaserMarkedSentAt">): string | null {
  if (!opts.instructionMarkedSentAt) return null;
  if (opts.lastChaserMarkedSentAt && opts.lastChaserMarkedSentAt >= opts.instructionMarkedSentAt) {
    return opts.lastChaserMarkedSentAt;
  }
  return opts.instructionMarkedSentAt;
}

/** Recalculate the engineer-instruction chase from the file's current facts. Nothing is sent. */
export function engineerInstructionChaseDecision(opts: EngineerChaseDecisionInput): EngineerChaseDecision {
  const intervalDays = parseChaseIntervalDays(opts.intervalDays);
  const handlerState = opts.handlerState;
  const clockAt = chaseClockAt(opts);
  const reportOnFile = engineerReportIsOnFile(opts);
  const daysOutstanding = clockAt ? daysBetweenLondon(clockAt, opts.asAt) : null;
  const dueAt = clockAt ? addCalendarDaysIso(clockAt, intervalDays) : null;
  const base = {
    active: Boolean(opts.instructionMarkedSentAt),
    reportOnFile,
    handlerState,
    daysOutstanding,
    clockAt,
    dueAt,
    label: null as string | null,
  };

  if (!opts.instructionMarkedSentAt || !clockAt) {
    return {
      ...base,
      active: false,
      due: false,
      reason: "Engineer has not been instructed (marked as sent).",
    };
  }

  if (handlerState === "cancelled") {
    return {
      ...base,
      due: false,
      reason: "Chase cancelled by staff.",
    };
  }

  if (reportOnFile) {
    return {
      ...base,
      due: false,
      reason: "Engineer report has been logged as received.",
    };
  }

  if (handlerState === "paused") {
    return {
      ...base,
      due: false,
      reason: "Chase paused by staff.",
    };
  }

  if (daysOutstanding !== null && daysOutstanding < intervalDays) {
    return {
      ...base,
      due: false,
      reason: `Interval of ${intervalDays} days not yet reached.`,
    };
  }

  return {
    ...base,
    due: true,
    label: ENGINEER_REPORT_CHASE_DUE_LABEL,
    reason: `${ENGINEER_REPORT_CHASE_DUE_LABEL} after ${intervalDays} calendar days. Prepared email only — not auto-sent.`,
  };
}

import { ENGINEER_REPORT_CHASE_DUE_LABEL } from "../constants";
import {
  chaseClockDecision,
  laterIso,
  outcomeIsOnFile,
  parseChaseIntervalDays,
  type ChaseHandlerState,
} from "./chase";

export type EngineerChaseHandlerState = ChaseHandlerState;

export type EngineerChaseDecisionInput = {
  instructionMarkedSentAt: string | null;
  lastChaserMarkedSentAt: string | null;
  latestReportReceivedAt: string | null;
  latestReportClearedAt: string | null;
  handlerState: EngineerChaseHandlerState;
  /** Interval used for an active (tracking) chase. Current Settings value, unless a per-claim override is applied by the caller. */
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

export { laterIso, parseChaseIntervalDays };

export function engineerReportIsOnFile(opts: {
  instructionMarkedSentAt: string | null;
  latestReportReceivedAt: string | null;
  latestReportClearedAt: string | null;
}): boolean {
  return outcomeIsOnFile({
    startedAt: opts.instructionMarkedSentAt,
    outcomeAt: opts.latestReportReceivedAt,
    outcomeClearedAt: opts.latestReportClearedAt,
  });
}

/** Recalculate the engineer-instruction chase from the file's current facts. Nothing is sent. */
export function engineerInstructionChaseDecision(opts: EngineerChaseDecisionInput): EngineerChaseDecision {
  const decision = chaseClockDecision({
    startedAt: opts.instructionMarkedSentAt,
    lastChaseSentAt: opts.lastChaserMarkedSentAt,
    outcomeAt: opts.latestReportReceivedAt,
    outcomeClearedAt: opts.latestReportClearedAt,
    handlerState: opts.handlerState,
    intervalDays: opts.intervalDays,
    asAt: opts.asAt,
    dueLabel: ENGINEER_REPORT_CHASE_DUE_LABEL,
    notStartedReason: "Engineer has not been instructed (marked as sent).",
    outcomeOnFileReason: "Engineer report has been logged as received.",
  });
  return {
    active: decision.active,
    due: decision.due,
    reportOnFile: decision.outcomeOnFile,
    handlerState: decision.handlerState,
    daysOutstanding: decision.daysOutstanding,
    clockAt: decision.clockAt,
    dueAt: decision.dueAt,
    reason: decision.reason,
    label: decision.label,
  };
}

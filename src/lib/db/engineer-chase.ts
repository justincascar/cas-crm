import type { DatabaseSync } from "node:sqlite";
import {
  ENGINEER_REPORT_CHASE_DUE_LABEL,
  ENGINEER_REPORT_CHASE_TEMPLATE,
} from "../constants";
import type { EngineerChaseDecision, EngineerChaseHandlerState } from "../domain/engineer-chase";
import {
  cancelChase,
  chaseForClaim,
  countChaseRows,
  ensureChaseSettings,
  ensureDemoChases,
  findPreparedChase,
  getChaseIntervalDays,
  latestIsoForEvent,
  listDueChases,
  pauseChase,
  restartChaseClock,
  resumeChase,
  setChaseIntervalDays,
  startChase,
  type ChaseView,
} from "./chase";

export type EngineerChaseView = EngineerChaseDecision & {
  claimId: string;
  fileReference?: string;
  clientName?: string | null;
  handlerName?: string | null;
  engineerName: string;
  engineerEmail: string;
  frozenIntervalDays: number;
};

function asEngineerView(view: ChaseView): EngineerChaseView {
  return {
    claimId: view.claimId,
    fileReference: view.fileReference,
    clientName: view.clientName,
    handlerName: view.handlerName,
    active: view.active,
    due: view.due,
    reportOnFile: view.outcomeOnFile,
    handlerState: view.handlerState as EngineerChaseHandlerState,
    daysOutstanding: view.daysOutstanding,
    clockAt: view.clockAt,
    dueAt: view.dueAt,
    reason: view.reason,
    label: view.label,
    engineerName: view.contactName,
    engineerEmail: view.contactEmail,
    frozenIntervalDays: view.frozenIntervalDays,
  };
}

export function ensureEngineerChaseIntervalSetting(db: DatabaseSync) {
  ensureChaseSettings(db);
}

export function getEngineerChaseIntervalDays(): number {
  return getChaseIntervalDays("engineer_report");
}

export function setEngineerChaseIntervalDays(value: string | number) {
  setChaseIntervalDays("engineer_report", value);
}

export { latestIsoForEvent };

export function engineerChaseForClaim(claimId: string, asAt?: string): EngineerChaseView | null {
  const view = chaseForClaim("engineer_report", claimId, asAt);
  return view ? asEngineerView(view) : null;
}

export function listDueEngineerInstructionChases(asAt?: string): EngineerChaseView[] {
  return listDueChases(asAt)
    .filter((row) => row.kind === "engineer_report")
    .map(asEngineerView);
}

export function startEngineerInstructionChase(claimId: string, clockAt: string) {
  return startChase("engineer_report", claimId, clockAt);
}

export function restartEngineerInstructionChaseClock(claimId: string, clockAt: string) {
  restartChaseClock("engineer_report", claimId, clockAt);
}

export function pauseEngineerInstructionChase(claimId: string) {
  pauseChase("engineer_report", claimId);
}

export function resumeEngineerInstructionChase(claimId: string) {
  resumeChase("engineer_report", claimId);
}

export function cancelEngineerInstructionChase(claimId: string) {
  cancelChase("engineer_report", claimId);
}

export function countEngineerInstructionChaseRows(claimId: string): number {
  return countChaseRows("engineer_report", claimId);
}

export function findPreparedEngineerReportChase(claimId: string) {
  return findPreparedChase("engineer_report", claimId);
}

export function ensureDemoEngineerInstructionChase(db: DatabaseSync) {
  ensureDemoChases(db);
}

export { ENGINEER_REPORT_CHASE_DUE_LABEL, ENGINEER_REPORT_CHASE_TEMPLATE };

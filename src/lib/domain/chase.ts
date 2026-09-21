import { addCalendarDaysIso, daysBetweenLondon } from "../dates";
import {
  ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT,
  ENGINEER_INSTRUCTION_CHASE_RULE,
  ENGINEER_REPORT_CHASE_DUE_LABEL,
  ENGINEER_REPORT_CHASE_TEMPLATE,
  LIABILITY_RESPONSE_CHASE_DUE_LABEL,
  LIABILITY_RESPONSE_CHASE_RULE,
  LIABILITY_RESPONSE_CHASE_TEMPLATE,
  REPAIR_AUTHORISATION_CHASE_DUE_LABEL,
  REPAIR_AUTHORISATION_CHASE_RULE,
  REPAIR_AUTHORISATION_CHASE_TEMPLATE,
  SETTING_ENGINEER_CHASE_INTERVAL_DAYS,
  SETTING_LIABILITY_CHASE_INTERVAL_DAYS,
  SETTING_REPAIR_AUTH_CHASE_INTERVAL_DAYS,
} from "../constants";

export const CHASE_KINDS = ["engineer_report", "liability_response", "repair_authorisation"] as const;
export type ChaseKind = (typeof CHASE_KINDS)[number];

export type ChaseHandlerState = "tracking" | "paused" | "cancelled";
export type ChaseIntervalSource = "claim_override" | "settings" | "frozen";

export type ChaseKindDefinition = {
  kind: ChaseKind;
  ruleKey: string;
  track: string;
  settingKey: string;
  defaultIntervalDays: number;
  templateKey: string;
  dueLabel: string;
  title: string;
  waitingReason: string;
  startEventTypes: readonly string[];
  startTemplateKeys: readonly string[];
  chaseSentEventType: string;
  extraChaseSentEventTypes: readonly string[];
  outcomeReceivedEventTypes: readonly string[];
  outcomeClearedEventType: string;
  pauseEventType: string;
  resumeEventType: string;
  cancelEventType: string;
  recipient: "engineer" | "insurer";
  notStartedReason: string;
  outcomeOnFileReason: string;
};

const DEFAULT_INTERVAL = ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT;

export const CHASE_KIND_DEFINITIONS: Record<ChaseKind, ChaseKindDefinition> = {
  engineer_report: {
    kind: "engineer_report",
    ruleKey: ENGINEER_INSTRUCTION_CHASE_RULE,
    track: "engineer_instruction",
    settingKey: SETTING_ENGINEER_CHASE_INTERVAL_DAYS,
    defaultIntervalDays: DEFAULT_INTERVAL,
    templateKey: ENGINEER_REPORT_CHASE_TEMPLATE,
    dueLabel: ENGINEER_REPORT_CHASE_DUE_LABEL,
    title: "Engineer report chase",
    waitingReason: "Waiting for the engineer's report. Reminder only — not auto-sent.",
    startEventTypes: ["engineer_instructed"],
    startTemplateKeys: ["engineer_instruction"],
    chaseSentEventType: "engineer_report_chase_sent",
    extraChaseSentEventTypes: [],
    outcomeReceivedEventTypes: ["engineer_report_received"],
    outcomeClearedEventType: "engineer_report_received_cleared",
    pauseEventType: "engineer_chase_paused",
    resumeEventType: "engineer_chase_resumed",
    cancelEventType: "engineer_chase_cancelled",
    recipient: "engineer",
    notStartedReason: "Engineer has not been instructed (marked as sent).",
    outcomeOnFileReason: "Engineer report has been logged as received.",
  },
  liability_response: {
    kind: "liability_response",
    ruleKey: LIABILITY_RESPONSE_CHASE_RULE,
    track: "liability_response",
    settingKey: SETTING_LIABILITY_CHASE_INTERVAL_DAYS,
    defaultIntervalDays: DEFAULT_INTERVAL,
    templateKey: LIABILITY_RESPONSE_CHASE_TEMPLATE,
    dueLabel: LIABILITY_RESPONSE_CHASE_DUE_LABEL,
    title: "Liability response chase",
    waitingReason: "Waiting for a liability decision from the insurer. Reminder only — not auto-sent.",
    startEventTypes: ["initial_letter_tp_insurer", "initial_letter_own_insurer"],
    startTemplateKeys: [],
    chaseSentEventType: "liability_response_chase_sent",
    extraChaseSentEventTypes: ["liability_chase_sent"],
    outcomeReceivedEventTypes: ["liability_response_received"],
    outcomeClearedEventType: "liability_response_received_cleared",
    pauseEventType: "liability_response_chase_paused",
    resumeEventType: "liability_response_chase_resumed",
    cancelEventType: "liability_response_chase_cancelled",
    recipient: "insurer",
    notStartedReason: "No liability enquiry has been marked as sent to the insurer.",
    outcomeOnFileReason: "A liability decision has been logged as received.",
  },
  repair_authorisation: {
    kind: "repair_authorisation",
    ruleKey: REPAIR_AUTHORISATION_CHASE_RULE,
    track: "repair_authorisation",
    settingKey: SETTING_REPAIR_AUTH_CHASE_INTERVAL_DAYS,
    defaultIntervalDays: DEFAULT_INTERVAL,
    templateKey: REPAIR_AUTHORISATION_CHASE_TEMPLATE,
    dueLabel: REPAIR_AUTHORISATION_CHASE_DUE_LABEL,
    title: "Repair authorisation chase",
    waitingReason: "Waiting for repair authorisation or payment. Reminder only — not auto-sent.",
    startEventTypes: ["repair_authorisation_requested"],
    startTemplateKeys: [],
    chaseSentEventType: "repair_authorisation_chase_sent",
    extraChaseSentEventTypes: [],
    outcomeReceivedEventTypes: ["repairs_authorised", "repair_payment_received"],
    outcomeClearedEventType: "repairs_authorised_cleared",
    pauseEventType: "repair_authorisation_chase_paused",
    resumeEventType: "repair_authorisation_chase_resumed",
    cancelEventType: "repair_authorisation_chase_cancelled",
    recipient: "insurer",
    notStartedReason: "No repair authorisation or payment request has been marked as sent.",
    outcomeOnFileReason: "Repair authorisation or payment has been logged as received.",
  },
};

export const CHASE_KIND_ORDER: ChaseKind[] = ["liability_response", "engineer_report", "repair_authorisation"];

export function isChaseKind(value: string | null | undefined): value is ChaseKind {
  return CHASE_KINDS.includes(String(value || "") as ChaseKind);
}

export function chaseDefinition(kind: ChaseKind): ChaseKindDefinition {
  return CHASE_KIND_DEFINITIONS[kind];
}

export function chaseKindForRuleKey(ruleKey: string): ChaseKind | null {
  for (const kind of CHASE_KINDS) {
    if (CHASE_KIND_DEFINITIONS[kind].ruleKey === ruleKey) return kind;
  }
  return null;
}

export function chaseKindForStartEvent(eventType: string): ChaseKind | null {
  for (const kind of CHASE_KINDS) {
    if (CHASE_KIND_DEFINITIONS[kind].startEventTypes.includes(eventType)) return kind;
  }
  return null;
}

export function chaseKindForChaseSentEvent(eventType: string): ChaseKind | null {
  for (const kind of CHASE_KINDS) {
    const def = CHASE_KIND_DEFINITIONS[kind];
    if (def.chaseSentEventType === eventType || def.extraChaseSentEventTypes.includes(eventType)) return kind;
  }
  return null;
}

export function parseChaseIntervalDays(
  raw: string | number | null | undefined,
  fallback: number = DEFAULT_INTERVAL,
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

export function laterIsoAll(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((acc, value) => laterIso(acc, value), null);
}

export function outcomeIsOnFile(opts: {
  startedAt: string | null;
  outcomeAt: string | null;
  outcomeClearedAt: string | null;
}): boolean {
  if (!opts.outcomeAt) return false;
  if (opts.outcomeClearedAt && opts.outcomeClearedAt >= opts.outcomeAt) return false;
  if (opts.startedAt && opts.outcomeAt < opts.startedAt) return false;
  return true;
}

export function chaseClockAt(opts: { startedAt: string | null; lastChaseSentAt: string | null }): string | null {
  if (!opts.startedAt) return null;
  if (opts.lastChaseSentAt && opts.lastChaseSentAt >= opts.startedAt) return opts.lastChaseSentAt;
  return opts.startedAt;
}

export function effectiveChaseIntervalDays(opts: {
  overrideDays: number | null | undefined;
  globalDays: number;
  handlerState: ChaseHandlerState;
  frozenDays: number;
}): { days: number; source: ChaseIntervalSource } {
  const override = parseChaseIntervalDays(opts.overrideDays, 0);
  if (override >= 1) return { days: override, source: "claim_override" };
  if (opts.handlerState === "tracking") {
    return { days: parseChaseIntervalDays(opts.globalDays), source: "settings" };
  }
  return { days: parseChaseIntervalDays(opts.frozenDays, opts.globalDays), source: "frozen" };
}

export type ChaseClockDecisionInput = {
  startedAt: string | null;
  lastChaseSentAt: string | null;
  outcomeAt: string | null;
  outcomeClearedAt: string | null;
  handlerState: ChaseHandlerState;
  intervalDays: number;
  asAt: string;
  dueLabel: string;
  notStartedReason: string;
  outcomeOnFileReason: string;
};

export type ChaseClockDecision = {
  active: boolean;
  due: boolean;
  outcomeOnFile: boolean;
  handlerState: ChaseHandlerState;
  daysOutstanding: number | null;
  clockAt: string | null;
  dueAt: string | null;
  reason: string;
  label: string | null;
};

/** Recalculate a chase from the file's current facts. Nothing is sent. */
export function chaseClockDecision(opts: ChaseClockDecisionInput): ChaseClockDecision {
  const intervalDays = parseChaseIntervalDays(opts.intervalDays);
  const handlerState = opts.handlerState;
  const clockAt = chaseClockAt(opts);
  const outcomeOnFile = outcomeIsOnFile(opts);
  const daysOutstanding = clockAt ? daysBetweenLondon(clockAt, opts.asAt) : null;
  const dueAt = clockAt ? addCalendarDaysIso(clockAt, intervalDays) : null;
  const base = {
    active: Boolean(opts.startedAt),
    outcomeOnFile,
    handlerState,
    daysOutstanding,
    clockAt,
    dueAt,
    label: null as string | null,
  };

  if (!opts.startedAt || !clockAt) {
    return {
      ...base,
      active: false,
      due: false,
      reason: opts.notStartedReason,
    };
  }

  if (handlerState === "cancelled") {
    return {
      ...base,
      due: false,
      reason: "Chase cancelled by staff.",
    };
  }

  if (outcomeOnFile) {
    return {
      ...base,
      due: false,
      reason: opts.outcomeOnFileReason,
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
    label: opts.dueLabel,
    reason: `${opts.dueLabel} after ${intervalDays} calendar days. Prepared email only — not auto-sent.`,
  };
}

export const NO_INSURER_CONTACT_MESSAGE =
  "No insurer contact on file. Record an insurer email on this claim (Third party 1) — the CRM will not guess an address.";

export const LIABILITY_DECISIONS = [
  { value: "admitted", label: "Accepted (admitted)" },
  { value: "denied", label: "Rejected (denied)" },
  { value: "partial", label: "Partial admission" },
] as const;

export type LiabilityDecisionValue = (typeof LIABILITY_DECISIONS)[number]["value"];

export function isLiabilityDecisionValue(value: string): value is LiabilityDecisionValue {
  return LIABILITY_DECISIONS.some((item) => item.value === value);
}

export const REPAIR_OUTCOMES = [
  { value: "authorisation", label: "Authorisation received", eventType: "repairs_authorised" },
  { value: "payment", label: "Payment received", eventType: "repair_payment_received" },
] as const;

export type RepairOutcomeValue = (typeof REPAIR_OUTCOMES)[number]["value"];

export function isRepairOutcomeValue(value: string): value is RepairOutcomeValue {
  return REPAIR_OUTCOMES.some((item) => item.value === value);
}

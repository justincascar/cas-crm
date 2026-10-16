import { realLondonDays } from "./repair-progress";

export const WAIT_LIMIT_DAYS = 14;
export const UNDO_WINDOW_MS = 10_000;

export const CALL_OUTCOMES = [
  { value: "spoke", label: "Spoke to insurer handler" },
  { value: "voicemail", label: "Voicemail" },
  { value: "no_answer", label: "No answer" },
  { value: "promised", label: "Promised payment or response" },
  { value: "other", label: "Other" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];

const OUTCOME_VALUES = new Set<string>(CALL_OUTCOMES.map((row) => row.value));

export function callOutcomeLabel(value: string): string | null {
  return CALL_OUTCOMES.find((row) => row.value === value)?.label ?? null;
}

export function isCallOutcome(value: string): value is CallOutcome {
  return OUTCOME_VALUES.has(value);
}

/** The day after a promised date. The next day is 1. */
export function dayAfter(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay.trim());
  if (!match) return "";
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fleetConflictText(registration: string, status: string, fileReference: string): string {
  const marked = status.trim().replaceAll("_", " ") || "unknown";
  return `Fleet record conflict: ${registration} is marked ${marked} but is on hire to ${fileReference}`;
}

/**
 * A wait of more than 14 real days needs extendedWait.
 * The same day is 0. The next day is 1.
 */
export function waitLimitMessage(waitUntil: string, today: string, extended: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(waitUntil)) return "Enter the date to wait until.";
  if (waitUntil < today) return "Choose today or a later date.";
  const days = realLondonDays(today, waitUntil);
  if (!extended && days > WAIT_LIMIT_DAYS) {
    return "A wait can be 14 days at most. A longer wait needs the extended wait permission.";
  }
  return null;
}

export function undoStillOpen(createdAtIso: string, nowMs = Date.now()): boolean {
  const created = new Date(createdAtIso).getTime();
  if (!Number.isFinite(created)) return false;
  return nowMs >= created && nowMs - created <= UNDO_WINDOW_MS;
}

export const DESK_INTENTS = ["call", "wait", "undo", "prepare"] as const;

export function isDeskIntent(value: string): boolean {
  return (DESK_INTENTS as readonly string[]).includes(value);
}

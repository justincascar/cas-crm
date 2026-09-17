import { londonTodayIso } from "./dates";

export const DRIVER_MIN_AGE = 17;
export const MAX_PLAUSIBLE_AGE = 110;

export type DobKind = "driver" | "client" | "owner" | "hirer";

export type DobCheck =
  | { ok: true; age: number }
  | { ok: false; blocking: true; message: string; age: number | null }
  | { ok: false; blocking: false; warning: true; message: string; age: number };

function isRealCalendarDate(ymd: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function dateOnly(value: string | null | undefined): string {
  return (value || "").trim().slice(0, 10);
}

/** Whole years of age on a Europe/London calendar day. Birthday today counts as that age. */
export function ageInYearsOn(dobYmd: string, asAtYmd = londonTodayIso()): number | null {
  const dob = dateOnly(dobYmd);
  const asAt = dateOnly(asAtYmd);
  if (!isRealCalendarDate(dob) || !isRealCalendarDate(asAt)) return null;
  const dobYear = Number(dob.slice(0, 4));
  const asAtYear = Number(asAt.slice(0, 4));
  let age = asAtYear - dobYear;
  if (asAt.slice(5) < dob.slice(5)) age -= 1;
  return age;
}

export function inspectDob(
  raw: string | null | undefined,
  kind: DobKind,
  asAtYmd = londonTodayIso(),
): DobCheck | { ok: true; age: null; empty: true } {
  const dob = dateOnly(raw);
  if (!dob) return { ok: true, age: null, empty: true };
  if (!isRealCalendarDate(dob)) {
    return { ok: false, blocking: true, message: "Enter a real calendar date of birth.", age: null };
  }
  if (dob > asAtYmd) {
    return {
      ok: false,
      blocking: true,
      message: "A date of birth cannot be in the future.",
      age: null,
    };
  }
  const age = ageInYearsOn(dob, asAtYmd);
  if (age === null) {
    return { ok: false, blocking: true, message: "Enter a real calendar date of birth.", age: null };
  }
  if (age > MAX_PLAUSIBLE_AGE) {
    return {
      ok: false,
      blocking: true,
      message: "That date of birth would be over 110 years ago. Check the year.",
      age,
    };
  }
  if (age < DRIVER_MIN_AGE && kind === "driver") {
    return {
      ok: false,
      blocking: true,
      message: `A driver must be at least ${DRIVER_MIN_AGE} (UK minimum driving age). Check the date of birth.`,
      age,
    };
  }
  if (age < DRIVER_MIN_AGE) {
    return {
      ok: false,
      blocking: false,
      warning: true,
      message: `This person would be ${age}. That is unusual for a ${kind}. Double-check the date of birth with them before continuing.`,
      age,
    };
  }
  return { ok: true, age };
}

export function dobSaveError(
  raw: string | null | undefined,
  kind: DobKind,
  confirmed = false,
  asAtYmd = londonTodayIso(),
): string | null {
  const check = inspectDob(raw, kind, asAtYmd);
  if ("empty" in check) return null;
  if (check.ok) return null;
  if (check.blocking) return check.message;
  if (!confirmed) {
    return `${check.message} Tick the box to confirm you have checked the date.`;
  }
  return null;
}

export function isDobFieldName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "dob" || n.endsWith("dob") || n === "date_of_birth" || n === "additional_dob";
}

export function clientDobKind(clientRole?: string | null): DobKind {
  if (clientRole === "driver" || clientRole === "owner_driver") return "driver";
  if (clientRole === "owner") return "owner";
  return "client";
}

export function counterpartDobKind(clientRole?: string | null): DobKind {
  if (clientRole === "owner") return "driver";
  if (clientRole === "driver") return "owner";
  return "client";
}

export function dobKindForField(screenKey: string, fieldName: string, clientRole?: string): DobKind {
  if (screenKey === "driver") return "driver";
  if (screenKey === "additional-drivers") return "driver";
  if (fieldName === "additional_dob") return "driver";
  if (fieldName === "date_of_birth") return "hirer";
  if (screenKey === "owner") return "owner";
  if (screenKey === "client") return clientDobKind(clientRole);
  return "client";
}

export function dobConfirmName(fieldName: string): string {
  return `${fieldName}_confirmed`;
}

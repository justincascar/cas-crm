/**
 * Pre-hire checks for a hire agreement.
 * These functions do not take a bypass flag. A recorded override is a fact
 * about this claim (licenceOverridden / bankOverridden), already stored with
 * a reason by an account that holds overridePreHireChecks. The administrator
 * role is not an input.
 */

export const LICENCE_CHECK_WINDOW_DAYS = 21;

/** Live GOV.UK page: "Check someone's driving licence information". The CRM does not call DVLA. */
export const GOV_LICENCE_CHECK_URL = "https://www.gov.uk/check-driving-information";

export const LICENCE_CHECK_WINDOW_NOTICE = `${LICENCE_CHECK_WINDOW_DAYS} days is the demonstration window used here. It is not a DVLA ruling, and it is not a legal finding. It needs Justin's confirmation. A check older than this is not treated as current. It blocks the agreement and the handover until it is rechecked or overridden.`;

export const DVLA_MANUAL_NOTICE =
  "Type what the free check at gov.uk/check-driving-information showed. The CRM does not call DVLA. No DVLA account is waiting on this. Automated checking could be revisited only if CAS ever secures bulk DVLA access. This screen does not connect to one.";

export const NO_OVERRIDE_NOTICE =
  "There is no administrator override. A hire agreement cannot be generated until every person who will drive has a licence check, and the file has a listed bank account or a saved explanation that there is no bank account.";

export const PREHIRE_OVERRIDE_NOTICE =
  "This account can override a missing licence check, or missing bank-statement evidence, on this file. That permission is not the administrator role, and it is not approval to rely on impecuniosity. Each override needs a reason and is kept on the file, including if the evidence is added later. Overriding one check does not override the other, and it does not apply to any other file.";

export const PREHIRE_CHECK_KINDS = ["licence", "bank"] as const;
export type PrehireCheckKind = (typeof PREHIRE_CHECK_KINDS)[number];

export function isPrehireCheckKind(value: string): value is PrehireCheckKind {
  return value === "licence" || value === "bank";
}

export function prehireCheckKindLabel(kind: string): string {
  if (kind === "licence") return "Licence check";
  if (kind === "bank") return "Bank-statement evidence";
  return "Pre-hire check";
}

export const BANK_REUSE_NOTICE =
  "Bank statements stay on Financial circumstances. A bank account listed there satisfies this check. A saved explanation that the client has no bank account also satisfies it. The evidence checklist does not need to be Complete, and approval to rely on impecuniosity is a different gate. A file stored on that page is not labelled as a bank statement, so a file on its own is not treated as one.";

export const DRIVERS_NOTICE =
  "The licence check is for each person who will drive the hire vehicle. That is anyone recorded as a driver, anyone named on Client driver details, and each additional driver named on the hire pack or on Additional drivers. An owner, hirer or client who is not one of those people is not included. If nobody is recorded as a driver, the client is included. The licence number already on the file is not this check.";

export type NamedHireDriver = {
  key: string;
  name: string;
};

export type LicenceCheckSnapshot = {
  driverKey: string;
  checkedOn: string;
  recordedAt: string;
  result?: string | null;
};

export type HireGapKind = "licence" | "problem" | "stale" | "bank" | "driver";

export type HireGap = {
  key: string;
  kind: HireGapKind;
  label: string;
  href: string;
};

export function hireCheckAnchor(driverKey: string): string {
  return `check-${driverKey.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

export function formatLicenceDate(ymd: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!match) return "Unknown";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Whole calendar days from the check date to the later date. Both are yyyy-MM-dd. */
export function calendarDaysAfter(fromYmd: string, toYmd: string): number | null {
  const from = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd.trim());
  const to = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toYmd.trim());
  if (!from || !to) return null;
  const fromUtc = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]));
  const toUtc = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  if (Number.isNaN(fromUtc) || Number.isNaN(toUtc)) return null;
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** True when the check date is more than the window before asAt. A missing check is not stale. */
export function licenceCheckIsStale(checkedOn: string, asAtYmd: string, windowDays = LICENCE_CHECK_WINDOW_DAYS): boolean {
  const days = calendarDaysAfter(checkedOn, asAtYmd);
  const window = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : LICENCE_CHECK_WINDOW_DAYS;
  return days != null && days > window;
}

export function latestLicenceCheck(checks: LicenceCheckSnapshot[], driverKey: string): LicenceCheckSnapshot | undefined {
  return checks
    .filter((row) => row.driverKey === driverKey)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0))[0];
}

export function staleLicenceLine(name: string, windowDays = LICENCE_CHECK_WINDOW_DAYS): string {
  const window = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : LICENCE_CHECK_WINDOW_DAYS;
  return `${name}: Licence check is older than ${window} days — please recheck`;
}

function bankGapSentence(): string {
  return "There is no bank statement on the file, no bank account listed on Financial circumstances, and no saved explanation that the client has no bank account.";
}

export function hireAgreementRefusal(input: {
  missingDriverNames: string[];
  problemDriverNames?: string[];
  staleDriverNames?: string[];
  driverRecorded: boolean;
  bankSatisfied: boolean;
  /** A prehire_overrides row for the licence check already exists on this claim. */
  licenceOverridden?: boolean;
  /** A prehire_overrides row for bank-statement evidence already exists on this claim. */
  bankOverridden?: boolean;
  /** Fault courtesy hire does not ask for bank statements. */
  requireBank?: boolean;
  windowDays?: number;
  purpose?: "agreement" | "handover";
}): string | null {
  const licenceOverridden = input.licenceOverridden === true;
  const bankOverridden = input.bankOverridden === true;
  const requireBank = input.requireBank !== false;
  const windowDays = input.windowDays ?? LICENCE_CHECK_WINDOW_DAYS;
  const gaps: string[] = [];
  if (!licenceOverridden) {
    if (!input.driverRecorded) {
      gaps.push("Nobody is recorded as the person who will drive the hire vehicle.");
    } else {
      if (input.missingDriverNames.length > 0) {
        gaps.push(`No licence check is recorded for ${input.missingDriverNames.join(", ")}.`);
      }
      if ((input.problemDriverNames || []).length > 0) {
        gaps.push(`The licence check for ${(input.problemDriverNames || []).join(", ")} found a problem.`);
      }
      for (const name of input.staleDriverNames || []) {
        gaps.push(`${staleLicenceLine(name, windowDays)}.`);
      }
    }
  }
  if (requireBank && !bankOverridden && !input.bankSatisfied) gaps.push(bankGapSentence());
  if (gaps.length === 0) return null;
  const prefix = input.purpose === "handover" ? "Handover was not completed." : "A hire agreement was not produced.";
  const closing = licenceOverridden || bankOverridden ? "" : " There is no override.";
  return `${prefix} ${gaps.join(" ")}${closing}`;
}

/** Shown when generation is allowed. An override is named. Evidence is not described as present if it was overridden. */
export function hireAgreementReadyLine(input: { licenceOverridden: boolean; bankOverridden: boolean }): string {
  if (!input.licenceOverridden && !input.bankOverridden) {
    return "Licence checks and bank-statement evidence are on this file. Generating still does not sign the agreement.";
  }
  const licence = input.licenceOverridden
    ? "The licence check was overridden on this file."
    : "Licence checks are on this file.";
  const bank = input.bankOverridden
    ? "The bank-statement check was overridden on this file."
    : "Bank-statement evidence is on this file.";
  return `${licence} ${bank} Generating still does not sign the agreement.`;
}

/** Warnings for a handover on asAtYmd. An old check is named. A missing check is not called stale. */
export function handoverStaleLines(input: {
  drivers: NamedHireDriver[];
  checks: LicenceCheckSnapshot[];
  asAtYmd: string;
  windowDays?: number;
}): string[] {
  const lines: string[] = [];
  const windowDays = input.windowDays ?? LICENCE_CHECK_WINDOW_DAYS;
  for (const driver of input.drivers) {
    const latest = latestLicenceCheck(input.checks, driver.key);
    if (!latest || latest.result === "problem") continue;
    if (licenceCheckIsStale(latest.checkedOn, input.asAtYmd, windowDays)) {
      lines.push(`${staleLicenceLine(driver.name, windowDays)}.`);
    }
  }
  return lines;
}

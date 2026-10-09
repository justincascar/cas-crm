/**
 * Pre-hire checks for a hire agreement.
 * There is no override argument on these functions, and none should be added.
 * A real exception, if one is ever needed, is a later decision.
 */

export const LICENCE_CHECK_WINDOW_DAYS = 21;

export const GOV_LICENCE_CHECK_URL = "https://www.gov.uk/check-driving-licence";

export const LICENCE_CHECK_WINDOW_NOTICE = `${LICENCE_CHECK_WINDOW_DAYS} days is the demonstration window used here. It is not a DVLA ruling, and it is not a legal finding. An older check still counts as recorded. It is not treated as current at handover.`;

export const DVLA_MANUAL_NOTICE =
  "Type what the free check at gov.uk/check-driving-licence showed. The CRM does not call DVLA. No DVLA account is waiting on this. Automated checking could be revisited only if CAS ever secures bulk DVLA access. This screen does not connect to one.";

export const NO_OVERRIDE_NOTICE =
  "There is no administrator override. A hire agreement cannot be generated until every person who will drive has a licence check, and the file has a listed bank account or a saved explanation that there is no bank account.";

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
};

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

/** True when the check date is more than the demonstration window before asAt. A missing check is not "stale". */
export function licenceCheckIsStale(checkedOn: string, asAtYmd: string): boolean {
  const days = calendarDaysAfter(checkedOn, asAtYmd);
  return days != null && days > LICENCE_CHECK_WINDOW_DAYS;
}

export function latestLicenceCheck(checks: LicenceCheckSnapshot[], driverKey: string): LicenceCheckSnapshot | undefined {
  return checks
    .filter((row) => row.driverKey === driverKey)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0))[0];
}

export function hireAgreementRefusal(input: {
  missingDriverNames: string[];
  driverRecorded: boolean;
  bankSatisfied: boolean;
}): string | null {
  if (input.driverRecorded && input.missingDriverNames.length === 0 && input.bankSatisfied) return null;
  const gaps: string[] = [];
  if (!input.driverRecorded) {
    gaps.push("Nobody is recorded as the person who will drive the hire vehicle.");
  } else if (input.missingDriverNames.length > 0) {
    gaps.push(`No licence check is recorded for ${input.missingDriverNames.join(", ")}.`);
  }
  if (!input.bankSatisfied) {
    gaps.push(
      "There is no bank account listed on Financial circumstances, and no saved explanation that the client has no bank account.",
    );
  }
  return `A hire agreement was not produced. ${gaps.join(" ")} This is required on every hire. There is no override.`;
}

export function staleLicenceLine(name: string, checkedOn: string, asAtYmd: string): string {
  return `${name}: the licence check dated ${formatLicenceDate(checkedOn)} is outside the ${LICENCE_CHECK_WINDOW_DAYS}-day demonstration window as at ${formatLicenceDate(asAtYmd)}. It still counts as recorded. Do not treat it as current at handover.`;
}

/** Warnings for a handover on asAtYmd. An old check is warned. A missing check is not called stale. */
export function handoverStaleLines(input: {
  drivers: NamedHireDriver[];
  checks: LicenceCheckSnapshot[];
  asAtYmd: string;
}): string[] {
  const lines: string[] = [];
  for (const driver of input.drivers) {
    const latest = latestLicenceCheck(input.checks, driver.key);
    if (!latest) continue;
    if (licenceCheckIsStale(latest.checkedOn, input.asAtYmd)) {
      lines.push(staleLicenceLine(driver.name, latest.checkedOn, input.asAtYmd));
    }
  }
  return lines;
}

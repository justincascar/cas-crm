import { INDICATIVE_DEFAULTS } from "../constants";
import { CAS_COMPANY } from "../documents/cas-hire-terms";
import { normaliseRecoveryScreen } from "./recovery-charges";
import { londonCalendarDayGap } from "./storage-authorisation-end";
import { formatGbp, grossFromNet } from "../money";

/** Confirmed 14/10/2026. Both the first day and the last day are counted. */
export const STORAGE_INCLUSIVE_DAY_NOTE =
  "Days count both the first day and the last day. Confirmed 14/10/2026. Storage from 22/09/2026 to 01/10/2026 is 10 days.";

/** The hire charge uses this same inclusive count. Renewal alerts do not. */
export const HIRE_INCLUSIVE_DAY_NOTE =
  "Days count both the first day and the last day. Confirmed 14/10/2026. Hire from 22/09/2026 to 01/10/2026 is 10 days.";

export type StorageCountBasis = "confirmed" | "proposed" | "today";

export type StorageLocationFields = {
  name: string;
  address: string;
  postcode: string;
  telMain: string;
  email: string;
};

export type StorageCharge =
  | { status: "missing_start" }
  | { status: "end_before_start" }
  | {
      status: "calculated";
      days: number;
      provisional: boolean;
      basis: StorageCountBasis;
      label: string | null;
      ratePence: number;
      netPence: number;
      vatPence: number;
      totalPence: number;
      countedTo: string;
    };

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function inclusiveStorageDays(startDay: string, endDay: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) return null;
  const gap = londonCalendarDayGap(startDay, endDay);
  if (gap < 0) return null;
  return gap + 1;
}

export function ukDayLabel(isoDay: string): string {
  const [year, month, day] = isoDay.split("-");
  return `${day}/${month}/${year}`;
}

export function storageProvisionalLabel(basis: StorageCountBasis, countedTo: string): string | null {
  if (basis === "confirmed") return null;
  if (basis === "proposed") {
    return `Provisional, to proposed end ${ukDayLabel(countedTo)}, awaiting confirmation`;
  }
  return "Provisional to today";
}

function isoDay(value: string | null | undefined): string | null {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function storageCharge(input: {
  startDay: string | null;
  confirmedEndDay: string | null;
  proposedEndDay?: string | null;
  today: string;
  ratePence: number;
  vatRate?: number;
}): StorageCharge {
  if (!input.startDay) return { status: "missing_start" };
  const confirmed = isoDay(input.confirmedEndDay);
  const proposed = confirmed ? null : isoDay(input.proposedEndDay);
  const basis: StorageCountBasis = confirmed ? "confirmed" : proposed ? "proposed" : "today";
  const countedTo = confirmed || proposed || input.today;
  const days = inclusiveStorageDays(input.startDay, countedTo);
  if (days == null) return { status: "end_before_start" };
  const priced = grossFromNet(days * input.ratePence, input.vatRate ?? INDICATIVE_DEFAULTS.vat_rate);
  return {
    status: "calculated",
    days,
    provisional: basis !== "confirmed",
    basis,
    label: storageProvisionalLabel(basis, countedTo),
    ratePence: input.ratePence,
    netPence: priced.net,
    vatPence: priced.vat,
    totalPence: priced.gross,
    countedTo,
  };
}

export function paymentComparisonLabel(input: {
  receivedPence: number;
  agreedPence: number;
  claimedPence: number;
}): string {
  const received = formatGbp(input.receivedPence);
  if (input.agreedPence > 0) return `${received} received against ${formatGbp(input.agreedPence)} agreed`;
  if (input.claimedPence > 0) return `${received} received against ${formatGbp(input.claimedPence)} claimed`;
  return "No figure to compare against yet";
}

function tidyPostcode(raw: string): string {
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  if (compact.length < 5) return raw.toUpperCase();
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

/** Split the configured default location into the storage boxes. Telephone and email come from the company record only for the CAS premises. */
export function storageLocationFromSetting(setting: string): StorageLocationFields {
  const text = setting.trim();
  const found = text.match(POSTCODE);
  const postcode = found ? tidyPostcode(found[1]) : "";
  const withoutPostcode = found ? text.replace(found[0], "").replace(/[,\s]+$/g, "").trim() : text;
  const parts = withoutPostcode
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const name = parts[0] || "";
  const cas = name.toLowerCase().startsWith("complete accident solutions");
  return {
    name,
    address: parts.slice(1).join(", "),
    postcode,
    telMain: cas ? CAS_COMPANY.phone : "",
    email: cas ? CAS_COMPANY.email : "",
  };
}

export function prefillBlankStorageLocation(
  saved: Partial<StorageLocationFields>,
  defaults: StorageLocationFields,
): StorageLocationFields {
  const pick = (key: keyof StorageLocationFields) => {
    const current = String(saved[key] || "").trim();
    return current || defaults[key];
  };
  return {
    name: pick("name"),
    address: pick("address"),
    postcode: pick("postcode"),
    telMain: pick("telMain"),
    email: pick("email"),
  };
}

export function storageLocationWasBlank(saved: Partial<StorageLocationFields>): boolean {
  return !["name", "address", "postcode", "telMain", "email"].some((key) =>
    String(saved[key as keyof StorageLocationFields] || "").trim(),
  );
}

const SCREEN_CHARGE_KEYS = [
  "standardCharge",
  "total",
  "outOfHours",
  "environment",
  "winch",
  "somethingElse",
  "cardPayment",
  "outOfHoursFee",
  "environmentFee",
  "winchFee",
  "somethingElseFee",
  "cardPaymentFee",
] as const;

export function recoveryScreenHasCalculation(values: Record<string, string | undefined> | null | undefined): boolean {
  if (!values) return false;
  return SCREEN_CHARGE_KEYS.some((key) => String(values[key] || "").trim() !== "");
}

export function recoveryScreenGrossPence(values: Record<string, string | undefined>): number {
  const priced = normaliseRecoveryScreen({ ...values });
  const total = Number.parseInt(priced.total || "0", 10);
  return Number.isFinite(total) ? total : 0;
}

export function recoveryJobNetPence(job: {
  charge_pence?: number | null;
  ooh_pence?: number | null;
  environmental_pence?: number | null;
  winch_pence?: number | null;
  forklift_pence?: number | null;
  mileage_pence?: number | null;
  manual_pence?: number | null;
} | null): number {
  if (!job) return 0;
  return (
    (Number(job.charge_pence) || 0) +
    (Number(job.ooh_pence) || 0) +
    (Number(job.environmental_pence) || 0) +
    (Number(job.winch_pence) || 0) +
    (Number(job.forklift_pence) || 0) +
    (Number(job.mileage_pence) || 0) +
    (Number(job.manual_pence) || 0)
  );
}

export type RecoveryClaimSource = "screen" | "job" | "default" | "kept";

export type RecoveryClaimDecision = {
  source: RecoveryClaimSource;
  netPence: number;
  vatPence: number;
  totalPence: number;
  write: boolean;
};

function priced(netPence: number, vatRate?: number): RecoveryClaimDecision {
  const money = grossFromNet(netPence, vatRate ?? INDICATIVE_DEFAULTS.vat_rate);
  return { source: "default", netPence: money.net, vatPence: money.vat, totalPence: money.gross, write: true };
}

/**
 * The recovery screen total already includes the standard charge, extras, the card fee and VAT.
 * A job total is that net plus VAT. The £395 default is used only when neither has been saved.
 * An existing claimed figure is left alone in that last case so it is not replaced by a second £395.
 */
export function recoveryClaimDecision(input: {
  screen: Record<string, string | undefined> | null;
  jobNetPence: number;
  existingClaimedPence: number;
  vatRate?: number;
}): RecoveryClaimDecision {
  if (recoveryScreenHasCalculation(input.screen)) {
    const normalised = normaliseRecoveryScreen({ ...(input.screen || {}) });
    const net = Number.parseInt(normalised.standardCharge || "0", 10) || 0;
    const gross = Number.parseInt(normalised.total || "0", 10) || 0;
    const vat = Number.parseInt(normalised.vat || "0", 10) || 0;
    return { source: "screen", netPence: gross - vat || net, vatPence: vat, totalPence: gross, write: true };
  }
  if (input.jobNetPence > 0) {
    return { ...priced(input.jobNetPence, input.vatRate), source: "job" };
  }
  const standard = priced(INDICATIVE_DEFAULTS.recovery_net_pence, input.vatRate);
  if (input.existingClaimedPence > 0) return { ...standard, source: "kept", write: false };
  return standard;
}

import { INDICATIVE_DEFAULTS } from "../constants";
import { grossFromNet } from "../money";

/** Standard recovery fees. Stored in Settings. A claim keeps the figure saved on it. */
export const RECOVERY_FEE_DEFS = [
  { key: "standard", settingKey: "recovery_standard_net_pence", label: "Standard recovery", defaultPence: INDICATIVE_DEFAULTS.recovery_net_pence, kind: "fixed" },
  { key: "environmental", settingKey: "recovery_environmental_net_pence", label: "Environmental", defaultPence: INDICATIVE_DEFAULTS.environmental_net_pence, kind: "fixed" },
  { key: "winching", settingKey: "recovery_winch_net_pence", label: "Winching", defaultPence: INDICATIVE_DEFAULTS.winch_net_pence, kind: "fixed" },
  { key: "forklift", settingKey: "recovery_forklift_net_pence", label: "Forklift", defaultPence: 8500, kind: "fixed" },
  { key: "outOfHours", settingKey: "recovery_ooh_net_pence", label: "Out of hours", defaultPence: INDICATIVE_DEFAULTS.ooh_net_pence, kind: "fixed" },
] as const;

export const RECOVERY_TYPED_EXTRAS = [
  { key: "specialistWinching", label: "Specialist winching" },
  { key: "skates", label: "Skates/dollies" },
  { key: "waiting", label: "Waiting time" },
  { key: "secondOperator", label: "Second operator" },
] as const;

export type RecoveryFeeKey = (typeof RECOVERY_FEE_DEFS)[number]["key"];
export type RecoveryTypedKey = (typeof RECOVERY_TYPED_EXTRAS)[number]["key"];

export type RecoveryMoneyLine = {
  key: string;
  label: string;
  netPence: number;
  vatPence: number;
  grossPence: number;
  reason: string;
};

export const OVERRIDE_REASON_MESSAGE = "Enter a short reason for this amount. It is recorded on the file.";
export const TYPED_AMOUNT_MESSAGE = "Enter the amount for this extra.";
export const MANUAL_DETAIL_MESSAGE = "Enter what the manual charge is, and the amount.";

export function poundsToStoredPence(raw: string | null | undefined): number {
  const t = (raw || "").trim().replace(/£/g, "").replace(/,/g, "");
  if (!t) return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Whole pounds stay as 39, not 39.00. A fee with pence stays as 395.00. */
export function filledPounds(pence: number): string {
  const pounds = pence / 100;
  if (!Number.isFinite(pounds)) return "";
  return Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2);
}

export function lineFromNet(key: string, label: string, netPence: number, reason = "", vatRate = INDICATIVE_DEFAULTS.vat_rate): RecoveryMoneyLine {
  const priced = grossFromNet(netPence, vatRate);
  return { key, label, netPence: priced.net, vatPence: priced.vat, grossPence: priced.gross, reason: reason.trim() };
}

export function lineFromReceipt(key: string, label: string, netPence: number, vatPence: number): RecoveryMoneyLine {
  const net = Math.max(0, Math.round(netPence));
  const vat = Math.max(0, Math.round(vatPence));
  return { key, label, netPence: net, vatPence: vat, grossPence: net + vat, reason: "" };
}

export function sumRecoveryLines(lines: RecoveryMoneyLine[]): { netPence: number; vatPence: number; grossPence: number } {
  return lines.reduce(
    (sum, line) => ({
      netPence: sum.netPence + line.netPence,
      vatPence: sum.vatPence + line.vatPence,
      grossPence: sum.grossPence + line.grossPence,
    }),
    { netPence: 0, vatPence: 0, grossPence: 0 },
  );
}

export function recoveryLineLabel(line: RecoveryMoneyLine): string {
  const net = (line.netPence / 100).toFixed(2);
  const vat = (line.vatPence / 100).toFixed(2);
  const gross = (line.grossPence / 100).toFixed(2);
  return `${line.label} — £${net} net, VAT £${vat}, £${gross}`;
}

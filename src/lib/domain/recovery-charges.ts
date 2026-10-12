import { INDICATIVE_DEFAULTS } from "../constants";
import { grossFromNet } from "../money";

/** Extras that are a tick plus a fee on the Recovery screen. Field names match the screen. */
export const RECOVERY_EXTRAS = [
  { key: "outOfHours", fee: "outOfHoursFee", kept: "outOfHoursKept", label: "Out of hours", defaultPence: INDICATIVE_DEFAULTS.ooh_net_pence },
  { key: "environment", fee: "environmentFee", kept: "environmentKept", label: "Environmental", defaultPence: INDICATIVE_DEFAULTS.environmental_net_pence },
  { key: "winch", fee: "winchFee", kept: "winchKept", label: "Winch", defaultPence: INDICATIVE_DEFAULTS.winch_net_pence },
] as const;

export type RecoveryExtra = (typeof RECOVERY_EXTRAS)[number];
export type RecoveryExtraKey = RecoveryExtra["key"];

export type ExtraDraft = {
  ticked: boolean;
  /** What staff typed, in pounds. Null means they have not typed their own figure. */
  override: string | null;
};

export function poundsFieldToPence(raw: string | null | undefined): number {
  const t = (raw || "").trim().replace(/£/g, "").replace(/,/g, "");
  if (!t) return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function penceToPounds(raw: string | null | undefined): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

export function normalisePounds(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const n = Number.parseFloat(t.replace(/£/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  return n.toFixed(2);
}

/** Fee box contents. Unticked is blank. A typed figure is kept; otherwise the default. */
export function shownExtraPounds(draft: ExtraDraft, defaultPence: number): string {
  if (!draft.ticked) return "";
  if (draft.override != null) return draft.override;
  return (defaultPence / 100).toFixed(2);
}

export function extraDraftFromSaved(input: {
  ticked: boolean;
  keptPence: string;
  feePence: string;
  defaultPence: number;
}): ExtraDraft {
  const kept = input.keptPence.trim();
  if (kept) return { ticked: input.ticked, override: penceToPounds(kept) };
  if (input.ticked && input.feePence.trim()) {
    const fee = Number.parseInt(input.feePence, 10);
    if (Number.isFinite(fee) && fee !== input.defaultPence) {
      return { ticked: true, override: penceToPounds(input.feePence) };
    }
  }
  return { ticked: input.ticked, override: null };
}

export function recoveryNetPence(input: {
  standardPounds: string;
  extras: Array<{ ticked: boolean; shownPounds: string }>;
}): number {
  let net = poundsFieldToPence(input.standardPounds);
  for (const extra of input.extras) {
    if (extra.ticked) net += poundsFieldToPence(extra.shownPounds);
  }
  return net;
}

export function recoveryVatAndTotal(netPence: number) {
  return grossFromNet(netPence, INDICATIVE_DEFAULTS.vat_rate);
}

export const SOMETHING_ELSE_AMOUNT_MESSAGE = "Enter the amount for this extra as well as what it is.";
export const SOMETHING_ELSE_DESCRIPTION_MESSAGE = "Say what this extra is, as well as the amount.";

/** 4.5% of the other net charges. Rounded to the nearest penny. */
export function cardFeePence(subtotalPence: number): number {
  if (subtotalPence <= 0) return 0;
  return Math.round(subtotalPence * INDICATIVE_DEFAULTS.card_fee_rate);
}

export function cardFeePercentLabel(): string {
  return `${(INDICATIVE_DEFAULTS.card_fee_rate * 100).toFixed(1)}%`;
}

export type SomethingElseDraft = {
  ticked: boolean;
  description: string;
  /** What staff typed, in pounds. Null means the amount box is still empty. */
  override: string | null;
};

export function shownSomethingElsePounds(draft: SomethingElseDraft): string {
  if (!draft.ticked) return "";
  return draft.override ?? "";
}

type ChargeValues = Record<string, string | undefined>;

/**
 * A ticked extra needs both a description and an amount. One without the other is refused.
 * Both empty is not a charge. A blank amount is not stored as £0.
 */
export function somethingElseGap(input: {
  ticked: boolean;
  description: string;
  amount: string;
}): { field: "somethingElseFee" | "somethingElseDescription"; message: string } | null {
  if (!input.ticked) return null;
  const description = input.description.trim();
  const amount = input.amount.trim();
  const hasDescription = description.length > 0;
  const hasAmountText = amount.length > 0;
  const positive = hasAmountText && poundsFieldToPence(amount) > 0;
  if (hasDescription && !positive) return { field: "somethingElseFee", message: SOMETHING_ELSE_AMOUNT_MESSAGE };
  if (hasAmountText && !hasDescription) return { field: "somethingElseDescription", message: SOMETHING_ELSE_DESCRIPTION_MESSAGE };
  return null;
}

export function somethingElseSaveError(values: ChargeValues): { field: string; message: string } | null {
  if (values.somethingElse !== "yes") return null;
  const feeRaw = (values.somethingElseFee || "").trim();
  const amount = feeRaw === "" ? "" : (Number.parseInt(feeRaw, 10) / 100).toFixed(2);
  return somethingElseGap({
    ticked: true,
    description: values.somethingElseDescription || "",
    amount: Number.isFinite(Number.parseInt(feeRaw, 10)) || feeRaw === "" ? amount : feeRaw,
  });
}

function penceField(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fees are already stored as pence strings. An unticked extra is not charged.
 * A ticked extra with no fee uses its default. A blank standard charge uses £395.
 * VAT and the total are replaced so they match those charges.
 * The card fee is 4.5% of the other net charges unless a figure was submitted.
 * Something else is added only when both the description and a positive amount are present.
 */
export function normaliseRecoveryScreen<T extends ChargeValues>(values: T): T {
  const next = { ...values };
  const standard = penceField(next.standardCharge, INDICATIVE_DEFAULTS.recovery_net_pence);
  next.standardCharge = String(standard);
  let net = standard;
  for (const extra of RECOVERY_EXTRAS) {
    if (next[extra.key] !== "yes") {
      next[extra.fee] = "";
      continue;
    }
    const fee = penceField(next[extra.fee], extra.defaultPence);
    next[extra.fee] = String(fee);
    net += fee;
  }
  const otherFee = somethingElseChargePence(next);
  if (next.somethingElse === "yes" && otherFee > 0) {
    next.somethingElseFee = String(otherFee);
    net += otherFee;
  } else if (next.somethingElse !== "yes") {
    next.somethingElseFee = "";
  }
  if (next.cardPayment !== "yes") {
    next.cardPaymentFee = "";
  } else {
    const submitted = (next.cardPaymentFee || "").trim();
    const fee = submitted === "" ? cardFeePence(net) : Number.parseInt(submitted, 10) || 0;
    next.cardPaymentFee = String(fee);
    net += fee;
  }
  const priced = recoveryVatAndTotal(net);
  next.vat = String(priced.vat);
  next.total = String(priced.gross);
  return next;
}

function somethingElseChargePence(values: ChargeValues): number {
  if (values.somethingElse !== "yes") return 0;
  if (somethingElseSaveError(values)) return 0;
  const fee = Number.parseInt(values.somethingElseFee || "", 10);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

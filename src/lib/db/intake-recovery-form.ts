import { utcFromLondonDateTime } from "../dates";
import {
  MANUAL_DETAIL_MESSAGE,
  OVERRIDE_REASON_MESSAGE,
  RECOVERY_FEE_DEFS,
  RECOVERY_TYPED_EXTRAS,
  TYPED_AMOUNT_MESSAGE,
  lineFromNet,
  lineFromReceipt,
  poundsToStoredPence,
  type RecoveryMoneyLine,
} from "../domain/recovery-fees";
import { inheritedLineLabel } from "../domain/recovery-review";
import { cardFeeOnNet, recoveryCardFeePercent, recoveryFeePence } from "./recovery-fee-settings";

export type ParsedRecovery = {
  location?: string;
  date?: string;
  time?: string;
  chargePence?: number;
  winchPence?: number;
  oohPence?: number;
  environmentalPence?: number;
  forkliftPence?: number;
  mileagePence?: number;
  manualPence?: number;
  manualDescription?: string;
  specialistWinchPence?: number;
  skatesPence?: number;
  waitingPence?: number;
  secondOperatorPence?: number;
  inherited?: boolean;
  inheritedNote?: string;
  inheritedCompany?: string;
  inheritedNetPence?: number | null;
  inheritedVatPence?: number | null;
  storageRatePence?: number;
  notifyDriverWhatsapp?: boolean;
  notifyClientWhatsapp?: boolean;
  sendAgreementChannel?: string;
  lines?: RecoveryMoneyLine[];
  fieldError?: { field: string; message: string };
};

function flag(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "yes" || value === "on" || value === "true";
}

function text(form: FormData, name: string): string {
  return String(form.get(name) || "").trim();
}

/** Date and time as Europe/London. A date on its own is not turned into 09:00. */
export function recoveryInstantFromParts(date?: string, time?: string): string | null {
  const d = (date || "").trim();
  const t = (time || "").trim();
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    if (!/^\d{2}:\d{2}$/.test(t)) return null;
    return utcFromLondonDateTime(`${d}T${t}`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d)) return utcFromLondonDateTime(d.slice(0, 16));
  return null;
}

export function parseRecoveryForm(form: FormData, readText: (form: FormData, name: string) => string): ParsedRecovery {
  const fees = form.get("recoveryFormVersion") === "fees";
  const location = readText(form, "recoveryLocation");
  const date = text(form, "recoveryDate");
  const time = text(form, "recoveryTime");
  const storageRatePence = poundsToStoredPence(text(form, "storageRate"));
  const base = {
    location,
    date,
    time,
    storageRatePence,
    notifyDriverWhatsapp: flag(form, "notifyDriverWhatsapp"),
    notifyClientWhatsapp: flag(form, "notifyClientWhatsapp"),
    sendAgreementChannel: "none",
    inherited: flag(form, "inheritedRecovery"),
  };
  if (!fees) {
    return {
      ...base,
      chargePence: poundsToStoredPence(text(form, "recoveryCharge")),
      winchPence: poundsToStoredPence(text(form, "recoveryWinch")),
      oohPence: poundsToStoredPence(text(form, "recoveryOoh")),
      environmentalPence: poundsToStoredPence(text(form, "recoveryEnvironmental")),
      forkliftPence: poundsToStoredPence(text(form, "recoveryForklift")),
      mileagePence: poundsToStoredPence(text(form, "recoveryMileage")),
      manualPence: poundsToStoredPence(text(form, "recoveryManual")),
      inheritedNote: readText(form, "inheritedNote"),
      sendAgreementChannel: text(form, "agreementChannel") || "none",
    };
  }

  const lines: RecoveryMoneyLine[] = [];
  const amounts: Record<string, number> = {};
  for (const fee of RECOVERY_FEE_DEFS) {
    const ticked = flag(form, `recoveryTick_${fee.key}`);
    const amount = poundsToStoredPence(text(form, `recoveryAmount_${fee.key}`));
    const reason = readText(form, `recoveryReason_${fee.key}`);
    if (!ticked) continue;
    const standard = recoveryFeePence(fee.key);
    if (amount !== standard && !reason) {
      return { ...base, fieldError: { field: `recoveryReason_${fee.key}`, message: OVERRIDE_REASON_MESSAGE } };
    }
    if (amount <= 0) continue;
    amounts[fee.key] = amount;
    lines.push(lineFromNet(fee.key, fee.label, amount, amount !== standard ? reason : ""));
  }
  for (const extra of RECOVERY_TYPED_EXTRAS) {
    const ticked = flag(form, `recoveryTick_${extra.key}`);
    if (!ticked) continue;
    const amount = poundsToStoredPence(text(form, `recoveryAmount_${extra.key}`));
    const reason = readText(form, `recoveryReason_${extra.key}`);
    if (amount <= 0) return { ...base, fieldError: { field: `recoveryAmount_${extra.key}`, message: TYPED_AMOUNT_MESSAGE } };
    if (!reason) return { ...base, fieldError: { field: `recoveryReason_${extra.key}`, message: OVERRIDE_REASON_MESSAGE } };
    amounts[extra.key] = amount;
    lines.push(lineFromNet(extra.key, extra.label, amount, reason));
  }
  const manualTicked = flag(form, "recoveryTick_manual");
  const manualDescription = readText(form, "recoveryManualDescription");
  const manualAmount = poundsToStoredPence(text(form, "recoveryAmount_manual"));
  const manualReason = readText(form, "recoveryReason_manual");
  if (manualTicked) {
    if (!manualDescription || manualAmount <= 0) {
      return { ...base, fieldError: { field: "recoveryManualDescription", message: MANUAL_DETAIL_MESSAGE } };
    }
    if (!manualReason) return { ...base, fieldError: { field: "recoveryReason_manual", message: OVERRIDE_REASON_MESSAGE } };
    lines.push(lineFromNet("manual", `Manual charge: ${manualDescription}`, manualAmount, manualReason));
  }
  // Optional card fee: off unless ticked, worked out on the ticked charges above (not an inherited receipt).
  if (flag(form, "recoveryTick_cardFee") && lines.length > 0) {
    const percent = recoveryCardFeePercent();
    const net = lines.reduce((total, line) => total + line.netPence, 0);
    const fee = cardFeeOnNet(net, percent);
    if (fee > 0) lines.push(lineFromNet("cardFee", `Card fee (${percent}%)`, fee, ""));
  }
  let inheritedNet: number | null = null;
  let inheritedVat: number | null = null;
  const company = readText(form, "inheritedCompany");
  if (base.inherited) {
    if (!company) return { ...base, fieldError: { field: "inheritedCompany", message: "Enter the company that charged the inherited recovery." } };
    if (!text(form, "inheritedNet")) {
      return { ...base, fieldError: { field: "inheritedNet", message: "Enter the net amount shown on the receipt." } };
    }
    if (text(form, "inheritedVat") === "") {
      return { ...base, fieldError: { field: "inheritedVat", message: "Enter the VAT shown on the receipt. Use 0 if the receipt shows no VAT." } };
    }
    inheritedNet = poundsToStoredPence(text(form, "inheritedNet"));
    inheritedVat = poundsToStoredPence(text(form, "inheritedVat"));
    lines.push(lineFromReceipt("inherited", inheritedLineLabel(company), inheritedNet, inheritedVat));
  }
  return {
    ...base,
    chargePence: amounts.standard || 0,
    environmentalPence: amounts.environmental || 0,
    winchPence: amounts.winching || 0,
    forkliftPence: amounts.forklift || 0,
    oohPence: amounts.outOfHours || 0,
    mileagePence: 0,
    manualPence: manualTicked ? manualAmount : 0,
    manualDescription,
    specialistWinchPence: amounts.specialistWinching || 0,
    skatesPence: amounts.skates || 0,
    waitingPence: amounts.waiting || 0,
    secondOperatorPence: amounts.secondOperator || 0,
    inheritedCompany: company,
    inheritedNetPence: inheritedNet,
    inheritedVatPence: inheritedVat,
    lines,
  };
}

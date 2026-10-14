import { INDICATIVE_DEFAULTS } from "../constants";
import { inclusiveHireDays } from "./rules";
import { storageProvisionalLabel, ukDayLabel, type StorageCountBasis } from "./storage-charge";
import { grossFromNet } from "../money";

export { HIRE_INCLUSIVE_DAY_NOTE } from "./storage-charge";

export const STORED_HIRE_DIFFERS = "Stored figure differs from calculation, review";
export const HIRE_NOT_STARTED = "Hire not started";
export const FAULT_COURTESY_NOT_CREDIT_HIRE = "Fault courtesy is not credit hire.";

export type HireCountBasis = StorageCountBasis;

export type HireAgreementInput = {
  sequence: number;
  startDay: string | null;
  signed: boolean;
  /** Daily rate recorded on that agreement. Null when the row does not store one. */
  ratePence: number | null;
};

export type HireRateLine = {
  sequence: number | null;
  fromDay: string;
  toDay: string;
  days: number;
  ratePence: number;
  netPence: number;
  label: string;
};

export type HireExtraKey = "cdw" | "additional_driver" | "delivery_collection";

export type HireExtraLine = {
  key: HireExtraKey;
  label: string;
  days: number | null;
  ratePence: number;
  netPence: number;
};

export type HireCharge =
  | { status: "not_started" }
  | { status: "courtesy" }
  | { status: "no_rate"; note: string }
  | { status: "end_before_start" }
  | {
      status: "calculated";
      days: number;
      provisional: boolean;
      basis: HireCountBasis;
      label: string | null;
      lines: HireRateLine[];
      extras: HireExtraLine[];
      notes: string[];
      swapDays: string[];
      netPence: number;
      vatPence: number;
      totalPence: number;
      countedTo: string;
      /** Rate to mention while hire is still running. The latest period when the rate changed. */
      continuingRatePence: number;
    };

export type HireChargeInput = {
  /** Europe/London day the replacement was handed over. Null when there is no handover. */
  handoverDay: string | null;
  confirmedEndDay: string | null;
  proposedEndDay?: string | null;
  today: string;
  /** False for fault courtesy. Courtesy is not priced as credit hire. */
  creditHire: boolean;
  agreements: HireAgreementInput[];
  /** Rate saved when the agreement was generated, when the agreement row itself has none. */
  generatedRatePence?: number | null;
  /** Rate on the hire booking, used only when no agreement rate and no generated rate is stored. */
  episodeRatePence?: number | null;
  /** Later handover days. A swap does not add a day and does not change the rate. */
  swapDays?: string[];
  cdwPence?: number | null;
  additionalDriverPence?: number | null;
  deliveryCollectionPence?: number | null;
  /** True only when a signed agreement is on the file, so extras are not taken from a blank pack. */
  extrasOnSignedAgreement?: boolean;
  vatRate?: number;
};

function isoDay(value: string | null | undefined): string | null {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function positivePence(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function shiftHireDay(isoDayValue: string, days: number): string {
  const [year, month, day] = isoDayValue.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rateLine(sequence: number | null, fromDay: string, toDay: string, ratePence: number): HireRateLine | null {
  const days = inclusiveHireDays(fromDay, toDay);
  if (days == null || days <= 0) return null;
  const label =
    sequence == null
      ? `${days} days × ${ukDayLabel(fromDay)} to ${ukDayLabel(toDay)}`
      : `Agreement ${sequence}, ${days} days × ${ukDayLabel(fromDay)} to ${ukDayLabel(toDay)}`;
  return {
    sequence,
    fromDay,
    toDay,
    days,
    ratePence,
    netPence: days * ratePence,
    label,
  };
}

type RatedAgreement = { sequence: number; startDay: string; ratePence: number };

function inForce(rated: RatedAgreement[], day: string): RatedAgreement | null {
  const covering = rated.filter((agreement) => agreement.startDay <= day);
  covering.sort((a, b) => {
    if (a.startDay !== b.startDay) return a.startDay < b.startDay ? 1 : -1;
    return b.sequence - a.sequence;
  });
  return covering[0] || null;
}

/**
 * Hire from the handover day to the confirmed end, or to a proposed end, or to today.
 * A renewal with its own rate and start day is a separate line. The changeover day is counted once, on the new agreement.
 * A renewal that does not record its rate, or the day the rate changed, is not given an invented split.
 */
export function hireCharge(input: HireChargeInput): HireCharge {
  const handover = isoDay(input.handoverDay);
  if (!handover) return { status: "not_started" };
  if (!input.creditHire) return { status: "courtesy" };

  const confirmed = isoDay(input.confirmedEndDay);
  const proposed = confirmed ? null : isoDay(input.proposedEndDay);
  const basis: HireCountBasis = confirmed ? "confirmed" : proposed ? "proposed" : "today";
  const countedTo = confirmed || proposed || input.today;
  const days = inclusiveHireDays(handover, countedTo);
  if (days == null) return { status: "end_before_start" };

  const signed = input.agreements
    .filter((agreement) => agreement.signed)
    .map((agreement) => ({
      sequence: agreement.sequence,
      startDay: isoDay(agreement.startDay),
      ratePence: positivePence(agreement.ratePence),
    }))
    .sort((a, b) => a.sequence - b.sequence);

  const notes: string[] = [];
  const rated: RatedAgreement[] = [];
  for (const agreement of signed) {
    if (agreement.ratePence != null && agreement.startDay) {
      rated.push({ sequence: agreement.sequence, startDay: agreement.startDay, ratePence: agreement.ratePence });
      continue;
    }
    if (agreement.ratePence != null && !agreement.startDay) {
      notes.push(
        `Agreement ${agreement.sequence} records a daily rate but not the day that rate started, so the days are not split.`,
      );
    } else if (signed.length > 1 && agreement.sequence > Math.min(...signed.map((row) => row.sequence))) {
      notes.push(
        `Agreement ${agreement.sequence} does not record its own daily rate, so the days are not split.`,
      );
    }
  }

  const generated = positivePence(input.generatedRatePence);
  const episode = positivePence(input.episodeRatePence);
  const distinctRates = [...new Set(rated.map((agreement) => agreement.ratePence))];
  const proven =
    rated.length === 1
      ? rated[0].ratePence
      : distinctRates.length === 1
        ? distinctRates[0]
        : generated || episode || null;

  const canSplit = rated.length >= 2 && notes.length === 0;
  const lines: HireRateLine[] = [];

  if (canSplit) {
    const earliest = [...rated].sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : a.sequence - b.sequence))[0];
    const boundaries = [...new Set(rated.map((agreement) => agreement.startDay))]
      .filter((day) => day > handover && day <= countedTo)
      .sort();
    let from = handover;
    const rateFor = (day: string) => {
      const agreement = inForce(rated, day);
      return { agreement, rate: agreement?.ratePence ?? earliest?.ratePence ?? proven };
    };
    for (const boundary of boundaries) {
      const previous = shiftHireDay(boundary, -1);
      if (previous >= from) {
        const { agreement, rate } = rateFor(from);
        if (rate == null) return { status: "no_rate", note: "A signed daily rate is not on the file, so there is no figure." };
        const line = rateLine(agreement?.sequence ?? earliest?.sequence ?? null, from, previous, rate);
        if (line) lines.push(line);
      }
      from = boundary;
    }
    if (from <= countedTo) {
      const { agreement, rate } = rateFor(from);
      if (rate == null) return { status: "no_rate", note: "A signed daily rate is not on the file, so there is no figure." };
      const line = rateLine(agreement?.sequence ?? earliest?.sequence ?? null, from, countedTo, rate);
      if (line) lines.push(line);
    }
  } else {
    if (proven == null) {
      return { status: "no_rate", note: "A signed daily rate is not on the file, so there is no figure." };
    }
    if (notes.length > 0) {
      notes.push("Counted once at the daily rate that is recorded.");
    }
    const line = rateLine(rated.length === 1 ? rated[0].sequence : null, handover, countedTo, proven);
    if (line) lines.push(line);
  }

  if (lines.length === 0 || lines.reduce((sum, line) => sum + line.days, 0) !== days) {
    return { status: "end_before_start" };
  }

  const extras: HireExtraLine[] = [];
  if (input.extrasOnSignedAgreement) {
    const cdw = positivePence(input.cdwPence);
    const driver = positivePence(input.additionalDriverPence);
    const delivery = positivePence(input.deliveryCollectionPence);
    if (cdw) {
      extras.push({
        key: "cdw",
        label: `Collision damage waiver, ${days} days`,
        days,
        ratePence: cdw,
        netPence: days * cdw,
      });
    }
    if (driver) {
      extras.push({
        key: "additional_driver",
        label: `Additional driver, ${days} days`,
        days,
        ratePence: driver,
        netPence: days * driver,
      });
    }
    if (delivery) {
      extras.push({
        key: "delivery_collection",
        label: "Delivery and collection",
        days: null,
        ratePence: delivery,
        netPence: delivery,
      });
    }
  }

  const net = lines.reduce((sum, line) => sum + line.netPence, 0) + extras.reduce((sum, line) => sum + line.netPence, 0);
  const priced = grossFromNet(net, input.vatRate ?? INDICATIVE_DEFAULTS.vat_rate);
  const swapDays = [...new Set((input.swapDays || []).map((day) => isoDay(day)).filter((day): day is string => Boolean(day && day !== handover && day <= countedTo && day >= handover)))].sort();

  return {
    status: "calculated",
    days,
    provisional: basis !== "confirmed",
    basis,
    label: storageProvisionalLabel(basis, countedTo),
    lines,
    extras,
    notes,
    swapDays,
    netPence: priced.net,
    vatPence: priced.vat,
    totalPence: priced.gross,
    countedTo,
    continuingRatePence: lines[lines.length - 1]?.ratePence || proven || 0,
  };
}

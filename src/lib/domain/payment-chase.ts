import {
  PAYMENT_TERM_NOT_SET_LABEL,
  REPAIR_PAYMENT_CHASE_DUE_LABEL,
  REPAIR_PAYMENT_REQUEST_LABEL,
  SETTLEMENT_PAYMENT_CHASE_DUE_LABEL,
  SETTLEMENT_PAYMENT_REQUEST_LABEL,
} from "../constants";
import { addCalendarDaysIso, formatUkDate } from "../dates";
import { chaseClockDecision, type ChaseClockDecision, type ChaseHandlerState } from "./chase";
import { PAYMENT_DETAILS_MISSING, paymentDetailsLetterLine, type InsurerPaymentDetails } from "./payment-details";
import { formatGbp } from "../money";

/** Heads a payment chase may follow. Storage is never one of them. */
export const PAYMENT_CHASE_HEADS = ["repairs", "vehicle_damage"] as const;
export type PaymentChaseHead = (typeof PAYMENT_CHASE_HEADS)[number];

/** A second figure logged this soon after the last one, and marked as a correction, replaces that figure. */
export const PAYMENT_CORRECTION_WINDOW_MS = 2 * 60 * 1000;

export function isPaymentChaseHead(value: string): value is PaymentChaseHead {
  return (PAYMENT_CHASE_HEADS as readonly string[]).includes(value);
}

export function outstandingOnHead(agreedPence: number, receivedPence: number): number {
  const agreed = Math.max(0, Math.trunc(agreedPence || 0));
  const received = Math.max(0, Math.trunc(receivedPence || 0));
  if (agreed <= 0 || received >= agreed) return 0;
  return agreed - received;
}

/** True only when an agreed figure is on the file and the amount received matches it exactly. */
export function headSettledInFull(agreedPence: number, receivedPence: number): boolean {
  return agreedPence > 0 && receivedPence === agreedPence;
}

/** A part-payment is never treated as paid. */
export function partPaymentCountsAsPaid(agreedPence: number, receivedPence: number): boolean {
  if (receivedPence <= 0 || agreedPence <= 0) return false;
  if (receivedPence < agreedPence) return false;
  return false;
}

export type LoggedPaymentResult = {
  receivedPence: number;
  replacedPrevious: boolean;
  unchanged: boolean;
  reviewReason: string | null;
};

/**
 * The amount received is one total on the financial line.
 * A normal entry adds this payment to that total.
 * A correction inside the short window replaces the previous entry instead of adding both.
 */
export function applyLoggedPayment(input: {
  receivedPence: number;
  amountPence: number;
  previousAmountPence: number | null;
  previousAt: string | null;
  now: string;
  correction: boolean;
}): LoggedPaymentResult {
  const current = Math.max(0, Math.trunc(input.receivedPence || 0));
  const amount = Math.trunc(input.amountPence);
  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      receivedPence: current,
      replacedPrevious: false,
      unchanged: true,
      reviewReason: "No amount was recorded.",
    };
  }
  if (!input.correction) {
    return { receivedPence: current + amount, replacedPrevious: false, unchanged: false, reviewReason: null };
  }
  const previous = input.previousAmountPence;
  const previousAt = input.previousAt ? Date.parse(input.previousAt) : Number.NaN;
  const now = Date.parse(input.now);
  const recent =
    previous != null &&
    previous > 0 &&
    Number.isFinite(previousAt) &&
    Number.isFinite(now) &&
    now >= previousAt &&
    now - previousAt <= PAYMENT_CORRECTION_WINDOW_MS;
  if (!recent) {
    return {
      receivedPence: current,
      replacedPrevious: false,
      unchanged: true,
      reviewReason:
        "This was marked as a correction, but there is no payment on this head in the last two minutes to replace. The balance was not changed.",
    };
  }
  const base = Math.max(0, current - Math.trunc(previous));
  return { receivedPence: base + amount, replacedPrevious: true, unchanged: false, reviewReason: null };
}

export type PaymentReplyClass = "acknowledgement" | "substantive" | "uncertain";

const SUBSTANTIVE =
  /\b(dispute|disputed|query|queries|part[-\s]?offer|without prejudice|do not agree|don't agree|disagree|wrong figure|invoice is wrong|not agreed)\b/i;
const ACKNOWLEDGEMENT =
  /\b(acknowledgement|acknowledge|acknowledged|thank you for your email|thanks for your email|out of office|automatic reply|auto-reply|we have received your email)\b/i;

/** An acknowledgement does not resolve the chase. Uncertain text is not guessed. */
export function classifyPaymentReply(text: string): PaymentReplyClass {
  const body = String(text || "").trim();
  if (!body) return "uncertain";
  if (SUBSTANTIVE.test(body)) return "substantive";
  if (ACKNOWLEDGEMENT.test(body)) return "acknowledgement";
  return "uncertain";
}

export function paymentDueDateLine(paymentTermDays: number | null, asAt: string): { text: string; unset: boolean } {
  if (paymentTermDays == null || paymentTermDays < 1) {
    return { text: PAYMENT_TERM_NOT_SET_LABEL, unset: true };
  }
  const due = addCalendarDaysIso(asAt, paymentTermDays);
  return { text: `Please pay by ${formatUkDate(due)}.`, unset: false };
}

export function paymentRequestCopy(input: {
  stage: "first" | "reminder";
  fileReference: string;
  theirRef: string;
  head: PaymentChaseHead;
  agreedPence: number;
  receivedPence: number;
  outstandingPence: number;
  bank: InsurerPaymentDetails;
  paymentTermDays: number | null;
  asAt: string;
  hirePackSentOn: string | null;
  firstChaseOn: string | null;
  handlerName: string;
}): { subject: string; body: string; dueDateUnset: boolean } {
  const fileRef = input.fileReference.trim() || "this file";
  const their = input.theirRef.trim();
  const theirLine = !their || their === "Unknown" ? "not yet on file" : their;
  const headName = input.head === "repairs" ? "repair invoice" : "agreed total-loss settlement";
  const outstanding = formatGbp(input.outstandingPence);
  const agreed = formatGbp(input.agreedPence);
  const received = formatGbp(input.receivedPence);
  const due = paymentDueDateLine(input.paymentTermDays, input.asAt);
  const bankLine = paymentDetailsLetterLine(input.bank);
  const packOn = input.hirePackSentOn ? formatUkDate(input.hirePackSentOn) : null;
  const opening =
    input.stage === "first"
      ? packOn
        ? `We refer to our letter of ${packOn} enclosing our hire pack. The amount still outstanding on the ${headName} is ${outstanding}.`
        : `We write on ${fileRef}. The amount still outstanding on the ${headName} is ${outstanding}.`
      : `We refer to ${fileRef}${input.firstChaseOn ? ` and our letter of ${formatUkDate(input.firstChaseOn)}` : ""}. The amount still outstanding on the ${headName} is ${outstanding}.`;
  const receivedLine =
    input.receivedPence > 0
      ? `The agreed figure is ${agreed}. ${received} has been received. The balance still to pay is ${outstanding}. Storage is not included in this figure.`
      : `The agreed figure is ${agreed}. Nothing has been received against it. Storage is not included in this figure.`;
  const ask =
    input.stage === "reminder"
      ? `We have still not received payment of ${outstanding}, nor a substantive response setting out any dispute. This is a further reminder. Please pay ${outstanding}, or reply with the reasons for disputing that figure.`
      : `Please pay ${outstanding}. If the figure is disputed, please say so and on what basis.`;
  const subject =
    input.stage === "reminder"
      ? `Further reminder — ${fileRef} — ${outstanding} outstanding on the ${headName}`
      : `Payment request — ${fileRef} — ${outstanding} on the ${headName}`;
  const body = [
    "Dear Sirs,",
    "",
    `Claim ref: ${fileRef} / your ref: ${theirLine}`,
    "",
    opening,
    receivedLine,
    ask,
    bankLine === PAYMENT_DETAILS_MISSING ? PAYMENT_DETAILS_MISSING : bankLine,
    due.text,
    "",
    "Kind regards,",
    input.handlerName.trim() || "Claims handler",
    "Complete Accident Solutions Ltd",
  ].join("\n");
  return { subject, body, dueDateUnset: due.unset };
}

export function paymentChaseDecision(input: {
  head: PaymentChaseHead;
  agreedPence: number;
  receivedPence: number;
  startedAt: string | null;
  lastChaseSentAt: string | null;
  handlerState: ChaseHandlerState;
  intervalDays: number;
  asAt: string;
  pausedReason: string | null;
}): ChaseClockDecision {
  const dueLabel = input.head === "repairs" ? REPAIR_PAYMENT_CHASE_DUE_LABEL : SETTLEMENT_PAYMENT_CHASE_DUE_LABEL;
  const firstLabel = input.head === "repairs" ? REPAIR_PAYMENT_REQUEST_LABEL : SETTLEMENT_PAYMENT_REQUEST_LABEL;
  const paid = headSettledInFull(input.agreedPence, input.receivedPence);
  const clock = chaseClockDecision({
    startedAt: input.startedAt,
    lastChaseSentAt: input.lastChaseSentAt,
    outcomeAt: paid ? input.asAt : null,
    outcomeClearedAt: null,
    handlerState: input.handlerState,
    intervalDays: input.intervalDays,
    asAt: input.asAt,
    dueLabel,
    notStartedReason: "No payment request has been marked as sent.",
    outcomeOnFileReason: "Paid in full on this head. The chase has stopped. Hire and storage are not closed.",
  });
  if (input.agreedPence <= 0) {
    return {
      ...clock,
      active: false,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason: "No agreed figure on this head. Claimed and offered amounts are not chased.",
    };
  }
  if (input.receivedPence > input.agreedPence) {
    return {
      ...clock,
      active: true,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason: "The amount received is higher than the agreed figure. Flagged for review. It is not treated as paid, and it is not chased.",
    };
  }
  if (paid) return { ...clock, due: false, outcomeOnFile: true, label: null, severity: null };
  if (input.handlerState === "paused") {
    return {
      ...clock,
      active: true,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason: input.pausedReason || "Chase paused for review.",
    };
  }
  if (input.handlerState === "cancelled") return clock;
  if (!input.startedAt) {
    return {
      ...clock,
      active: true,
      due: true,
      outcomeOnFile: false,
      label: firstLabel,
      severity: "red",
      dueAt: input.asAt,
      reason: `${firstLabel}. The email is prepared for review and includes the outstanding figure. Nothing is sent until you click Send.`,
    };
  }
  return clock;
}

import {
  HIRE_PAYMENT_CHASE_DUE_LABEL,
  RECOVERY_PAYMENT_CHASE_DUE_LABEL,
  REPAIR_PAYMENT_CHASE_DUE_LABEL,
  REPAIR_PAYMENT_REQUEST_LABEL,
  SETTLEMENT_PAYMENT_CHASE_DUE_LABEL,
  SETTLEMENT_PAYMENT_REQUEST_LABEL,
  STORAGE_PAYMENT_CHASE_DUE_LABEL,
} from "../constants";
import { formatUkDate } from "../dates";
import { paymentTermLine } from "./payment-term";
import { chaseClockDecision, type ChaseClockDecision, type ChaseHandlerState } from "./chase";
import { PAYMENT_DETAILS_MISSING, paymentDetailsLetterLine, type InsurerPaymentDetails } from "./payment-details";
import { formatGbp } from "../money";

/** Repair invoice and total-loss settlement. Hire, storage and recovery use their own chase kinds. */
export const PAYMENT_CHASE_HEADS = ["repairs", "vehicle_damage"] as const;

export type ChargePaymentHead = "hire" | "storage" | "recovery";

/** A storage figure is not requested as a final charge while the end date is only proposed. */
export const STORAGE_PAYMENT_REQUEST_BLOCK =
  "Storage is not chased. An unconfirmed storage figure is not put into a payment request as a final charge.";

/** Hire is not a payment-chase head. An unconfirmed hire total is left out of letter and pack totals. */
export const HIRE_PAYMENT_REQUEST_BLOCK =
  "An unconfirmed hire figure is not put into a payment request as a final charge. Hire is not chased.";
export type PaymentChaseHead = (typeof PAYMENT_CHASE_HEADS)[number];
export type AnyPaymentHead = PaymentChaseHead | ChargePaymentHead;

export function isChargePaymentHead(value: string): value is ChargePaymentHead {
  return value === "hire" || value === "storage" || value === "recovery";
}

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

/** An automatic reply is never read as substantive, even when it quotes words from our email. */
const AUTOMATIC_REPLY = /\b(out of (the )?office|automatic reply|auto-reply|autoreply)\b/i;

/** An acknowledgement does not resolve the chase. Uncertain text is not guessed. */
export function classifyPaymentReply(text: string): PaymentReplyClass {
  const body = String(text || "").trim();
  if (!body) return "uncertain";
  if (AUTOMATIC_REPLY.test(body)) return "acknowledgement";
  if (SUBSTANTIVE.test(body)) return "substantive";
  if (ACKNOWLEDGEMENT.test(body)) return "acknowledgement";
  return "uncertain";
}

/** Words that answer a liability or repair-authorisation chase: a decision, an offer or a dispute. */
const DECISION =
  /\b(liability|accept|accepted|admit|admitted|deny|denied|decline|declined|repudiat\w*|authoris\w*|authoriz\w*|approve|approved|settle|settlement|offer|valuation|total loss|will pay|will be paying)\b/i;

/**
 * A reply to an insurer chase that is not a payment chase (liability, repair authorisation). The same rules as a
 * payment reply: an automatic reply or acknowledgement changes nothing, a decision or dispute is substantive, and
 * anything else is uncertain and goes to a person (J11).
 */
export function classifyInsurerReply(text: string): PaymentReplyClass {
  const body = String(text || "").trim();
  if (!body) return "uncertain";
  if (AUTOMATIC_REPLY.test(body)) return "acknowledgement";
  if (SUBSTANTIVE.test(body) || DECISION.test(body)) return "substantive";
  if (ACKNOWLEDGEMENT.test(body)) return "acknowledgement";
  return "uncertain";
}

/** Default is Due on receipt. A stored insurer term is printed as that term. No day count is invented. */
export function paymentDueDateLine(paymentTerm: string | null): { text: string } {
  return { text: paymentTermLine(paymentTerm) };
}

export function paymentRequestCopy(input: {
  stage: "first" | "reminder";
  fileReference: string;
  theirRef: string;
  head: AnyPaymentHead;
  agreedPence: number;
  claimedPence?: number;
  receivedPence: number;
  outstandingPence: number;
  salvageProceedsPence?: number;
  bank: InsurerPaymentDetails;
  /** Null uses Due on receipt. A string is that insurer's stored term. */
  paymentTerm: string | null;
  asAt: string;
  hirePackSentOn: string | null;
  firstChaseOn: string | null;
  handlerName: string;
}): { subject: string; body: string } {
  const fileRef = input.fileReference.trim() || "this file";
  const their = input.theirRef.trim();
  const theirLine = !their || their === "Unknown" ? "not yet on file" : their;
  const headName =
    input.head === "repairs"
      ? "repair invoice"
      : input.head === "vehicle_damage"
        ? "agreed total-loss settlement"
        : input.head === "hire"
          ? "hire charge"
          : input.head === "storage"
            ? "storage charge"
            : "recovery charge";
  const outstanding = formatGbp(input.outstandingPence);
  const figurePence = input.agreedPence > 0 ? input.agreedPence : Math.max(0, Math.trunc(input.claimedPence || 0));
  const agreed = formatGbp(figurePence);
  const received = formatGbp(input.receivedPence);
  const due = paymentDueDateLine(input.paymentTerm);
  const bankLine = paymentDetailsLetterLine(input.bank);
  const packOn = input.hirePackSentOn ? formatUkDate(input.hirePackSentOn) : null;
  const opening =
    input.stage === "first"
      ? packOn
        ? `We refer to our letter of ${packOn} enclosing our hire pack. The amount still outstanding on the ${headName} is ${outstanding}.`
        : `We write on ${fileRef}. The amount still outstanding on the ${headName} is ${outstanding}.`
      : `We refer to ${fileRef}${input.firstChaseOn ? ` and our letter of ${formatUkDate(input.firstChaseOn)}` : ""}. The amount still outstanding on the ${headName} is ${outstanding}.`;
  const salvage = Math.max(0, Math.trunc(input.salvageProceedsPence || 0));
  const net = Math.max(0, input.agreedPence - salvage);
  const salvageSentence =
    input.head === "vehicle_damage" && salvage > 0
      ? ` Salvage proceeds of ${formatGbp(salvage)} are already recorded, so the amount to pay is ${formatGbp(net)}.`
      : "";
  const figureWord = input.agreedPence > 0 ? "agreed figure" : "confirmed claimed figure";
  const storageNote = input.head === "repairs" || input.head === "vehicle_damage" ? " Storage is not included in this figure." : "";
  const receivedLine =
    input.receivedPence > 0
      ? `The ${figureWord} is ${agreed}.${salvageSentence} ${received} has been received. The balance still to pay is ${outstanding}.${storageNote}`
      : `The ${figureWord} is ${agreed}.${salvageSentence} Nothing has been received against it.${storageNote}`;
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
  return { subject, body };
}

function dueLabelFor(head: AnyPaymentHead): string {
  if (head === "repairs") return REPAIR_PAYMENT_CHASE_DUE_LABEL;
  if (head === "hire") return HIRE_PAYMENT_CHASE_DUE_LABEL;
  if (head === "storage") return STORAGE_PAYMENT_CHASE_DUE_LABEL;
  if (head === "recovery") return RECOVERY_PAYMENT_CHASE_DUE_LABEL;
  return SETTLEMENT_PAYMENT_CHASE_DUE_LABEL;
}

export function paymentChaseDecision(input: {
  head: AnyPaymentHead;
  agreedPence: number;
  receivedPence: number;
  startedAt: string | null;
  lastChaseSentAt: string | null;
  handlerState: ChaseHandlerState;
  intervalDays: number;
  asAt: string;
  pausedReason: string | null;
  /** Agreed figure after salvage proceeds, when that applies. Defaults to the agreed figure. */
  comparisonPence?: number;
  /** Hire, storage and recovery may chase the confirmed claimed figure when nothing is agreed. */
  claimedPence?: number;
  useConfirmedClaimed?: boolean;
}): ChaseClockDecision {
  const dueLabel = dueLabelFor(input.head);
  const firstLabel = input.head === "repairs" ? REPAIR_PAYMENT_REQUEST_LABEL : SETTLEMENT_PAYMENT_REQUEST_LABEL;
  const claimedBase =
    input.useConfirmedClaimed && input.agreedPence <= 0 ? Math.max(0, Math.trunc(input.claimedPence || 0)) : 0;
  const chaseBase = input.agreedPence > 0 ? input.agreedPence : claimedBase;
  const comparison = input.agreedPence > 0 ? (input.comparisonPence ?? input.agreedPence) : chaseBase;
  const paid = chaseBase > 0 && comparison > 0 && input.receivedPence === comparison;
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
  if (chaseBase <= 0) {
    return {
      ...clock,
      active: false,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason: input.useConfirmedClaimed
        ? "No agreed or confirmed claimed figure on this head."
        : "No agreed figure on this head. Claimed and offered amounts are not chased.",
    };
  }
  if (comparison <= 0) {
    return {
      ...clock,
      active: true,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason:
        "Salvage proceeds are not less than the agreed figure. Flagged for review. It is not treated as paid, and it is not chased.",
    };
  }
  if (input.receivedPence > comparison) {
    return {
      ...clock,
      active: true,
      due: false,
      outcomeOnFile: false,
      label: null,
      severity: null,
      reason:
        comparison === input.agreedPence
          ? "The amount received is higher than the agreed figure. Flagged for review. It is not treated as paid, and it is not chased."
          : "The amount received is higher than the agreed figure after salvage proceeds. Flagged for review. It is not treated as paid, and it is not chased.",
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

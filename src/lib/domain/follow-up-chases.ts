import { addCalendarDaysIso, daysBetweenLondon } from "../dates";

/** Papers a client can usually produce from their phone. The 24-hour interval applies to these only. */
export const DOCUMENT_CHASES = [
  {
    kind: "document_driving_licence",
    documentType: "driving_licence",
    label: "Driving licence chase due",
    title: "Driving licence",
  },
  {
    kind: "document_insurance_certificate",
    documentType: "insurance_certificate",
    label: "Insurance certificate chase due",
    title: "Insurance certificate",
  },
  {
    kind: "document_v5c",
    documentType: "v5c_client",
    label: "Logbook (V5C) chase due",
    title: "Logbook (V5C)",
  },
  {
    kind: "document_bank_statements",
    documentType: "bank_statements",
    label: "Bank statements chase due",
    title: "Bank statements",
  },
] as const;

export type DocumentChaseKind = (typeof DOCUMENT_CHASES)[number]["kind"];
export type DocumentChaseType = (typeof DOCUMENT_CHASES)[number]["documentType"];

export const TOTAL_LOSS_PAYMENT_CHASE_KIND = "total_loss_payment" as const;
export type TotalLossPaymentChaseKind = typeof TOTAL_LOSS_PAYMENT_CHASE_KIND;

export type SupplementaryChaseKind = DocumentChaseKind | TotalLossPaymentChaseKind;

export const SUPPLEMENTARY_CHASE_ORDER: SupplementaryChaseKind[] = [
  ...DOCUMENT_CHASES.map((item) => item.kind),
  TOTAL_LOSS_PAYMENT_CHASE_KIND,
];

export const DOCUMENT_CHASE_HOURS = 24;
export const TOTAL_LOSS_PAYMENT_RESPONSE_DAYS = 3;
export const TOTAL_LOSS_PAYMENT_ARRIVAL_DAYS = 7;

export const DOCUMENT_CHASE_SENT_EVENT = "document_chase_sent";
export const TOTAL_LOSS_NOTICE_SENT_EVENT = "total_loss_notice_sent";
export const TOTAL_LOSS_PAYMENT_PROMISED_EVENT = "total_loss_payment_promised";
export const TOTAL_LOSS_PAYMENT_RECEIVED_EVENT = "total_loss_payment_received";
export const TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT = "total_loss_payment_chase_sent";

export const DOCUMENT_CHASE_DUE_LABELS = DOCUMENT_CHASES.map((item) => item.label);
export const TOTAL_LOSS_PAYMENT_CHASE_DUE_LABEL = "Total-loss payment chase due";

const DOCUMENT_CHASE_MS = DOCUMENT_CHASE_HOURS * 60 * 60 * 1000;

export function documentChaseByKind(kind: string) {
  return DOCUMENT_CHASES.find((item) => item.kind === kind) || null;
}

export function isDocumentChaseKind(value: string): value is DocumentChaseKind {
  return DOCUMENT_CHASES.some((item) => item.kind === value);
}

/**
 * There is no separate "requested on" column. The client welcome is the request for these four papers.
 * The clock starts at that event. Uploading the paper (or, for bank statements, recording them on the hire pack) clears it at once.
 * A chase marked as sent restarts another 24 hours. 24 hours is elapsed time, not a calendar day.
 */
export function documentChaseDecision(input: {
  requestedAt: string | null;
  received: boolean;
  lastChaseSentAt: string | null;
  asAt: string;
}): { started: boolean; due: boolean; dueAt: string | null; outcomeOnFile: boolean } {
  if (input.received) {
    return { started: Boolean(input.requestedAt), due: false, dueAt: null, outcomeOnFile: true };
  }
  if (!input.requestedAt) {
    return { started: false, due: false, dueAt: null, outcomeOnFile: false };
  }
  const requestedMs = Date.parse(input.requestedAt);
  const sentMs = input.lastChaseSentAt ? Date.parse(input.lastChaseSentAt) : Number.NaN;
  const anchor = Number.isFinite(sentMs) && sentMs > requestedMs ? input.lastChaseSentAt! : input.requestedAt;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) {
    return { started: true, due: false, dueAt: null, outcomeOnFile: false };
  }
  const dueAtMs = anchorMs + DOCUMENT_CHASE_MS;
  const asAtMs = Date.parse(input.asAt);
  return {
    started: true,
    due: Number.isFinite(asAtMs) && asAtMs >= dueAtMs,
    dueAt: new Date(dueAtMs).toISOString(),
    outcomeOnFile: false,
  };
}

/**
 * After the total-loss notification is sent, chase every 3 calendar days until the insurer confirms
 * they are sending payment, or until the money arrives. Confirmation switches the wait to 7 calendar
 * days, repeating from the confirmation or from the last chase sent after that confirmation.
 * Money received clears the chase from either stage. An offer is not a receipt.
 */
export function totalLossPaymentChaseDecision(input: {
  noticeSentAt: string | null;
  insurerPromisedAt: string | null;
  paymentReceived: boolean;
  lastChaseSentAt: string | null;
  asAt: string;
}): {
  started: boolean;
  due: boolean;
  dueAt: string | null;
  stage: "not_started" | "awaiting_response" | "awaiting_arrival" | "received";
  label: string;
} {
  const label = TOTAL_LOSS_PAYMENT_CHASE_DUE_LABEL;
  if (input.paymentReceived) {
    return { started: Boolean(input.noticeSentAt), due: false, dueAt: null, stage: "received", label };
  }
  if (!input.noticeSentAt) {
    return { started: false, due: false, dueAt: null, stage: "not_started", label };
  }
  const promised = input.insurerPromisedAt && Date.parse(input.insurerPromisedAt) ? input.insurerPromisedAt : null;
  const stage = promised ? "awaiting_arrival" : "awaiting_response";
  const interval = promised ? TOTAL_LOSS_PAYMENT_ARRIVAL_DAYS : TOTAL_LOSS_PAYMENT_RESPONSE_DAYS;
  const stageStart = promised || input.noticeSentAt;
  const sentMs = input.lastChaseSentAt ? Date.parse(input.lastChaseSentAt) : Number.NaN;
  const anchor = Number.isFinite(sentMs) && sentMs > Date.parse(stageStart) ? input.lastChaseSentAt! : stageStart;
  const dueAt = addCalendarDaysIso(anchor, interval);
  const days = daysBetweenLondon(anchor, input.asAt);
  return {
    started: true,
    due: days >= interval,
    dueAt,
    stage,
    label,
  };
}

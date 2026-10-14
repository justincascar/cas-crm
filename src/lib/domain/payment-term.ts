import { PAYMENT_DUE_ON_RECEIPT, PAYMENT_DUE_ON_RECEIPT_SENTENCE } from "../constants";

const ZERO_DAYS = /^0(\s*days?)?$/i;

/** Blank means the CAS default. A stored term is that insurer's own words. 0 days is refused. */
export function normaliseInsurerPaymentTerm(raw: string): string | null {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (ZERO_DAYS.test(text)) {
    throw new Error(
      "A payment term is not shown as 0 days. Leave the box empty to use Due on receipt, or type that insurer's own term.",
    );
  }
  return text;
}

/** The sentence on an invoice, or the insurer's stored term. Never "0 days" and never "not set". */
export function paymentTermLine(term: string | null | undefined): string {
  const text = String(term || "").trim();
  if (!text || ZERO_DAYS.test(text)) return PAYMENT_DUE_ON_RECEIPT_SENTENCE;
  return text;
}

export function paymentTermLabel(term: string | null | undefined): string {
  const text = String(term || "").trim();
  if (!text || ZERO_DAYS.test(text)) return PAYMENT_DUE_ON_RECEIPT;
  return text;
}

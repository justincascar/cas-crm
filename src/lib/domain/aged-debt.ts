/** Age bands for money still owed, counted from the day the payment request for that head was sent. */
export const AGED_DEBT_BANDS = ["0–30 days", "31–60 days", "61–90 days", "Over 90 days", "Not requested yet"] as const;
export type AgedDebtBand = (typeof AGED_DEBT_BANDS)[number];

export function agedDebtBand(ageDays: number | null): AgedDebtBand {
  if (ageDays == null) return "Not requested yet";
  if (ageDays <= 30) return "0–30 days";
  if (ageDays <= 60) return "31–60 days";
  if (ageDays <= 90) return "61–90 days";
  return "Over 90 days";
}

/** The payment request events that start the clock for each head of loss. */
export const PAYMENT_REQUEST_EVENTS: Record<string, string[]> = {
  repairs: ["repair_payment_request_sent", "settlement_payment_request_sent"],
  vehicle_damage: ["settlement_payment_request_sent", "repair_payment_request_sent"],
  recovery: ["recovery_payment_request_sent"],
  storage: ["storage_payment_request_sent"],
  hire: ["hire_payment_request_sent"],
  credit_hire: ["hire_payment_request_sent"],
};

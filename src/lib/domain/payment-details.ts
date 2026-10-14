export const PAYMENT_DETAILS_MISSING = "Payment details not yet on file.";

/** Shown on the file and the dashboard when Settings has no CAS account. Nothing is invented. */
export const BANK_DETAILS_MISSING_SETTINGS = "Bank details missing in Settings";

export type InsurerPaymentDetails = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
};

export const BLANK_PAYMENT_DETAILS: InsurerPaymentDetails = {
  accountName: "",
  sortCode: "",
  accountNumber: "",
};

export function paymentDetailsComplete(details: InsurerPaymentDetails): boolean {
  return Boolean(details.accountName.trim() && details.sortCode.trim() && details.accountNumber.trim());
}

/** Last four characters stay visible. Shorter values are masked down to the last character. */
export function maskKeptLastFour(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "(blank)";
  const digits = text.replace(/\D/g, "");
  const source = digits.length >= 4 ? digits : text.replace(/\s+/g, "");
  if (source.length <= 4) {
    if (source.length <= 1) return "*";
    return `${"*".repeat(source.length - 1)}${source.slice(-1)}`;
  }
  return `${"*".repeat(source.length - 4)}${source.slice(-4)}`;
}

export function bankDetailsAuditText(before: InsurerPaymentDetails, after: InsurerPaymentDetails): string {
  return [
    `Account name ${maskKeptLastFour(before.accountName)} → ${maskKeptLastFour(after.accountName)}.`,
    `Sort code ${maskKeptLastFour(before.sortCode)} → ${maskKeptLastFour(after.sortCode)}.`,
    `Account number ${maskKeptLastFour(before.accountNumber)} → ${maskKeptLastFour(after.accountNumber)}.`,
  ].join(" ");
}

/** Shown in the total-loss notification. A blank account is named as missing. Nothing is invented. */
export function paymentDetailsLetterLine(details: InsurerPaymentDetails): string {
  if (!paymentDetailsComplete(details)) return PAYMENT_DETAILS_MISSING;
  return `Please send payment to ${details.accountName.trim()}, sort code ${details.sortCode.trim()}, account number ${details.accountNumber.trim()}.`;
}

/** Replaces a stored bank line so a queued chaser uses the details now in Settings. */
export function refreshPaymentBankLine(body: string, details: InsurerPaymentDetails): string {
  const line = paymentDetailsLetterLine(details);
  const pattern = /^(Please send payment to .+|Payment details not yet on file\.)$/m;
  if (pattern.test(body)) return body.replace(pattern, line);
  const trimmed = body.trim();
  if (!trimmed) return line;
  return `${trimmed}\n${line}`;
}

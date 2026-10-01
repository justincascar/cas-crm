export const PAYMENT_DETAILS_MISSING = "Payment details not yet on file.";

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

/** Shown in the total-loss notification. A blank account is named as missing. Nothing is invented. */
export function paymentDetailsLetterLine(details: InsurerPaymentDetails): string {
  if (!paymentDetailsComplete(details)) return PAYMENT_DETAILS_MISSING;
  return `Please send payment to ${details.accountName.trim()}, sort code ${details.sortCode.trim()}, account number ${details.accountNumber.trim()}.`;
}

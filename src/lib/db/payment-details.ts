import {
  BLANK_PAYMENT_DETAILS,
  type InsurerPaymentDetails,
} from "../domain/payment-details";
import { all, run } from "./connection";

export const SETTING_INSURER_PAYMENT_ACCOUNT_NAME = "insurer_payment_account_name";
export const SETTING_INSURER_PAYMENT_SORT_CODE = "insurer_payment_sort_code";
export const SETTING_INSURER_PAYMENT_ACCOUNT_NUMBER = "insurer_payment_account_number";

const KEYS = [
  SETTING_INSURER_PAYMENT_ACCOUNT_NAME,
  SETTING_INSURER_PAYMENT_SORT_CODE,
  SETTING_INSURER_PAYMENT_ACCOUNT_NUMBER,
] as const;

function read(key: string, rows: Array<{ key: string; value: string }>): string {
  return String(rows.find((row) => row.key === key)?.value || "").trim();
}

export function getInsurerPaymentDetails(): InsurerPaymentDetails {
  const rows = all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`,
    [...KEYS],
  );
  return {
    accountName: read(SETTING_INSURER_PAYMENT_ACCOUNT_NAME, rows),
    sortCode: read(SETTING_INSURER_PAYMENT_SORT_CODE, rows),
    accountNumber: read(SETTING_INSURER_PAYMENT_ACCOUNT_NUMBER, rows),
  };
}

function upsert(key: string, value: string) {
  const existing = all<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [key]);
  if (existing.length) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [value, key]);
    return;
  }
  run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [key, value]);
}

/** Staff type CAS's own account. Blank is the default. A partial account is rejected. */
export function saveInsurerPaymentDetails(input: InsurerPaymentDetails): InsurerPaymentDetails {
  const name = input.accountName.trim();
  const sortDigits = input.sortCode.replace(/\D/g, "");
  const accountDigits = input.accountNumber.replace(/\D/g, "");
  if (!name && !sortDigits && !accountDigits) {
    run(`DELETE FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`, [...KEYS]);
    return { ...BLANK_PAYMENT_DETAILS };
  }
  if (!name || sortDigits.length !== 6 || accountDigits.length !== 8) {
    throw new Error(
      "Enter the account name, a 6-digit sort code and an 8-digit account number, or leave all three blank.",
    );
  }
  const sortCode = `${sortDigits.slice(0, 2)}-${sortDigits.slice(2, 4)}-${sortDigits.slice(4, 6)}`;
  upsert(SETTING_INSURER_PAYMENT_ACCOUNT_NAME, name);
  upsert(SETTING_INSURER_PAYMENT_SORT_CODE, sortCode);
  upsert(SETTING_INSURER_PAYMENT_ACCOUNT_NUMBER, accountDigits);
  return { accountName: name, sortCode, accountNumber: accountDigits };
}

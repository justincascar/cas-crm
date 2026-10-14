import { nowUtcIso } from "../dates";
import {
  BLANK_PAYMENT_DETAILS,
  bankDetailsAuditText,
  type InsurerPaymentDetails,
} from "../domain/payment-details";
import { accountCanManageBankDetails } from "./permissions";
import { all, get, newId, run } from "./connection";

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

export const BANK_DETAILS_CHANGED = "bank_details_changed";

/**
 * Only manageBankDetails may change these. Incoming mail, attachments, client
 * submissions and imports do not call this. Blank clears the account. A partial account is rejected.
 */
export function saveInsurerPaymentDetails(
  input: InsurerPaymentDetails,
  actor: { staffId: string; role: string | null | undefined },
): InsurerPaymentDetails {
  if (!accountCanManageBankDetails(actor.staffId, actor.role)) {
    throw new Error("You cannot change the bank details.");
  }
  const name = input.accountName.trim();
  const sortDigits = input.sortCode.replace(/\D/g, "");
  const accountDigits = input.accountNumber.replace(/\D/g, "");
  const before = getInsurerPaymentDetails();
  let saved: InsurerPaymentDetails;
  if (!name && !sortDigits && !accountDigits) {
    run(`DELETE FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`, [...KEYS]);
    saved = { ...BLANK_PAYMENT_DETAILS };
  } else if (!name || sortDigits.length !== 6 || accountDigits.length !== 8) {
    throw new Error("Enter the account name, a 6-digit sort code and an 8-digit account number, or leave all three blank.");
  } else {
    const sortCode = `${sortDigits.slice(0, 2)}-${sortDigits.slice(2, 4)}-${sortDigits.slice(4, 6)}`;
    upsert(SETTING_INSURER_PAYMENT_ACCOUNT_NAME, name);
    upsert(SETTING_INSURER_PAYMENT_SORT_CODE, sortCode);
    upsert(SETTING_INSURER_PAYMENT_ACCOUNT_NUMBER, accountDigits);
    saved = { accountName: name, sortCode, accountNumber: accountDigits };
  }
  if (
    before.accountName === saved.accountName &&
    before.sortCode === saved.sortCode &&
    before.accountNumber === saved.accountNumber
  ) {
    return saved;
  }
  const at = nowUtcIso();
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, 'settings', 'insurer_payment', ?)`,
    [newId("audit"), at, actor.staffId, BANK_DETAILS_CHANGED, bankDetailsAuditText(before, saved)],
  );
  return saved;
}

export function latestBankDetailsChange(): { at: string; actorName: string } | null {
  const row = get<{ at: string; actor_name: string | null }>(
    `SELECT a.at, s.name AS actor_name
     FROM audit_log a
     LEFT JOIN staff s ON s.id = a.actor_id
     WHERE a.action = ?
     ORDER BY a.at DESC LIMIT 1`,
    [BANK_DETAILS_CHANGED],
  );
  if (!row?.at) return null;
  return { at: String(row.at), actorName: String(row.actor_name || "Unknown") };
}

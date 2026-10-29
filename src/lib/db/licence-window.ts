import { get, run } from "./connection";

export const SETTING_LICENCE_CHECK_WINDOW_DAYS = "licence_check_window_days";
export const LICENCE_CHECK_WINDOW_DAYS_DEFAULT = 21;

/** Justin confirmed 21 days on 29/10/2026. It matches a GOV.UK check code. */
export function licenceCheckWindowDays(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_LICENCE_CHECK_WINDOW_DAYS]);
  const n = Number(row?.value);
  if (!Number.isInteger(n) || n < 1 || n > 365) return LICENCE_CHECK_WINDOW_DAYS_DEFAULT;
  return n;
}

export function setLicenceCheckWindowDays(raw: string): number {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw new Error("Enter the licence check window as a whole number of days, from 1 to 365.");
  }
  const existing = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_LICENCE_CHECK_WINDOW_DAYS]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(n), SETTING_LICENCE_CHECK_WINDOW_DAYS]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_LICENCE_CHECK_WINDOW_DAYS, String(n)]);
  return n;
}

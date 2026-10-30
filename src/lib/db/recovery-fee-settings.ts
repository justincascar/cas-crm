import type { DatabaseSync } from "node:sqlite";
import { RECOVERY_FEE_DEFS, type RecoveryFeeKey } from "../domain/recovery-fees";
import { get, run } from "./connection";

export function ensureRecoveryFeeSettings(db: DatabaseSync) {
  for (const fee of RECOVERY_FEE_DEFS) {
    const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(fee.settingKey) as { value: string } | undefined;
    if (!existing) {
      db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(fee.settingKey, String(fee.defaultPence));
    }
  }
}

export function recoveryFeePence(key: RecoveryFeeKey): number {
  const fee = RECOVERY_FEE_DEFS.find((item) => item.key === key);
  if (!fee) return 0;
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [fee.settingKey]);
  const parsed = Number.parseInt(row?.value || "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) return fee.defaultPence;
  return parsed;
}

export function recoveryFeeSchedule(): Record<RecoveryFeeKey, number> {
  const out = {} as Record<RecoveryFeeKey, number>;
  for (const fee of RECOVERY_FEE_DEFS) out[fee.key] = recoveryFeePence(fee.key);
  return out;
}

/** Changes the setting only. A fee already stored on a claim is not rewritten. */
export function setRecoveryFeePence(key: RecoveryFeeKey, pence: number) {
  const fee = RECOVERY_FEE_DEFS.find((item) => item.key === key);
  if (!fee) throw new Error("That recovery fee is not in Settings.");
  if (!Number.isInteger(pence) || pence < 0) throw new Error("Enter the fee in pounds.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [fee.settingKey]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(pence), fee.settingKey]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [fee.settingKey, String(pence)]);
}

export const CARD_FEE_SETTING_KEY = "recovery_card_fee_percent";
export const CARD_FEE_DEFAULT_PERCENT = 4.5;

/** The card fee percentage offered on the recovery form. The fee itself is only charged when staff tick it. */
export function recoveryCardFeePercent(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [CARD_FEE_SETTING_KEY]);
  const parsed = Number(row?.value ?? "");
  if (row?.value === undefined || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) return CARD_FEE_DEFAULT_PERCENT;
  return parsed;
}

/** Changes the setting only. A card fee already stored on a claim is not rewritten. */
export function setRecoveryCardFeePercent(value: string) {
  const trimmed = value.trim().replace(/%$/, "").trim();
  const parsed = Number(trimmed);
  if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed) || parsed > 100) throw new Error("Enter the card fee as a percentage, for example 4.5.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [CARD_FEE_SETTING_KEY]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(parsed), CARD_FEE_SETTING_KEY]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [CARD_FEE_SETTING_KEY, String(parsed)]);
}

/** Card fee on the ticked recovery charges (net), rounded to the penny. VAT is then added to the fee as for the old screen. */
/** The card fee before VAT: the Settings percentage of the gross amount being paid (R25). */
export function cardFeeOnAmount(amountPence: number, percent: number): number {
  return Math.round((amountPence * percent) / 100);
}

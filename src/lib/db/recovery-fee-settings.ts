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

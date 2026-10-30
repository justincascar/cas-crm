import { RECOVERY_FEE_DEFS, RECOVERY_TYPED_EXTRAS, filledPounds } from "@/lib/domain/recovery-fees";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/**
 * The standard recovery fee and the extras, each plus VAT. The standard fee starts ticked with the Settings figure
 * so the handler confirms it; nothing is charged until the form is saved. A changed fee needs a reason.
 */
export function RecoveryFeeFields({
  fees,
  defaults,
}: {
  /** Settings figures in pence, by fee key. */
  fees: Partial<Record<string, number>>;
  /** Earlier entries, by field name, to fill the form again. */
  defaults: Record<string, string>;
}) {
  return (
    <div className="space-y-3" data-recovery-fees>
      {RECOVERY_FEE_DEFS.map((fee) => {
        const pounds = filledPounds(fees[fee.key] ?? fee.defaultPence);
        const ticked = defaults[`recoveryTick_${fee.key}`] ? defaults[`recoveryTick_${fee.key}`] === "yes" : fee.key === "standard";
        return (
          <div key={fee.key} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr] sm:items-end">
            <label className="flex items-center gap-2 text-sm">
              <input name={`recoveryTick_${fee.key}`} type="checkbox" value="yes" defaultChecked={ticked} />
              {fee.label} <span className="text-slate">(£{pounds} + VAT)</span>
            </label>
            <label className="block text-sm">
              Amount (£)
              <input name={`recoveryAmount_${fee.key}`} defaultValue={defaults[`recoveryAmount_${fee.key}`] || pounds} className={field} />
            </label>
            <label className="block text-sm">
              Reason if not £{pounds}
              <input name={`recoveryReason_${fee.key}`} defaultValue={defaults[`recoveryReason_${fee.key}`] || ""} className={field} />
            </label>
          </div>
        );
      })}
      {RECOVERY_TYPED_EXTRAS.map((extra) => (
        <div key={extra.key} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr] sm:items-end">
          <label className="flex items-center gap-2 text-sm">
            <input name={`recoveryTick_${extra.key}`} type="checkbox" value="yes" defaultChecked={defaults[`recoveryTick_${extra.key}`] === "yes"} />
            {extra.label}
          </label>
          <label className="block text-sm">
            Amount (£)
            <input name={`recoveryAmount_${extra.key}`} defaultValue={defaults[`recoveryAmount_${extra.key}`] || ""} className={field} />
          </label>
          <label className="block text-sm">
            Reason
            <input name={`recoveryReason_${extra.key}`} defaultValue={defaults[`recoveryReason_${extra.key}`] || ""} className={field} />
          </label>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input name="recoveryTick_manual" type="checkbox" value="yes" defaultChecked={defaults.recoveryTick_manual === "yes"} />
          Manual charge
        </label>
        <label className="block text-sm">
          Description
          <input name="recoveryManualDescription" defaultValue={defaults.recoveryManualDescription || ""} className={field} />
        </label>
        <label className="block text-sm">
          Amount (£)
          <input name="recoveryAmount_manual" defaultValue={defaults.recoveryAmount_manual || ""} className={field} />
        </label>
        <label className="block text-sm sm:col-span-2">
          Reason
          <input name="recoveryReason_manual" defaultValue={defaults.recoveryReason_manual || ""} className={field} />
        </label>
      </div>
      <p className="text-xs text-slate">Each ticked amount is plus VAT. Unticked items are not charged. A card fee is added when a card payment is recorded, not here.</p>
    </div>
  );
}

/** Field values to fill the fee form again from charges already saved on the file. */
export function feeDefaultsFromLines(lines: Array<{ key: string; label: string; netPence: number; reason: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  if (lines.length === 0) return out;
  out.recoveryTick_standard = "no";
  for (const line of lines) {
    // An inherited receipt and a card fee kept from the old tick are not boxes on this form.
    if (line.key === "inherited" || line.key === "cardFee") continue;
    const key = line.key;
    out[`recoveryTick_${key}`] = "yes";
    out[`recoveryAmount_${key}`] = filledPounds(line.netPence);
    if (line.reason) out[`recoveryReason_${key}`] = line.reason;
    if (key === "manual") out.recoveryManualDescription = line.label.replace(/^Manual charge: /, "");
  }
  return out;
}

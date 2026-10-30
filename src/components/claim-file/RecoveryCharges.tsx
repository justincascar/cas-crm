"use client";

import { useState } from "react";
import { casingInputProps } from "@/components/CasedField";
import { INDICATIVE_DEFAULTS } from "@/lib/constants";
import {
  RECOVERY_EXTRAS,
  type ExtraDraft,
  type RecoveryExtraKey,
  type SomethingElseDraft,
  cardFeePence,
  cardFeePercentLabel,
  extraDraftFromSaved,
  normalisePounds,
  recoveryNetPence,
  recoveryVatAndTotal,
  shownExtraPounds,
  shownSomethingElsePounds,
  somethingElseGap,
  penceToPounds,
  poundsFieldToPence,
} from "@/lib/domain/recovery-charges";
import { formatGbp } from "@/lib/money";
import { formatTypedValue, formatTypedValueLive } from "@/lib/text";
import type { ScreenValues } from "@/lib/db/screens";

const control = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";
const feeControl = "w-28 rounded-md border border-line bg-white px-3 py-2 text-sm";

function initialStandard(values: ScreenValues): string {
  if (values.standardCharge != null && values.standardCharge !== "") return penceToPounds(values.standardCharge);
  return (INDICATIVE_DEFAULTS.recovery_net_pence / 100).toFixed(2);
}

function initialExtras(values: ScreenValues): Record<RecoveryExtraKey, ExtraDraft> {
  const drafts = {} as Record<RecoveryExtraKey, ExtraDraft>;
  for (const extra of RECOVERY_EXTRAS) {
    drafts[extra.key] = extraDraftFromSaved({
      ticked: values[extra.key] === "yes",
      keptPence: values[extra.kept] || "",
      feePence: values[extra.fee] || "",
      defaultPence: extra.defaultPence,
    });
  }
  return drafts;
}

function initialOther(values: ScreenValues): SomethingElseDraft {
  const ticked = values.somethingElse === "yes";
  const description = values.somethingElseDescription || "";
  const kept = (values.somethingElseKept || "").trim();
  if (kept) return { ticked, description, override: penceToPounds(kept) };
  const fee = (values.somethingElseFee || "").trim();
  if (ticked && fee && Number.parseInt(fee, 10) > 0) return { ticked, description, override: penceToPounds(fee) };
  return { ticked, description, override: null };
}

function subtotalPence(
  standard: string,
  extras: Record<RecoveryExtraKey, ExtraDraft>,
  other: SomethingElseDraft,
): number {
  const named = recoveryNetPence({
    standardPounds: standard,
    extras: RECOVERY_EXTRAS.map((extra) => ({
      ticked: extras[extra.key].ticked,
      shownPounds: shownExtraPounds(extras[extra.key], extra.defaultPence),
    })),
  });
  const shown = shownSomethingElsePounds(other);
  const gap = somethingElseGap({ ticked: other.ticked, description: other.description, amount: shown });
  if (gap || !other.ticked) return named;
  const amount = poundsFieldToPence(shown);
  return amount > 0 ? named + amount : named;
}

function initialCard(values: ScreenValues): ExtraDraft {
  const standard = initialStandard(values);
  const extras = initialExtras(values);
  const other = initialOther(values);
  return extraDraftFromSaved({
    ticked: values.cardPayment === "yes",
    keptPence: values.cardPaymentKept || "",
    feePence: values.cardPaymentFee || "",
    defaultPence: cardFeePence(subtotalPence(standard, extras, other)),
  });
}

export function RecoveryCharges({ values }: { values: ScreenValues }) {
  const [standard, setStandard] = useState(() => initialStandard(values));
  const [extras, setExtras] = useState(() => initialExtras(values));
  const [other, setOther] = useState(() => initialOther(values));
  const [card, setCard] = useState(() => initialCard(values));
  const defaultStandard = (INDICATIVE_DEFAULTS.recovery_net_pence / 100).toFixed(2);
  const cardPercent = cardFeePercentLabel();

  const rows = RECOVERY_EXTRAS.map((extra) => ({
    ...extra,
    draft: extras[extra.key],
    shown: shownExtraPounds(extras[extra.key], extra.defaultPence),
  }));
  const otherShown = shownSomethingElsePounds(other);
  const otherGap = somethingElseGap({ ticked: other.ticked, description: other.description, amount: otherShown });
  const calculatedCard = cardFeePence(subtotalPence(standard, extras, other));
  const cardShown = shownExtraPounds(card, calculatedCard);
  const priced = recoveryVatAndTotal(
    subtotalPence(standard, extras, other) + (card.ticked ? poundsFieldToPence(cardShown) : 0),
  );

  function setExtra(key: RecoveryExtraKey, next: ExtraDraft) {
    setExtras((current) => ({ ...current, [key]: next }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        Fees are net. VAT at {Math.round(INDICATIVE_DEFAULTS.vat_rate * 100)}% and the total follow the standard charge and whichever extras are ticked. A card fee ({cardPercent} of the amount paid, VAT included, plus VAT on the fee) is added when a card payment is recorded.
      </p>
      <label className="block max-w-xs text-sm">
        Standard recovery charge
        <input
          className={control}
          inputMode="decimal"
          value={standard}
          onChange={(event) => setStandard(event.target.value)}
          onBlur={(event) => {
            const next = normalisePounds(event.target.value);
            setStandard(next || defaultStandard);
          }}
        />
        <span className="mt-1 block text-xs text-slate">
          Default {formatGbp(INDICATIVE_DEFAULTS.recovery_net_pence)}. Change it for this job if you need to.
        </span>
      </label>
      <input type="hidden" name="standardCharge" value={standard} />

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-white px-3 py-2">
            <label className="flex min-w-40 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={row.key}
                value="yes"
                checked={row.draft.ticked}
                onChange={(event) => setExtra(row.key, { ...row.draft, ticked: event.target.checked })}
                className="h-4 w-4"
              />
              {row.label}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate">Fee</span>
              <input
                className={feeControl}
                inputMode="decimal"
                value={row.shown}
                readOnly={!row.draft.ticked}
                onChange={(event) => setExtra(row.key, { ...row.draft, override: event.target.value })}
                onBlur={(event) => {
                  const typed = event.target.value.trim();
                  setExtras((current) => {
                    const draft = current[row.key];
                    if (!draft.ticked) return current;
                    if (!typed) return { ...current, [row.key]: { ...draft, override: null } };
                    return { ...current, [row.key]: { ...draft, override: normalisePounds(typed) } };
                  });
                }}
              />
            </label>
            <span className="text-xs text-slate">Default {formatGbp(row.defaultPence)}</span>
            <input type="hidden" name={row.fee} value={row.draft.ticked ? row.shown : ""} />
            <input type="hidden" name={row.kept} value={row.draft.override ?? ""} />
          </div>
        ))}

        <div className="rounded-md border border-line bg-white px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="somethingElse"
              value="yes"
              checked={other.ticked}
              onChange={(event) => setOther((current) => ({ ...current, ticked: event.target.checked }))}
              className="h-4 w-4"
            />
            Something else
          </label>
          {other.ticked ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                What it is
                <input
                  name="somethingElseDescription"
                  className={control}
                  value={other.description}
                  placeholder="For example, tree removal from site"
                  onChange={(event) =>
                    setOther((current) => ({
                      ...current,
                      description: formatTypedValueLive("somethingElseDescription", event.target.value),
                    }))
                  }
                  onBlur={(event) =>
                    setOther((current) => ({
                      ...current,
                      description: formatTypedValue("somethingElseDescription", event.target.value),
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                Amount
                <input
                  name="somethingElseFee"
                  className={control}
                  inputMode="decimal"
                  value={otherShown}
                  onChange={(event) => setOther((current) => ({ ...current, override: event.target.value }))}
                  onBlur={(event) => {
                    const typed = event.target.value.trim();
                    setOther((current) => ({ ...current, override: typed ? normalisePounds(typed) : null }));
                  }}
                />
                <span className="mt-1 block text-xs text-slate">No default. Enter the amount for this job.</span>
              </label>
            </div>
          ) : (
            <>
              <input type="hidden" name="somethingElseDescription" value={other.description} />
              <input type="hidden" name="somethingElseFee" value="" />
            </>
          )}
          {otherGap ? (
            <p className="field-error mt-2 text-sm" data-field-error={otherGap.field}>
              {otherGap.message}
            </p>
          ) : null}
          <input type="hidden" name="somethingElseKept" value={other.override ?? ""} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-white px-3 py-2">
          <label className="flex min-w-40 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="cardPayment"
              value="yes"
              checked={card.ticked}
              onChange={(event) => setCard((current) => ({ ...current, ticked: event.target.checked }))}
              className="h-4 w-4"
            />
            Card fee
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate">Fee</span>
            <input
              className={feeControl}
              inputMode="decimal"
              value={cardShown}
              readOnly={!card.ticked}
              onChange={(event) => setCard((current) => ({ ...current, override: event.target.value }))}
              onBlur={(event) => {
                const typed = event.target.value.trim();
                setCard((current) => {
                  if (!current.ticked) return current;
                  if (!typed) return { ...current, override: null };
                  return { ...current, override: normalisePounds(typed) };
                });
              }}
            />
          </label>
          <span className="text-xs text-slate">
            {card.override != null
              ? `Using the figure you typed. Clear the fee to use ${cardPercent} (${formatGbp(calculatedCard)}).`
              : `${cardPercent} of the net charges above, before VAT. Change it for this job if you need to.`}
          </span>
          <input type="hidden" name="cardPaymentFee" value={card.ticked ? cardShown : ""} />
          <input type="hidden" name="cardPaymentKept" value={card.override ?? ""} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Prior fee incurred / inherited
          <input name="priorFeeIncurred" className={control} inputMode="decimal" defaultValue={penceToPounds(values.priorFeeIncurred)} />
          <span className="mt-1 block text-xs text-slate">Recorded on its own. It is not added into VAT or the total.</span>
        </label>
        <label className="block text-sm">
          Reason for fee
          <input name="reasonForFee" defaultValue={values.reasonForFee || ""} {...casingInputProps("reasonForFee", "text", control)} />
        </label>
        <label className="block text-sm">
          VAT
          <input name="vat" readOnly className={`${control} bg-[#f4f7f8]`} value={(priced.vat / 100).toFixed(2)} />
        </label>
        <label className="block text-sm">
          Total
          <input name="total" readOnly className={`${control} bg-[#f4f7f8]`} value={(priced.gross / 100).toFixed(2)} />
        </label>
      </div>
    </div>
  );
}

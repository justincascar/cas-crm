"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { actionLogHeadPayment } from "@/app/chase-actions";
import { ValidatedForm } from "@/components/ValidatedForm";
import type { PayableHead } from "@/lib/db/payment-review";
import { paymentComparisonLabel } from "@/lib/domain/storage-charge";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function PaymentReviewPanel({
  claimId,
  payableHeads = [],
  lockedHead,
  cardFeePercent,
}: {
  claimId: string;
  payableHeads?: PayableHead[];
  lockedHead?: { head: string; label: string; receivedPence: number; agreedPence: number; claimedPence: number };
  /** Card fee percentage from Settings, added only when Paying by card is ticked. */
  cardFeePercent?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const paymentKey = useRef("");
  if (!paymentKey.current) paymentKey.current = crypto.randomUUID();
  const pending = useRef<FormData | null>(null);
  const confirmField = useRef("confirmSeparate");
  const [selectedHead, setSelectedHead] = useState<string>(payableHeads[0]?.head || "");
  const selected = payableHeads.find((head) => head.head === selectedHead) || payableHeads[0];
  const comparison = lockedHead
    ? paymentComparisonLabel(lockedHead)
    : selected
      ? paymentComparisonLabel({
          receivedPence: selected.receivedPence,
          agreedPence: selected.agreedPence,
          claimedPence: selected.claimedPence,
        })
      : "No figure to compare against yet";

  if (!lockedHead && payableHeads.length === 0) return null;

  async function submit(form: FormData, confirm = false) {
    setBusy(true);
    setMessage(null);
    setRefused(null);
    form.set("claimId", claimId);
    form.set("payingByCard", form.get("payingByCard") ? "yes" : "");
    form.set("submitKey", confirm ? crypto.randomUUID() : paymentKey.current);
    if (confirm) form.set(confirmField.current, "yes");
    const result = await actionLogHeadPayment(form);
    setBusy(false);
    if ("needsConfirm" in result && result.needsConfirm) {
      setWarning(String(result.warning || ""));
      confirmField.current = "confirmField" in result && result.confirmField ? String(result.confirmField) : "confirmSeparate";
      pending.current = form;
      return;
    }
    if (result.error) {
      // R59: said plainly as a problem; what was typed stays in the boxes.
      setRefused(result.error);
      return;
    }
    setWarning(null);
    paymentKey.current = crypto.randomUUID();
    if ("message" in result && result.message) setMessage(result.message);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-xl border-2 border-navy bg-card p-5" aria-label="Record a payment">
      <div>
        <h2 className="font-serif text-xl text-navy-deep">Record a payment</h2>
        <p className="mt-1 text-sm text-slate">
          {lockedHead ? `Amount on ${lockedHead.label} only. ` : "Amount on one head. "}
          {comparison}. This records the money only. If it does not cover that figure, Awaiting decision appears on this file and on the dashboard. That choice is made later.
        </p>
      </div>

      {message ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{message}</p> : null}
      {refused ? (
        <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-3 py-2 text-sm text-overdue" role="alert" data-form-error>
          Not recorded: {refused}
        </p>
      ) : null}
      {warning ? (
        <div className="rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm" role="alert">
          <p>{warning}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
              disabled={busy}
              onClick={() => {
                if (pending.current) void submit(pending.current, true);
              }}
            >
              Yes
            </button>
            <button
              type="button"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setWarning(null);
                pending.current = null;
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ValidatedForm
        className="grid gap-2 rounded-md border border-line bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          form.set("correction", form.get("correction") ? "yes" : "");
          void submit(form);
        }}
      >
        <p className="text-sm font-semibold">{lockedHead ? `Record a payment on ${lockedHead.label}` : "Record a payment on one head"}</p>
        {lockedHead ? (
          <input type="hidden" name="head" value={lockedHead.head} />
        ) : (
          <label className="text-sm">
            Head of loss
            <select
              name="head"
              className={field}
              required
              value={selected?.head || ""}
              onChange={(event) => setSelectedHead(event.target.value)}
            >
              {payableHeads.map((head) => (
                <option key={head.head} value={head.head}>
                  {head.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Amount received (£)
          <input name="amount" inputMode="decimal" required className={field} />
        </label>
        <label className="text-sm">
          Insurer&apos;s stated reason for paying less, if they gave one
          <input name="insurerReason" className={field} />
        </label>
        <label className="flex items-start gap-2 text-sm" data-paying-by-card>
          <input type="checkbox" name="payingByCard" value="yes" />
          <span>
            Paying by card. Adds a separate card fee{cardFeePercent != null ? ` of ${cardFeePercent}%` : ""} of the amount paid (VAT included), plus VAT on the fee. It is kept apart from this
            charge.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="correction" value="yes" />
          <span>This corrects the amount just recorded. It replaces that figure. It is not added on top.</span>
        </label>
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
          Record payment received
        </button>
      </ValidatedForm>
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { actionLogHeadPayment } from "@/app/chase-actions";
import type { PayableHead } from "@/lib/db/payment-review";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function PaymentReviewPanel({
  claimId,
  payableHeads = [],
  lockedHead,
}: {
  claimId: string;
  payableHeads?: PayableHead[];
  lockedHead?: { head: string; label: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!lockedHead && payableHeads.length === 0) return null;

  async function submit(form: FormData) {
    setBusy(true);
    setMessage(null);
    form.set("claimId", claimId);
    const result = await actionLogHeadPayment(form);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.message) setMessage(result.message);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-xl border-2 border-navy bg-card p-5" aria-label="Record a payment">
      <div>
        <h2 className="font-serif text-xl text-navy-deep">Record a payment</h2>
        <p className="mt-1 text-sm text-slate">
          {lockedHead
            ? `Amount on ${lockedHead.label} only. This records the money only. If it does not cover the figure, Awaiting decision appears on this file and on the dashboard. That choice is made later.`
            : "Amount on one head. This records the money only. If it does not cover the figure, Awaiting decision appears on this file and on the dashboard. That choice is made later."}
        </p>
      </div>

      {message ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{message}</p> : null}

      <form
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
            <select name="head" className={field} required defaultValue={payableHeads[0]?.head || ""}>
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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="correction" value="yes" />
          <span>This corrects the amount just recorded. It replaces that figure. It is not added on top.</span>
        </label>
        <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
          Record payment received
        </button>
      </form>
    </section>
  );
}

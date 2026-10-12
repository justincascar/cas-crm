"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { actionAcceptPaymentSettlement, actionDisputePaymentSettlement } from "@/app/chase-actions";
import { acceptWriteOffConfirmation } from "@/lib/domain/head-screen";
import type { PaymentReviewItem } from "@/lib/db/payment-review";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function HeadDecisionForm({
  claimId,
  review,
  canAccept,
}: {
  claimId: string;
  review: PaymentReviewItem;
  canAccept: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: (form: FormData) => Promise<{ error?: string }>, form: FormData) {
    setBusy(true);
    setMessage(null);
    form.set("claimId", claimId);
    const result = await action(form);
    setBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3" aria-label="Payment decision">
      {message ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{message}</p> : null}
      {canAccept ? (
        <div className="rounded-md border border-line bg-white p-3">
          <p className="text-sm">
            Accept as final sets the agreed figure on this head to the amount received and writes off the shortfall. Hire and
            storage stay open.
          </p>
          {confirming ? (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void submit(actionAcceptPaymentSettlement, form);
              }}
            >
              <p className="text-sm font-semibold">{acceptWriteOffConfirmation(review.outstandingPence)}</p>
              <input type="hidden" name="head" value={review.head} />
              <input type="hidden" name="confirm" value="yes" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" disabled={busy}>
                  Yes, write this off
                </button>
                <button
                  type="button"
                  className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Go back
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setConfirming(true)}
            >
              Accept as final
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-md border border-line bg-white p-3 text-sm">
          Accepting this as the final figure needs the acceptPaymentSettlement permission. The administrator role does not include
          it.
        </p>
      )}
      <form
        className="rounded-md border border-line bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void submit(actionDisputePaymentSettlement, form);
        }}
      >
        <label className="text-sm">
          Grounds for disputing this and keeping the chase going
          <textarea name="grounds" required className={`${field} min-h-20`} />
        </label>
        <p className="mt-1 text-sm text-slate">Use your own words. The agreed figure is left as it is.</p>
        <input type="hidden" name="head" value={review.head} />
        <button type="submit" className="mt-3 rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy" disabled={busy}>
          Dispute / keep chasing
        </button>
      </form>
    </div>
  );
}

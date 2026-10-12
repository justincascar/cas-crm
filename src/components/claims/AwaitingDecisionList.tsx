import Link from "next/link";
import { formatUkDate } from "@/lib/dates";
import { awaitingDecisionLabel } from "@/lib/domain/payment-review";
import { headScreenPath } from "@/lib/domain/head-screen";
import type { PaymentReviewItem, SettledPaymentFlag } from "@/lib/db/payment-review";

const row = "rounded-md bg-[#fff6e8] px-3 py-2 text-sm";

export function AwaitingDecisionList({
  claimId,
  reviews,
  settled,
}: {
  claimId: string;
  reviews: PaymentReviewItem[];
  settled: SettledPaymentFlag[];
}) {
  if (reviews.length === 0 && settled.length === 0) return null;

  return (
    <div id="payment-flags" className="space-y-4">
      {reviews.length > 0 ? (
        <section className="rounded-xl border-2 border-navy bg-card p-5" aria-label="Awaiting decision">
          <h2 className="font-serif text-xl text-navy-deep">Awaiting decision</h2>
          <p className="mt-1 text-sm text-slate">
            Money has been recorded and does not cover the figure. It stays here until you open it. Recording the payment does not
            make the choice.
          </p>
          <ul className="mt-4 space-y-2">
            {reviews.map((review) => (
              <li key={review.head} className={row}>
                <Link
                  href={headScreenPath(claimId, review.head)}
                  className="font-semibold text-navy-deep underline"
                >
                  {awaitingDecisionLabel(review)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {settled.length > 0 ? (
        <section className="rounded-xl border-2 border-navy bg-card p-5" aria-label="Payments to review">
          <h2 className="font-serif text-xl text-navy-deep">Payments to review</h2>
          <p className="mt-1 text-sm text-slate">
            These amounts arrived after the head was accepted as the final figure. They were not added to the agreed or received
            figures.
          </p>
          <ul className="mt-4 space-y-2">
            {settled.map((flag) => (
              <li key={flag.head} className={`${row} font-semibold`}>
                <Link href={headScreenPath(claimId, flag.head)} className="font-semibold text-navy-deep underline">
                  {flag.label}
                </Link>
                {flag.occurredAt ? <span className="mt-1 block font-normal text-slate">Logged {formatUkDate(flag.occurredAt)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

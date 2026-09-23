import { formatUkDate } from "@/lib/dates";
import type { HireEndDateReview as Review } from "@/lib/db/hire-collection-date";

function shown(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

export function HireEndDateReview({
  claimId,
  reviews,
  returnTo,
}: {
  claimId: string;
  reviews: Review[];
  returnTo: string;
}) {
  if (reviews.length === 0) return null;
  return (
    <div className="space-y-3">
      {reviews.map((review) => {
        const job = shown(review.jobDate);
        const kept = shown(review.hireEndDay);
        return (
          <div key={review.episodeId} className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
            <p className="font-semibold">Check which day hire should stop.</p>
            <p className="mt-1">
              The Hire car collection job says the hire car was collected on {job}.
              {kept ? ` Hire end on the file is ${kept}.` : ""} Nothing has been overwritten. Choose which date is right. This is a charging
              check for a person, not a legal conclusion. The daily rate is left as it is.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <form method="post" action={`/claims/${claimId}/hire-end-date`}>
                <input type="hidden" name="choice" value="job" />
                <input type="hidden" name="episodeId" value={review.episodeId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="min-h-11 w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
                  Use the date from the collection job
                </button>
              </form>
              <form method="post" action={`/claims/${claimId}/hire-end-date`}>
                <input type="hidden" name="choice" value="file" />
                <input type="hidden" name="episodeId" value={review.episodeId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
                  Keep the date already on the file
                </button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}

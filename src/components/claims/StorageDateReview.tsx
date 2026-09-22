import { formatUkDate } from "@/lib/dates";
import type { StorageDateReview as Review } from "@/lib/db/storage-recovery-date";

function shown(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

export function StorageDateReview({ claimId, review, returnTo }: { claimId: string; review: Review | null; returnTo: string }) {
  if (!review) return null;
  const job = shown(review.jobDate);
  const kept = review.storageDay || review.recoveryDay;
  return (
    <div className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
      <p className="font-semibold">Check which day storage should be charged from.</p>
      <p className="mt-1">
        The Recover client&apos;s vehicle job says the vehicle was recovered on {job}.
        {review.storageDay ? ` Storage start on the file is ${shown(review.storageDay)}.` : ""}
        {review.recoveryDay ? ` The Recovery screen date is ${shown(review.recoveryDay)}.` : ""}
        {" "}Nothing has been overwritten. Choose which date is right. This is a charging check for a person, not a legal conclusion. The daily rate is left as it is.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <form method="post" action={`/claims/${claimId}/storage-date`}>
          <input type="hidden" name="choice" value="job" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="min-h-11 w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
            Use {job} from the recovery job
          </button>
        </form>
        <form method="post" action={`/claims/${claimId}/storage-date`}>
          <input type="hidden" name="choice" value="file" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
            Keep {kept ? shown(kept) : "the date already on the file"}
          </button>
        </form>
      </div>
    </div>
  );
}

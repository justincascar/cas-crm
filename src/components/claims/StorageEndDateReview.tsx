import { formatUkDate } from "@/lib/dates";
import type { StorageEndDateReview as Review } from "@/lib/db/storage-recovery-date";

function shown(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

export function StorageEndDateReview({ claimId, review, returnTo }: { claimId: string; review: Review | null; returnTo: string }) {
  if (!review) return null;
  const job = shown(review.jobDate);
  const kept = shown(review.storageEndDay);
  return (
    <div className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
      <p className="font-semibold">Check which day storage should stop.</p>
      <p className="mt-1">
        The Return client&apos;s vehicle after repair job says the vehicle went back to the client on {job}.
        {kept ? ` Storage end on the file is ${kept}.` : ""} Nothing has been overwritten. Choose which date is right. This is a charging
        check for a person, not a legal conclusion. The daily rate is left as it is.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <form method="post" action={`/claims/${claimId}/storage-end-date`}>
          <input type="hidden" name="choice" value="job" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="min-h-11 w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
            Use {job} from the return job
          </button>
        </form>
        <form method="post" action={`/claims/${claimId}/storage-end-date`}>
          <input type="hidden" name="choice" value="file" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
            Keep {kept || "the date already on the file"}
          </button>
        </form>
      </div>
    </div>
  );
}

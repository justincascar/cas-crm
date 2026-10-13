import { formatUkDate } from "@/lib/dates";
import type { HireGapView } from "@/lib/db/storage-authorisation-end";
import type { StorageAuthorisationEnd as Decision } from "@/lib/domain/storage-authorisation-end";

function shown(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return formatUkDate(value);
}

export function StorageAuthorisationEndPanel({
  claimId,
  decision,
  returnTo,
}: {
  claimId: string;
  decision: Decision;
  returnTo: string;
}) {
  if (decision.kind === "open") return null;
  if (decision.kind === "suggest") {
    const day = shown(decision.date);
    return (
      <div className="rounded-md border border-line bg-white px-4 py-3 text-sm">
        <p className="font-semibold">Proposed storage end: {day}</p>
        <p className="mt-1">
          This is the date repair authorisation was recorded. Storage is charged up to that date only after you confirm it. Nothing has been
          written yet. The vehicle can stay at CAS after charging stops.
        </p>
        <form method="post" action={`/claims/${claimId}/storage-authorisation-end`} className="mt-3">
          <input type="hidden" name="choice" value="suggested" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
            Use this as the storage end date
          </button>
        </form>
      </div>
    );
  }
  if (decision.kind === "conflict") {
    const suggested = shown(decision.suggestedDate);
    const existing = shown(decision.existingDate);
    return (
      <div className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
        <p className="font-semibold">Check which day storage should stop.</p>
        <p className="mt-1">
          Storage end on the file is {existing}. Repair authorisation would suggest {suggested}. The date already on the file has not been
          changed.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <form method="post" action={`/claims/${claimId}/storage-authorisation-end`}>
            <input type="hidden" name="choice" value="suggested" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="min-h-11 w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
              Use the authorisation date
            </button>
          </form>
          <form method="post" action={`/claims/${claimId}/storage-authorisation-end`}>
            <input type="hidden" name="choice" value="keep" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
              Keep the date already on the file
            </button>
          </form>
        </div>
      </div>
    );
  }
  if (decision.kind === "review") {
    return (
      <div className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm">
        <p className="font-semibold">Storage end needs review.</p>
        <ul className="mt-2 list-disc pl-5">
          {decision.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {decision.existingDate ? <p className="mt-2">Date on the file: {shown(decision.existingDate)}.</p> : null}
      </div>
    );
  }
  if (decision.kind === "matches") {
    return <p className="text-sm">Storage end is {shown(decision.date)}, the repair authorisation date.</p>;
  }
  return (
    <p className="text-sm">
      Storage end kept as {shown(decision.date)}. The authorisation date {shown(decision.suggestedDate)} was not used.
    </p>
  );
}

export function HireReturnGapNotice({ gap }: { gap: HireGapView | null }) {
  if (!gap) return null;
  return (
    <div className={gap.gap ? "rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm" : "text-sm"}>
      <p>
        Vehicle returned: {shown(gap.returnedDay)}. Hire car collected: {shown(gap.collectedDay)}.
      </p>
      {gap.gap ? <p className="mt-1 font-semibold">{gap.gap.message}. The hire charge is unchanged.</p> : null}
    </div>
  );
}

export function ChargeableStorageNote({ ended, endDay }: { ended: boolean; endDay: string | null }) {
  if (!ended) return null;
  return (
    <p className="text-sm">
      The vehicle can still be at CAS. Storage is no longer chargeable
      {endDay ? ` — the confirmed end was ${shown(endDay)}` : ""}.
    </p>
  );
}

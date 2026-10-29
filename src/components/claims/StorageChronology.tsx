import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDate, londonTodayIso } from "@/lib/dates";
import { STORAGE_CHRONOLOGY_KINDS, type StorageChronologyEntry } from "@/lib/db/storage-chronology";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** Dated facts about storage. The earliest date the car could have been moved feeds the proposed storage end. */
export function StorageChronology({ claimId, entries, returnTo }: { claimId: string; entries: StorageChronologyEntry[]; returnTo: string }) {
  return (
    <section id="storage-chronology" className="scroll-mt-16 space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Storage chronology" data-storage-chronology>
      <h2 className="font-serif text-xl text-navy-deep">Storage chronology</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="font-semibold">{formatUkDate(entry.occurredOn)}</span> · {entry.label}
              {entry.note ? <span className="text-slate"> – {entry.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-teal-dark underline">Add an entry</summary>
        <form method="post" action={`/claims/${claimId}/movements`} className="mt-3 grid gap-3 sm:grid-cols-2">
          <SubmitKeyInput />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="text-sm">
            What happened
            <select name="kind" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose
              </option>
              {STORAGE_CHRONOLOGY_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Date
            <input name="occurredOn" type="date" required max={londonTodayIso()} defaultValue={londonTodayIso()} className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Note
            <input name="note" className={field} placeholder="Needed for the earliest date the car could have been moved" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
              Add entry
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}

import { SubmitKeyInput } from "@/components/SubmitKeyInput";
import { formatUkDate, londonTodayIso } from "@/lib/dates";
import { MOVEMENT_NECESSITY, type VehicleMovement } from "@/lib/db/vehicle-movements";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** Every movement of the client's car, each its own record, and a form to add one. */
export function VehicleMovements({ claimId, movements, returnTo }: { claimId: string; movements: VehicleMovement[]; returnTo: string }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Car movements" data-vehicle-movements>
      <h2 className="font-serif text-xl text-navy-deep">Car movements</h2>
      {movements.length === 0 ? (
        <p className="text-sm text-slate">No movements recorded yet. Recording the recovery adds the first one.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {movements.map((move) => (
            <li key={move.id} className="rounded-md border border-line px-3 py-2">
              <span className="font-semibold">{formatUkDate(move.movedOn)}</span> · {move.from} → {move.to}
              <span className="block text-slate">
                {move.purpose} · {move.necessityLabel}
              </span>
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-teal-dark underline">Record a movement</summary>
        <form method="post" action={`/claims/${claimId}/movements`} className="mt-3 grid gap-3 sm:grid-cols-2">
          <SubmitKeyInput />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="text-sm">
            Date
            <input name="movedOn" type="date" required max={londonTodayIso()} defaultValue={londonTodayIso()} className={field} />
          </label>
          <label className="text-sm">
            Required by the accident, or for convenience?
            <select name="necessity" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose
              </option>
              {MOVEMENT_NECESSITY.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            From
            <input name="from" required className={field} />
          </label>
          <label className="text-sm">
            To
            <input name="to" required className={field} />
          </label>
          <label className="text-sm sm:col-span-2">
            Purpose
            <input name="purpose" required className={field} placeholder="For example, to the repairer for inspection" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
              Record movement
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}

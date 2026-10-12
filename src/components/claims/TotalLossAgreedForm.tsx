import { formatGbp } from "@/lib/money";
import { getTotalLossReport } from "@/lib/db/total-loss";
import { totalLossSuggestion } from "@/lib/domain/total-loss";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** The same total-loss agreed actions as the file panel, without saving the engineer's figures again. */
export function TotalLossAgreedForm({ claimId, returnTo }: { claimId: string; returnTo: string }) {
  const report = getTotalLossReport(claimId);
  const suggestion = totalLossSuggestion(report);

  return (
    <div className="mt-4 space-y-3">
      {suggestion.kind === "suggestion" ? (
        <form method="post" action={`/claims/${claimId}/total-loss`} className="rounded-md border border-line bg-white px-4 py-3 text-sm">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="intent" value="confirm_suggestion" />
          <p className="font-semibold">Suggested insurer payment: {formatGbp(suggestion.pence)}</p>
          <p className="mt-1">
            Pre-accident value minus the engineer&apos;s salvage value. This is a suggestion only. It is not the agreed amount, and it is not
            marked paid, until you press the button.
          </p>
          {suggestion.pence >= 0 ? (
            <button className="mt-3 min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
              Use this suggestion as the agreed amount
            </button>
          ) : (
            <p className="mt-2">Salvage value is higher than the pre-accident value. The suggestion has not been applied. Check the engineer&apos;s figures.</p>
          )}
        </form>
      ) : null}
      <form method="post" action={`/claims/${claimId}/total-loss`} className="rounded-md border border-line bg-white px-4 py-3 text-sm">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="intent" value="confirm_agreed" />
        <label className="block">
          A different agreed amount (£)
          <input name="agreed" inputMode="decimal" className={field} placeholder="Leave blank unless you are confirming a different figure" />
        </label>
        <button className="mt-3 min-h-11 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold" type="submit">
          Save this as the agreed amount
        </button>
      </form>
    </div>
  );
}

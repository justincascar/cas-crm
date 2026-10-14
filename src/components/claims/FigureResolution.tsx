import { STORED_FIGURE_DIFFERS } from "@/lib/domain/figure-resolution";
import { formatGbp } from "@/lib/money";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

export function FigureResolution({
  claimId,
  head,
  differs,
  keptLabel,
  storedPence,
  calculatedPence,
}: {
  claimId: string;
  head: "hire" | "storage" | "recovery";
  differs: boolean;
  keptLabel: string | null;
  storedPence: number;
  calculatedPence: number | null;
}) {
  if (keptLabel) {
    return <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{keptLabel}</p>;
  }
  if (!differs || calculatedPence == null) return null;
  const action = `/claims/${claimId}/figure`;
  return (
    <div className="space-y-3 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3 text-sm">
      <p>
        {STORED_FIGURE_DIFFERS}. Stored claimed {formatGbp(storedPence)}. Calculation {formatGbp(calculatedPence)}. The stored claimed
        figure has not been replaced. Agreed and received are not changed by either choice.
      </p>
      <form method="post" action={action}>
        <input type="hidden" name="head" value={head} />
        <input type="hidden" name="intent" value="use_calculated" />
        <button className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
          Use calculated figure
        </button>
      </form>
      <form method="post" action={action} className="grid gap-2">
        <input type="hidden" name="head" value={head} />
        <input type="hidden" name="intent" value="keep_stored" />
        <label className="block text-sm">
          Reason for keeping the stored figure
          <input name="reason" required className={field} />
        </label>
        <button className="w-fit rounded-md border border-navy bg-white px-3 py-2 text-sm font-semibold text-navy" type="submit">
          Keep stored figure
        </button>
      </form>
    </div>
  );
}

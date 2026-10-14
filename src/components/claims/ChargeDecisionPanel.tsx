import type { ChargeDecision } from "@/lib/db/charge-decision";
import { formatGbp } from "@/lib/money";

const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function decisionLabel(decision: ChargeDecision["decision"]): string {
  if (decision === "accepted") return "Accept";
  if (decision === "disputed") return "Dispute";
  if (decision === "proposed") return "Awaiting decision";
  return "Awaiting decision";
}

export function ChargeDecisionPanel({
  claimId,
  head,
  decision,
  canApproveSettlement,
}: {
  claimId: string;
  head: "hire" | "storage" | "recovery";
  decision: ChargeDecision;
  canApproveSettlement: boolean;
}) {
  const action = `/claims/${claimId}/charge-decision`;
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="Charge decision">
      <h2 className="font-serif text-xl text-navy-deep">Decision</h2>
      <p className="text-sm">
        {decisionLabel(decision.decision)}
        {decision.decision === "disputed" && decision.reason ? `: ${decision.reason}` : ""}
      </p>
      {decision.decision === "proposed" && decision.agreedPence != null ? (
        <p className="text-sm">
          A proposed acceptance of {formatGbp(decision.agreedPence)} is waiting for approval. The agreed figure has not been changed.
        </p>
      ) : (
        <p className="text-sm text-slate">
          Accept records the agreed figure. Dispute leaves the charge open and does not close hire or storage. Another charge is not changed.
        </p>
      )}
      <form method="post" action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="head" value={head} />
        <input type="hidden" name="intent" value={canApproveSettlement ? "accept" : "propose"} />
        <label className="block text-sm">
          Agreed figure (£)
          <input name="agreed" inputMode="decimal" required className={field} />
          <span className="mt-1 block text-slate">
            {canApproveSettlement
              ? "A figure below the claimed figure is a reduced settlement. Recording it needs your approveSettlement permission."
              : "A figure below the claimed figure waits for approval. The agreed figure is not saved until it is approved."}
          </span>
        </label>
        <div className="self-end">
          <button className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white" type="submit">
            {canApproveSettlement ? "Accept" : "Propose acceptance"}
          </button>
        </div>
      </form>
      <form method="post" action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="head" value={head} />
        <input type="hidden" name="intent" value="dispute" />
        <label className="block text-sm">
          Dispute reason
          <select name="preset" className={field} defaultValue="">
            <option value="">Choose rate, period or need, or write your own reason</option>
            <option value="rate">Rate</option>
            <option value="period">Period</option>
            <option value="need">Need</option>
          </select>
        </label>
        <label className="block text-sm">
          Your own words
          <input name="reason" className={field} />
        </label>
        <div>
          <button className="rounded-md border border-navy bg-white px-3 py-2 text-sm font-semibold text-navy" type="submit">
            Dispute
          </button>
        </div>
      </form>
    </section>
  );
}

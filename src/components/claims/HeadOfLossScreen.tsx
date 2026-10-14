import type { ReactNode } from "react";
import { formatUkDateTime } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import type { HeadSectionModel } from "@/lib/db/head-screen";
import { HeadDecisionForm } from "@/components/claims/HeadDecisionForm";

function moneyOrUnset(pence: number | null): string {
  return pence == null ? "Not set" : formatGbp(pence);
}

export function HeadOfLossScreen({
  claimId,
  section,
  canAccept,
  actions,
  claimedNote,
}: {
  claimId: string;
  section: HeadSectionModel;
  canAccept: boolean;
  actions?: ReactNode;
  claimedNote?: string | null;
}) {
  return (
    <section className="rounded-xl border border-line bg-card p-5" aria-label={section.title}>
      <h2 className="font-serif text-xl text-navy-deep">{section.title}</h2>
      <p className="mt-1 text-sm">
        Status: <strong>{section.statusLabel}</strong>
      </p>

      {section.afterSettlement ? (
        <p className="mt-3 rounded-md border border-warn/40 bg-[#fff6e8] px-3 py-2 text-sm">{section.afterSettlement.label}</p>
      ) : null}

      {section.empty ? (
        <p className="mt-4 text-sm">Nothing recorded yet.</p>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate">Claimed</dt>
            <dd className="font-semibold tabular">
              {formatGbp(section.claimedPence)}
              {claimedNote ? <span className="mt-1 block text-sm font-normal text-slate">{claimedNote}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate">{section.agreedCaption}</dt>
            <dd className="font-semibold tabular">{moneyOrUnset(section.agreedPence)}</dd>
          </div>
          {section.preAccidentValuePence != null ? (
            <div>
              <dt className="text-sm text-slate">Agreed pre-accident value</dt>
              <dd className="font-semibold tabular">{formatGbp(section.preAccidentValuePence)}</dd>
            </div>
          ) : null}
          {section.salvageProceedsPence != null ? (
            <div>
              <dt className="text-sm text-slate">Salvage proceeds already recorded</dt>
              <dd className="font-semibold tabular">{formatGbp(section.salvageProceedsPence)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-sm text-slate">Received</dt>
            <dd className="font-semibold tabular">{formatGbp(section.receivedPence)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate">Outstanding</dt>
            <dd className="font-semibold tabular">{moneyOrUnset(section.outstandingPence)}</dd>
          </div>
          {section.insurerReason ? (
            <div>
              <dt className="text-sm text-slate">Insurer&apos;s stated reason</dt>
              <dd>{section.insurerReason}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {actions}

      {section.review ? (
        <HeadDecisionForm claimId={claimId} review={section.review} canAccept={canAccept} />
      ) : null}

      <h3 className="mt-6 font-serif text-lg text-navy-deep">History</h3>
      {section.history.length === 0 ? (
        <p className="mt-2 text-sm text-slate">No payments, decisions or chase activity on this head yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {section.history.map((entry, index) => (
            <li key={`${entry.at}-${entry.title}-${index}`} className="border-t border-line pt-3 text-sm">
              <p className="text-xs text-slate">
                {formatUkDateTime(entry.at)}
                {entry.actorName ? ` · ${entry.actorName}` : ""}
              </p>
              <p className="font-semibold">{entry.title}</p>
              {entry.detail ? <p className="mt-1">{entry.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

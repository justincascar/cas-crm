import { formatUkDateTime } from "@/lib/dates";
import {
  justificationChronology,
  justificationRepairGaps,
  type JustificationSourceEvent,
} from "@/lib/domain/justification-chronology";
import {
  explainedGapWording,
  gapFlagWording,
  type RepairProgressGap,
} from "@/lib/domain/repair-progress";

export function JustificationChronology({
  events,
  totalLoss = false,
  creditHire = false,
  claimId,
  progressGaps = [],
  stepError,
  stepSaved,
}: {
  events: JustificationSourceEvent[];
  totalLoss?: boolean;
  /** A credit-hire file: the hire and its agreements are on the chronology (R33). */
  creditHire?: boolean;
  claimId?: string;
  progressGaps?: RepairProgressGap[];
  stepError?: string;
  stepSaved?: string;
}) {
  const lines = justificationChronology(events, { totalLoss, creditHire });
  const gaps = justificationRepairGaps(events, { totalLoss });
  const unexplained = progressGaps.filter((gap) => !gap.explained);
  const explained = progressGaps.filter((gap) => gap.explained);
  return (
    <section id="hire-repair-chronology" className="space-y-3 rounded-xl border border-line bg-card p-5">
      <div>
        <h2 className="font-serif text-2xl text-navy-deep">Hire and repair chronology</h2>
        <p className="text-sm text-slate">
          Dated steps already on this file. A letter that was only generated is marked Generated only. If this vehicle
          is going through repair and a repair step is not on the file, that is stated underneath, without a date. A
          gap of 7 days or more between two steps in date order is flagged until someone explains that pair. If nothing
          has been recorded since the last step for that long, that is flagged too. A chaser does not reset the gap.
          This list is taken from the file history and does not change it.
        </p>
      </div>
      {stepError ? <p className="rounded-md border border-overdue/40 bg-[#f8ecec] px-4 py-3 text-sm text-overdue">{stepError}</p> : null}
      {stepSaved === "gap" ? (
        <p className="rounded-md border border-ok/40 bg-[#eef6ee] px-4 py-3 text-sm text-ok">Explanation saved.</p>
      ) : null}
      {lines.length === 0 && gaps.length === 0 && progressGaps.length === 0 ? (
        <p className="text-sm text-slate">No steps of this kind are on the file yet.</p>
      ) : null}
      {lines.length > 0 ? (
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {lines.map((line) => (
            <li key={line.id}>
              <p className="text-xs text-slate">{formatUkDateTime(line.occurredAt)}</p>
              <p className="text-sm">
                <strong>{line.title}</strong>
                {line.dispatch === "generated" ? (
                  <span className="ml-2 rounded border border-warn/40 bg-[#fff6e8] px-1.5 py-0.5 text-xs text-warn">
                    Generated only
                  </span>
                ) : null}
                {line.dispatch === "sent" ? (
                  <span className="ml-2 rounded border border-ok/40 bg-[#eef6ef] px-1.5 py-0.5 text-xs text-ok">
                    Sent
                  </span>
                ) : null}
              </p>
              {line.details ? <p className="text-sm text-slate">{line.details}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {progressGaps.length > 0 ? (
        <div className="space-y-3">
          {explained.map((gap) => (
            <p key={`${gap.fromEventId}-${gap.toEventId}-${gap.historical ? "note" : "explained"}`} className="text-sm text-navy-deep">
              {gap.kind === "since"
                ? `No progress since ${gap.fromLabel} on ${gap.stepOn} explained on ${gap.explainedOn}: ${gap.note || ""}`
                : explainedGapWording(gap)}
            </p>
          ))}
          {unexplained.map((gap) => (
            <form
              key={`${gap.fromEventId}-${gap.toEventId}-${gap.still ? "still" : "open"}`}
              method="post"
              action={claimId ? `/claims/${claimId}/repair-gap` : undefined}
              className="space-y-2 rounded-md border border-warn/40 bg-[#fff6e8] px-4 py-3"
            >
              <p className="text-sm font-semibold text-navy-deep">{gapFlagWording(gap)}</p>
              {claimId ? (
                <>
                  <input type="hidden" name="fromEventId" value={gap.fromEventId} />
                  <input type="hidden" name="toEventId" value={gap.toEventId} />
                  <label className="block text-sm">
                    Explanation
                    <input
                      name="note"
                      required
                      className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                      placeholder="For example, awaiting parts"
                    />
                  </label>
                  <button type="submit" className="min-h-11 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
                    Save explanation
                  </button>
                </>
              ) : null}
            </form>
          ))}
        </div>
      ) : null}
      {gaps.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-navy-deep">Not recorded</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate">
            {gaps.map((gap) => (
              <li key={gap.eventType}>{gap.label} is not recorded.</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

import { formatUkDateTime } from "@/lib/dates";
import {
  justificationChronology,
  justificationRepairGaps,
  type JustificationSourceEvent,
} from "@/lib/domain/justification-chronology";

export function JustificationChronology({
  events,
  totalLoss = false,
}: {
  events: JustificationSourceEvent[];
  totalLoss?: boolean;
}) {
  const lines = justificationChronology(events, { totalLoss });
  const gaps = justificationRepairGaps(events, { totalLoss });
  return (
    <section id="hire-repair-chronology" className="space-y-3 rounded-xl border border-line bg-card p-5">
      <div>
        <h2 className="font-serif text-2xl text-navy-deep">Hire and repair chronology</h2>
        <p className="text-sm text-slate">
          Dated steps already on this file. A letter that was only generated is marked Generated only. If this vehicle
          is going through repair and a repair step is not on the file, that is stated underneath, without a date. This
          list is taken from the file history and does not change it.
        </p>
      </div>
      {lines.length === 0 && gaps.length === 0 ? (
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

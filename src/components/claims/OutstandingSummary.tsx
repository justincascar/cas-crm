import { chaseStageRowClass } from "@/lib/domain/chase";
import { NOTHING_OUTSTANDING, type OutstandingItem } from "@/lib/domain/outstanding";

function rowClass(item: OutstandingItem): string {
  if (item.band === "plain" || item.band === "task_today") return "";
  if (item.band === "chase_amber") return chaseStageRowClass("amber");
  return chaseStageRowClass("red");
}

export function OutstandingSummary({ items }: { items: OutstandingItem[] }) {
  return (
    <section className="rounded-xl border-2 border-navy bg-card p-5" aria-label="Outstanding">
      <h2 className="font-serif text-xl text-navy-deep">Outstanding</h2>
      <p className="mt-1 text-sm text-slate">
        What needs a person on this file. A reminder still inside its usual interval is not listed. This is separate from the handler&apos;s note in Claim facts.
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate">{NOTHING_OUTSTANDING}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className={`rounded-md px-3 py-2 text-sm ${rowClass(item)}`}>
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

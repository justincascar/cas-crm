import Link from "next/link";
import type { ClaimSummaryFlag } from "@/lib/claims/claim-summary";

function problemText(label: string): string {
  return label.replace(/^Overdue task:\s*/i, "Task: ").replace(/^Overdue:\s*/i, "");
}

export function ClaimProblems({ flags }: { flags: ClaimSummaryFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <section aria-label="Problems needing attention" className="rounded-xl border border-line bg-card px-4 py-3" data-claim-problems>
      <h2 className="font-serif text-xl text-navy-deep">Problems needing attention</h2>
      <p className="text-sm text-slate">
        {flags.length} open {flags.length === 1 ? "flag" : "flags"}
      </p>
      <ul className="mt-2 space-y-2">
        {flags.map((flag) => (
          <li key={flag.id} id={`flag-${flag.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{problemText(flag.label)}</span>
            <Link href={flag.href} className="rounded-md bg-navy px-3 py-1 text-sm font-semibold text-white no-underline">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

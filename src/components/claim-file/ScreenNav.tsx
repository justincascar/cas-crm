"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { screensByGroup } from "@/lib/claim-screens";

const DOT: Record<string, string> = {
  comms: "bg-teal",
  case: "bg-[#3d5a99]",
  hire: "bg-[#c0392b]",
  works: "bg-[#2e8b3a]",
  recovery: "bg-[#d35400]",
  money: "bg-[#5dade2]",
};

export function ScreenNav({
  claimId,
  savedKeys,
}: {
  claimId: string;
  savedKeys: string[];
}) {
  const path = usePathname();
  const saved = new Set(savedKeys);
  const groups = screensByGroup();

  return (
    <aside className="rounded-xl border border-line bg-card p-4 xl:sticky xl:top-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate">Viewing pane</p>
      <p className="mt-1 font-serif text-lg text-navy-deep">File screens</p>
      <nav className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">{group.label}</p>
            <ul className="space-y-0.5">
              {group.screens.map((screen) => {
                const href = `/claims/${claimId}/work/${screen.key}`;
                const active = path === href;
                return (
                  <li key={screen.key}>
                    <Link
                      href={href}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
                        active ? "bg-[#e8f4f2] font-semibold text-teal-dark" : "text-ink hover:bg-paper"
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[group.key]}`} />
                      <span className="min-w-0 flex-1 leading-snug">{screen.label}</span>
                      {saved.has(screen.key) ? <span className="text-[10px] text-ok">saved</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

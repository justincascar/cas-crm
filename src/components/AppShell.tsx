"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/claims", label: "Claims" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hire", label: "Hire / Fleet" },
  { href: "/documents", label: "Documents" },
  { href: "/communications", label: "Communications" },
  { href: "/financials", label: "Financials" },
  { href: "/automations", label: "Automations" },
  { href: "/litigation", label: "Litigation" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-navy-deep text-[#e8efe9]">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="font-serif text-xl tracking-tight text-white">CAS</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/55">
            Complete Accident Solutions
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 py-3 lg:block lg:space-y-0.5">
          {NAV.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                  active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden px-5 py-6 text-xs leading-relaxed text-white/45 lg:block">
          Prototype — fictional test data.
          <br />
          Simulated lookups. No live sending.
        </div>
      </aside>
      <div className="min-w-0">
        <div className="border-b border-copper/30 bg-[#efe4d2] px-4 py-2 text-center text-sm text-ink">
          <strong>Prototype — fictional test data.</strong> Lookups, email and WhatsApp are simulated.
          Do not send real correspondence from this system.
        </div>
        <main className="px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

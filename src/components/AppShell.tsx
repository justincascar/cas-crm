"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { actionLogout } from "@/app/auth-actions";

const NAV = [
  { href: "/jobs", label: "My jobs today" },
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

export function AppShell({
  children,
  staffName,
  staffUsername,
  office = true,
}: {
  children: React.ReactNode;
  staffName: string;
  staffUsername: string;
  office?: boolean;
}) {
  const path = usePathname();
  if (path === "/login") {
    return children;
  }
  const nav = office ? NAV : [{ href: "/jobs", label: "My jobs today" }];

  return (
    <div className="app-shell min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen overflow-y-auto bg-navy-deep text-[#e8efe9] md:block">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="font-serif text-xl tracking-tight text-white">CAS</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/55">
            Complete Accident Solutions
          </p>
        </div>
        <nav className="px-2 py-3 space-y-0.5">
          {nav.map((item) => {
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
        <div className="px-5 py-6 text-xs leading-relaxed text-white/45">
          Prototype — fictional test data.
          <br />
          Simulated lookups. No live sending.
        </div>
      </aside>
      <div className="min-w-0">
        <details className="border-b border-white/10 bg-navy-deep text-[#e8efe9] print:hidden md:hidden">
          <summary className="cursor-pointer px-4 py-3 text-base font-semibold text-white">Menu</summary>
          <nav className="space-y-0.5 px-2 pb-3">
            {nav.map((item) => {
              const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-md px-3 py-3 text-base ${
                    active ? "bg-white/12 text-white" : "text-white/80"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-copper/30 bg-[#efe4d2] px-4 py-2 text-sm text-ink print:hidden">
          <p>
            <strong>Prototype — fictional test data.</strong> Lookups, email and WhatsApp are simulated.
            Do not send real correspondence from this system.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Logged in as <strong>{staffName}</strong>
              <span className="text-slate"> ({staffUsername})</span>
            </span>
            <form action={actionLogout}>
              <button type="submit" className="min-h-11 rounded-md border border-navy px-3 py-2 text-sm font-semibold text-navy">
                Log out
              </button>
            </form>
          </div>
        </div>
        <main className="px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

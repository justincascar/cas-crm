"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { FormKeeper } from "@/components/FormKeeper";
import { actionLogout } from "@/app/auth-actions";

const NAV = [
  { href: "/jobs", label: "My jobs today" },
  { href: "/", label: "Dashboard" },
  { href: "/enquiries", label: "Website enquiries" },
  { href: "/claims", label: "Claims" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hire", label: "Hire / Fleet" },
  { href: "/driver-jobs", label: "Driver jobs" },
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
  emailMode,
  emailBannerText,
}: {
  children: React.ReactNode;
  staffName: string;
  staffUsername: string;
  office?: boolean;
  emailMode: "simulate" | "live";
  emailBannerText: string;
}) {
  const path = usePathname();
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/sign/") || path.startsWith("/c/") || path === "/privacy") {
    return children;
  }
  const nav = office ? NAV : [{ href: "/jobs", label: "My jobs today" }];

  return (
    <div className="app-shell min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen overflow-y-auto bg-navy-deep text-[#e8efe9] md:block">
        <div className="border-b border-white/10 px-4 py-4" data-brand>
          {/* R41: CAS's own logo, from the supplied headed paper. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/headed-paper/cas-logo.jpg" alt="Complete Accident Solutions" className="block h-auto w-full rounded-md bg-white px-2 py-1.5" />
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
          Simulated lookups.{" "}
          <span className={emailMode === "live" ? "font-semibold text-white" : undefined}>{emailBannerText}</span>
        </div>
      </aside>
      <div className="min-w-0">
        <details className="border-b border-white/10 bg-navy-deep text-[#e8efe9] print:hidden md:hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-base font-semibold text-white">
            <span>Menu</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/headed-paper/cas-logo.jpg" alt="Complete Accident Solutions" className="h-7 w-auto rounded bg-white px-1.5 py-0.5" />
          </summary>
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
        <div
          className={
            emailMode === "live"
              ? "flex flex-wrap items-center justify-between gap-2 border-b-4 border-[#3d0a0a] bg-overdue px-4 py-3 text-base font-bold text-white print:hidden"
              : "flex flex-wrap items-center justify-between gap-2 border-b-4 border-navy bg-[#d9e4ef] px-4 py-3 text-base font-bold text-navy-deep print:hidden"
          }
        >
          <p>
            {emailBannerText}
            {emailMode === "simulate" ? (
              <span className="mt-1 block text-sm font-semibold">Prototype — fictional test data. WhatsApp and telephone are not connected.</span>
            ) : (
              <span className="mt-1 block text-sm font-semibold">A click on Send will leave claims@cascar.co.uk.</span>
            )}
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
        <main className="px-4 py-6 sm:px-8">
          {/* R59: what was typed comes back when a form is sent with a mistake. */}
          <Suspense fallback={null}>
            <FormKeeper />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

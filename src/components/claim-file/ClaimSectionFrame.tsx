"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ScreenNav } from "@/components/claim-file/ScreenNav";
import { claimTabFromPath, claimTabHref, type ClaimTabKey } from "@/lib/domain/claim-tabs";

const TAB_LABELS: Record<ClaimTabKey, string> = {
  steps: "Steps",
  details: "Details",
  hire: "Hire",
  money: "Money",
  documents: "Documents",
  messages: "Messages",
  history: "History",
};

export function ClaimSectionFrame({
  claimId,
  savedKeys,
  children,
}: {
  claimId: string;
  savedKeys: string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = claimTabFromPath(pathname, claimId);
  const showScreenNav = current === "details";
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center rounded-md px-2.5 py-2 text-sm font-semibold ${
      active ? "bg-navy text-white" : "border border-line bg-white text-navy"
    }`;

  return (
    <>
      <nav aria-label="Claim sections" className="flex max-w-full flex-wrap gap-1.5 rounded-xl border border-line bg-card px-3 py-3 print:hidden">
        {(Object.keys(TAB_LABELS) as ClaimTabKey[]).map((tab) => {
          const active = tab === current;
          return (
            <Link key={tab} href={claimTabHref(claimId, tab)} className={tabClass(active)} aria-current={active ? "page" : undefined}>
              {TAB_LABELS[tab]}
            </Link>
          );
        })}
      </nav>
      <div className={showScreenNav ? "grid min-w-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]" : "min-w-0"}>
        {showScreenNav ? <ScreenNav claimId={claimId} savedKeys={savedKeys} /> : null}
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}

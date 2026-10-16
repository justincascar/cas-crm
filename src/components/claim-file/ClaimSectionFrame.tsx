"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ScreenNav } from "@/components/claim-file/ScreenNav";

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
  const claimPath = `/claims/${claimId}`;
  const onOverview = pathname === claimPath;
  const onHandover = pathname.endsWith("/handover");
  const onDocuments = pathname === `${claimPath}/documents` || pathname.startsWith(`${claimPath}/documents/`);
  const onVehicles = pathname === `${claimPath}/vehicles` || pathname.startsWith(`${claimPath}/vehicles/`);
  const onFinancial = pathname === `${claimPath}/financial` || pathname.startsWith(`${claimPath}/financial/`);
  const onPrehire = pathname === `${claimPath}/prehire` || pathname.startsWith(`${claimPath}/prehire/`);
  const onComms = pathname.startsWith(`${claimPath}/work/comms`);
  const onFileScreens = pathname.startsWith(`${claimPath}/work/`) && !onComms;
  const showScreenNav = onFileScreens;
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold ${
      active ? "bg-navy text-white" : "border border-line bg-white text-navy"
    }`;
  const tabs = [
    { href: claimPath, label: "Overview", active: onOverview },
    { href: `${claimPath}/work/comms`, label: "Email / WhatsApp / Calls", active: onComms },
    { href: `${claimPath}/work/general`, label: "File screens", active: onFileScreens },
    { href: `${claimPath}/handover`, label: "Handover", active: onHandover },
    { href: `${claimPath}/documents`, label: "Documents", active: onDocuments },
    { href: `${claimPath}/vehicles`, label: "Vehicles", active: onVehicles },
    { href: `${claimPath}/repair`, label: "Repair evidence", active: pathname.startsWith(`${claimPath}/repair`) },
    { href: `${claimPath}/hire-pack`, label: "Hire Pack", active: pathname.startsWith(`${claimPath}/hire-pack`) },
    { href: `${claimPath}/prehire`, label: "Pre-hire checks", active: onPrehire },
    { href: `${claimPath}/financial`, label: "Financial circumstances", active: onFinancial },
    { href: `${claimPath}/heads/recovery`, label: "Recovery", active: pathname.startsWith(`${claimPath}/heads/recovery`) },
    { href: `${claimPath}/heads/storage`, label: "Storage", active: pathname.startsWith(`${claimPath}/heads/storage`) },
    { href: `${claimPath}/heads/hire`, label: "Hire", active: pathname === `${claimPath}/heads/hire` || pathname.startsWith(`${claimPath}/heads/hire/`) },
    { href: `${claimPath}/heads/vehicle`, label: "Vehicle damage", active: pathname.startsWith(`${claimPath}/heads/vehicle`) },
  ];

  return (
    <>
      <nav aria-label="Claim sections" className="flex max-w-full flex-wrap gap-2 rounded-xl border border-line bg-card px-4 py-3">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className={tabClass(tab.active)} aria-current={tab.active ? "page" : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className={showScreenNav ? "grid min-w-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]" : "min-w-0"}>
        {showScreenNav ? <ScreenNav claimId={claimId} savedKeys={savedKeys} /> : null}
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}

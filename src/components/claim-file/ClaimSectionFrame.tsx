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
  const hideScreenNav = onOverview || onHandover || onDocuments || onVehicles || onFinancial;
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold ${
      active ? "bg-navy text-white" : "border border-line bg-white text-navy"
    }`;

  return (
    <>
      <nav aria-label="Claim sections" className="flex flex-wrap gap-2 rounded-xl border border-line bg-card px-4 py-3">
        <Link href={claimPath} className={tabClass(onOverview)}>
          Overview
        </Link>
        <Link href={`${claimPath}/work/comms`} className={tabClass(pathname.startsWith(`${claimPath}/work/comms`))}>
          Email / WhatsApp / Calls
        </Link>
        <Link
          href={`${claimPath}/work/general`}
          className={tabClass(pathname.startsWith(`${claimPath}/work/`) && !pathname.startsWith(`${claimPath}/work/comms`))}
        >
          File screens
        </Link>
        <Link href={`${claimPath}/handover`} className={tabClass(onHandover)}>
          Handover
        </Link>
        <Link href={`${claimPath}/documents`} className={tabClass(onDocuments)}>
          Documents
        </Link>
        <Link href={`${claimPath}/vehicles`} className={tabClass(onVehicles)}>
          Vehicles
        </Link>
        <Link href={`${claimPath}/repair`} className={tabClass(pathname.startsWith(`${claimPath}/repair`))}>
          Repair evidence
        </Link>
        <Link href={`${claimPath}/hire-pack`} className={tabClass(pathname.startsWith(`${claimPath}/hire-pack`))}>
          Hire Pack
        </Link>
        <Link href={`${claimPath}/financial`} className={tabClass(onFinancial)}>
          Financial circumstances
        </Link>
      </nav>
      <div className={hideScreenNav ? "" : "grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]"}>
        {hideScreenNav ? null : <ScreenNav claimId={claimId} savedKeys={savedKeys} />}
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}

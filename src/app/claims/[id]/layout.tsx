import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ScreenNav } from "@/components/claim-file/ScreenNav";
import { ClaimWorkflowStatusSummary } from "@/components/ClaimWorkflowStatus";
import { isOfficeRole, pathAllowedForRole } from "@/lib/auth/roles";
import { requireSignedIn } from "@/lib/auth/session";
import { getClaim } from "@/lib/db/queries";
import { listScreenSummaries } from "@/lib/db/screens";

export default async function ClaimLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const staffUser = await requireSignedIn();
  const { id } = await params;
  const pathname = (await headers()).get("x-cas-pathname") || "";
  if (pathname && !pathAllowedForRole(staffUser.role, pathname)) redirect("/jobs");
  const claimPath = `/claims/${id}`;
  const onHandover = pathname.endsWith("/handover");
  const onDocuments = pathname === `${claimPath}/documents` || pathname.startsWith(`${claimPath}/documents/`);
  const onVehicles = pathname === `${claimPath}/vehicles` || pathname.startsWith(`${claimPath}/vehicles/`);
  const office = isOfficeRole(staffUser.role);
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold ${
      active ? "bg-navy text-white" : "border border-line bg-white text-navy"
    }`;
  const data = getClaim(id);
  if (!data) notFound();
  const saved = listScreenSummaries(String(data.claim.id)).map((r) => r.screen_key);

  if (!office) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <Link href="/jobs" className="text-teal-dark underline">
            My jobs today
          </Link>
        </p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-card px-4 py-3">
        <div>
          <p className="font-mono text-sm text-teal-dark">{String(data.claim.file_reference)}</p>
          <p className="text-sm text-slate">
            {String(data.claim.client_name || "Unknown client")} · {String(data.claim.current_position)}
          </p>
          <ClaimWorkflowStatusSummary
            liabilityStatus={String(data.claim.claim_type || "")}
            roadworthiness={String(data.claim.roadworthiness || "")}
          />
        </div>
      </div>
      <nav aria-label="Claim sections" className="flex flex-wrap gap-2 rounded-xl border border-line bg-card px-4 py-3">
        <Link href={claimPath} className={tabClass(pathname === claimPath)}>
          Overview
        </Link>
        <Link href={`${claimPath}/work/comms`} className={tabClass(pathname.startsWith(`${claimPath}/work/comms`))}>
          Email / WhatsApp / Calls
        </Link>
        <Link href={`${claimPath}/work/general`} className={tabClass(pathname.startsWith(`${claimPath}/work/`) && !pathname.startsWith(`${claimPath}/work/comms`))}>
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
      </nav>
      <div className={onHandover || onDocuments || onVehicles ? "" : "grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]"}>
        {onHandover || onDocuments || onVehicles ? null : <ScreenNav claimId={String(data.claim.id)} savedKeys={saved} />}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

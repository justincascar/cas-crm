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
  const onHandover = pathname.endsWith("/handover");
  const office = isOfficeRole(staffUser.role);
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
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
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/claims/${data.claim.id}`} className="text-teal-dark underline">
            Overview
          </Link>
          <Link href={`/claims/${data.claim.id}/work/comms`} className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white">
            Email / WhatsApp / Calls
          </Link>
          <Link href={`/claims/${data.claim.id}/work/general`} className="text-teal-dark underline">
            File screens
          </Link>
          <Link href={`/claims/${data.claim.id}/handover`} className="min-h-11 rounded-md bg-navy px-3 py-2 font-semibold text-white">
            Handover
          </Link>
          <Link href={`/claims/${data.claim.id}/repair`} className="text-teal-dark underline">
            Repair evidence
          </Link>
          <Link href={`/claims/${data.claim.id}/hire-pack`} className="rounded-md bg-teal px-3 py-1.5 font-semibold text-white">
            Hire Pack
          </Link>
        </div>
      </div>
      <div className={onHandover ? "" : "grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]"}>
        {onHandover ? null : <ScreenNav claimId={String(data.claim.id)} savedKeys={saved} />}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

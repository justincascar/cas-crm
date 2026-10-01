import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClaimSectionFrame } from "@/components/claim-file/ClaimSectionFrame";
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
      <ClaimSectionFrame claimId={String(data.claim.id)} savedKeys={saved}>
        {children}
      </ClaimSectionFrame>
    </div>
  );
}

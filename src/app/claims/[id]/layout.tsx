import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClaimSectionFrame } from "@/components/claim-file/ClaimSectionFrame";
import { ClaimSummary } from "@/components/claims/ClaimSummary";
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
    <div className="claim-page min-w-0 space-y-4">
      <p className="text-sm print:hidden">
        <Link href="/claims" className="text-teal-dark underline">
          ← All claims
        </Link>
      </p>
      <ClaimSummary claimId={String(data.claim.id)} />
      <ClaimSectionFrame claimId={String(data.claim.id)} savedKeys={saved}>
        {children}
      </ClaimSectionFrame>
    </div>
  );
}

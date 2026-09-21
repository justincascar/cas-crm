import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenNav } from "@/components/claim-file/ScreenNav";
import { ClaimWorkflowStatusSummary } from "@/components/ClaimWorkflowStatus";
import { requireStaff } from "@/lib/auth/session";
import { getClaim } from "@/lib/db/queries";
import { listScreenSummaries } from "@/lib/db/screens";

export default async function ClaimLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const data = getClaim(id);
  if (!data) notFound();
  const saved = listScreenSummaries(String(data.claim.id)).map((r) => r.screen_key);

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
          <Link href={`/claims/${data.claim.id}/handover`} className="text-teal-dark underline">
            Handover
          </Link>
          <Link href={`/claims/${data.claim.id}/hire-pack`} className="rounded-md bg-teal px-3 py-1.5 font-semibold text-white">
            Hire Pack
          </Link>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ScreenNav claimId={String(data.claim.id)} savedKeys={saved} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

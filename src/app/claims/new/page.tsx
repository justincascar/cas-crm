import { IntakeForm } from "@/components/IntakeForm";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { listClaimHandlers, listKnownInsurers, listKnownAgents, nextReference } from "@/lib/db/queries";
import { draftPayload, getClaimDraft } from "@/lib/db/claim-drafts";
import { recoveryFeeSchedule } from "@/lib/db/recovery-fee-settings";

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; field?: string; draft?: string }>;
}) {
  await requireStaff();
  const { error, field, draft } = await searchParams;
  const draftRow = draft ? getClaimDraft(draft) : undefined;
  const openDraft = draftRow && !draftRow.discarded_at && !draftRow.claim_id ? draftRow : undefined;
  const staff = listClaimHandlers().map((s) => ({ id: String(s.id), name: String(s.name) }));
  const previewRef = nextReference();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New claim"
        subtitle="Capture client, vehicle, accident, recovery and third-party details. The next demonstration reference is shown on the form."
      />
      <IntakeForm
        staff={staff}
        nextRef={previewRef}
        error={error}
        errorField={field}
        insurers={listKnownInsurers()}
        agents={listKnownAgents()}
        fees={recoveryFeeSchedule()}
        defaults={draftPayload(openDraft)}
        draftId={openDraft?.id || ""}
        draftVersion={openDraft?.updated_at || ""}
      />
    </div>
  );
}

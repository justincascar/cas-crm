import { IntakeForm } from "@/components/IntakeForm";
import { readProblems } from "@/lib/form-validation";
import { PageHeader } from "@/components/ClaimTable";
import { requireStaff } from "@/lib/auth/session";
import { formatUkDateTime } from "@/lib/dates";
import { listClaimHandlers, listKnownInsurers, listKnownAgents, nextReference } from "@/lib/db/queries";
import { draftPayload, getClaimDraft } from "@/lib/db/claim-drafts";
import { recoveryFeeSchedule } from "@/lib/db/recovery-fee-settings";
import { enquiryForDraft } from "@/lib/db/website-enquiries";

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; field?: string; draft?: string; problems?: string }>;
}) {
  const me = await requireStaff();
  const { error, field, draft, problems } = await searchParams;
  const draftRow = draft ? getClaimDraft(draft) : undefined;
  const openDraft = draftRow && !draftRow.discarded_at && !draftRow.claim_id ? draftRow : undefined;
  const enquiry = enquiryForDraft(openDraft?.id);
  const staff = listClaimHandlers().map((s) => ({ id: String(s.id), name: String(s.name) }));
  const previewRef = nextReference();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New claim"
        subtitle="Capture client, vehicle, accident, recovery and third-party details. The next demonstration reference is shown on the form."
      />
      {enquiry ? (
        <p className="mb-4 rounded-md border border-teal/40 bg-[#eef8f6] px-4 py-3 text-sm" data-from-enquiry={enquiry.reference}>
          {`Filled from website enquiry ${enquiry.reference}, received ${formatUkDateTime(enquiry.received_at)}. Check each box with the client before you save.`}
        </p>
      ) : null}
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
        currentStaffId={me.id}
        problems={readProblems(problems)}
      />
    </div>
  );
}

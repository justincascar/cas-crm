import { recordClaimEvent } from "@/lib/db/chronology";
import { generateHireAgreementDocument } from "@/lib/db/hire-agreement";
import { RECOVERY_NOT_RECORDED_QUESTION, recoveryNeededNotRecorded } from "@/lib/db/storage-recovery-signing";
import { nowUtcIso } from "@/lib/dates";
import { withImmediateTransaction } from "@/lib/db/record-version";
import { replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, key, form }) => {
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      // R61: the car needs recovery but none is recorded, so the agreement would leave out the Storage & Recovery page.
      if (recoveryNeededNotRecorded(id)) {
        const reason = String(form.get("noRecoveryReason") || "").trim();
        if (reason.length < 5) throw new Error(`${RECOVERY_NOT_RECORDED_QUESTION} Record the recovery first, or give the reason for producing the agreement without it.`);
        if (reason.length > 500) throw new Error("Keep the reason short.");
        recordClaimEvent({
          claimId: id,
          eventType: "other",
          occurredAt: nowUtcIso(),
          actorId: staffId,
          details: `Hire agreement produced without the Storage & Recovery page: no recovery recorded yet. Reason: ${reason}`,
          source: "staff",
        });
      }
      const result = generateHireAgreementDocument(id, staffId);
      storeSubmit(key, { documentId: result.documentId });
    });
    return { hash: "#pack" };
  });
}

import { recordNoBankExplanation } from "@/lib/db/prehire-checks";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { storeSubmit } from "@/lib/db/submit-key";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    const explanation = String(form.get("explanation") || "");
    withSectionSave({
      scope: "bank-check",
      recordKey: id,
      expected: formVersion(form),
      actorId: staffId,
      submitted: { explanation },
      labels: { explanation: "No bank account" },
      fields: { explanation },
      write: () => {
        const saved = recordNoBankExplanation({ claimId: id, actorId: staffId, explanation });
        storeSubmit(key, { id: saved });
        return saved;
      },
    });
  });
}

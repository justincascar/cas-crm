import { generateHireAgreementDocument } from "@/lib/db/hire-agreement";
import { withImmediateTransaction } from "@/lib/db/record-version";
import { replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, key }) => {
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      const result = generateHireAgreementDocument(id, staffId);
      storeSubmit(key, { documentId: result.documentId });
    });
    return { hash: "#pack" };
  });
}

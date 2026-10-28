import { getGtaMarkupPercent, generateHireAgreementDocument } from "@/lib/db/hire-agreement";
import { getHirePack } from "@/lib/db/hire-pack";
import { withImmediateTransaction } from "@/lib/db/record-version";
import { replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { normaliseGtaGroup, standardDailyRatePence } from "@/lib/documents/gta";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, key }) => {
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      const pack = getHirePack(id);
      if (!pack) throw new Error("File not found.");
      const markup = getGtaMarkupPercent();
      const group =
        normaliseGtaGroup(String(pack.stored.group_charged || "")) ||
        normaliseGtaGroup(String(pack.claim.client_gta_group || ""));
      const manual = Number(pack.stored.daily_rate_manual) === 1;
      const daily = manual ? Number(pack.stored.daily_rate_pence) : standardDailyRatePence(group, markup);
      const result = generateHireAgreementDocument(id, staffId, daily);
      storeSubmit(key, { documentId: result.documentId });
    });
    return { hash: "#pack" };
  });
}

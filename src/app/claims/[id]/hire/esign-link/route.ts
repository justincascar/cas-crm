import { sendSigningLink } from "@/lib/db/esign";
import { browserOrigin } from "@/lib/http/browser-origin";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = browserOrigin(request);
  return officeHirePost(request, context, async ({ id, staffId, form }) => {
    await sendSigningLink({ claimId: id, actorId: staffId, to: String(form.get("to") || ""), origin });
    return { hash: "#pack" };
  });
}

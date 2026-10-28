import { setHireDailyRate } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    setHireDailyRate({ claimId: id, group: String(form.get("group") || ""), actorId: staffId, submitKey: key });
    return { hash: "#rate" };
  });
}

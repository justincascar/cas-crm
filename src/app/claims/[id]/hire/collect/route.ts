import { arrangeHireCollection } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    arrangeHireCollection({
      claimId: id,
      date: String(form.get("date") || ""),
      time: String(form.get("time") || ""),
      address: String(form.get("address") || ""),
      actorId: staffId,
      submitKey: key,
    });
  });
}

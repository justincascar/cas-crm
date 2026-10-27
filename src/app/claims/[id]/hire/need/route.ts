import { saveHireNeed } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    const choice = String(form.get("choice") || "");
    if (choice !== "yes" && choice !== "not_yet" && choice !== "not_needed") {
      throw new Error("Choose whether a hire car is needed.");
    }
    saveHireNeed({ claimId: id, choice, reason: String(form.get("reason") || ""), actorId: staffId, submitKey: key });
  });
}

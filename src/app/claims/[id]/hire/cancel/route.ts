import { cancelHireCar } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, key }) => {
    cancelHireCar({ claimId: id, actorId: staffId, submitKey: key });
  });
}

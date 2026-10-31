import { saveHireGroupCheck } from "@/lib/db/hire-group-check";
import { withImmediateTransaction } from "@/lib/db/record-version";
import { replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { officeHirePost } from "@/lib/http/hire-post";

/** R27: the client's own car group (or why it cannot be classified) and the reason for charging above the car supplied. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    const text = (name: string) => String(form.get(name) || "");
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      saveHireGroupCheck({
        claimId: id,
        actorId: staffId,
        clientGroup: text("clientGroup"),
        clientGroupReason: text("clientGroupReason"),
        aboveSuppliedReason: text("aboveSuppliedReason"),
      });
      storeSubmit(key, { ok: true });
    });
    return { hash: "#group-check" };
  });
}

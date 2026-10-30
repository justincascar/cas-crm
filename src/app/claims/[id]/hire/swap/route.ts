import { withImmediateTransaction } from "@/lib/db/record-version";
import { replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { cancelVehicleSwap, overrideUnsignedSwap, startVehicleSwap, storeSignedSwapAgreement } from "@/lib/db/vehicle-swap";
import { officeHirePost } from "@/lib/http/hire-post";

/** A vehicle swap mid-hire (R26): start it, file the signed paper copy, Justin's override, or cancel it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, async ({ id, staffId, form, key }) => {
    const text = (name: string) => String(form.get(name) || "");
    const intent = text("intent");
    const file = form.get("signedAgreement");
    const upload =
      intent === "signed" && file instanceof File && file.size > 0
        ? { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "signed-hire-agreement.pdf", mimeType: file.type || "" }
        : null;
    withImmediateTransaction(() => {
      if (replaySubmit(key)) return;
      if (intent === "start") {
        startVehicleSwap({
          claimId: id,
          actorId: staffId,
          newFleetVehicleId: text("fleetVehicleId"),
          date: text("date"),
          time: text("time"),
          oldMileageIn: text("oldMileageIn"),
          oldFuelIn: text("oldFuelIn"),
          oldCondition: text("oldCondition"),
          newMileageOut: text("newMileageOut"),
          newFuelOut: text("newFuelOut"),
          newCondition: text("newCondition"),
        });
      } else if (intent === "signed") {
        if (!upload) throw new Error("Choose the signed hire agreement for the replacement car.");
        storeSignedSwapAgreement({ claimId: id, actorId: staffId, file: upload });
      } else if (intent === "override") {
        overrideUnsignedSwap({ claimId: id, actorId: staffId, reason: text("reason") });
      } else if (intent === "cancel") {
        cancelVehicleSwap({ claimId: id, actorId: staffId });
      } else {
        throw new Error("Nothing was changed.");
      }
      storeSubmit(key, { intent });
    });
    return { hash: "#on-hire" };
  });
}

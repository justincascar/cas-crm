import { chooseHireCar } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    const method = String(form.get("method") || "");
    if (method !== "deliver" && method !== "collect") throw new Error("Say whether the car is delivered or collected.");
    const fleetVehicleId = String(form.get("fleetVehicleId") || "");
    const versionField = form.get(`fleetVersion_${fleetVehicleId}`);
    chooseHireCar({
      claimId: id,
      fleetVehicleId,
      method,
      date: String(form.get("date") || ""),
      time: String(form.get("time") || ""),
      address: String(form.get("address") || ""),
      actorId: staffId,
      submitKey: key,
      expectedVersion: versionField == null ? undefined : String(versionField),
    });
  });
}

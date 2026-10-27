import { completeHireHandover } from "@/lib/db/hire-choice";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, form, key }) => {
    const mileage = Number(form.get("mileage"));
    if (!Number.isInteger(mileage) || mileage < 0) throw new Error("Enter the mileage out as a whole number.");
    completeHireHandover({
      claimId: id,
      mileage,
      fuelLevel: String(form.get("fuelLevel") || ""),
      driverId: String(form.get("driverId") || ""),
      date: String(form.get("date") || ""),
      time: String(form.get("time") || ""),
      actorId: staffId,
      submitKey: key,
      conditionNote: String(form.get("conditionNote") || ""),
    });
  });
}

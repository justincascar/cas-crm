import { saveBeforeSigningAndRefresh } from "@/lib/db/hire-out-readings";
import { officeHirePost } from "@/lib/http/hire-post";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, staffRole, form }) => {
    saveBeforeSigningAndRefresh({
      claimId: id,
      actorId: staffId,
      actorRole: staffRole,
      mileage: String(form.get("mileage") || ""),
      fuelLevel: String(form.get("fuelLevel") || ""),
      transmission: String(form.get("transmission") || ""),
      licenceIssuedOn: String(form.get("licenceIssuedOn") || ""),
    });
    return { hash: "#pack" };
  });
}

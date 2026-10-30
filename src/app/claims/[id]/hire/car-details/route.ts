import { FLEET_DETAIL_FIELDS } from "@/lib/db/fleet-details";
import { saveHireCarDetails } from "@/lib/db/hire-out-readings";
import { officeHirePost } from "@/lib/http/hire-post";

/** Details missing on the chosen car's fleet record. Saved to the fleet record once, so the next hire has them. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return officeHirePost(request, context, ({ id, staffId, staffRole, form }) => {
    const values = Object.fromEntries(FLEET_DETAIL_FIELDS.map((field) => [field, String(form.get(field) || "")]));
    const version = form.get("fleetVersion");
    saveHireCarDetails({
      claimId: id,
      actorId: staffId,
      actorRole: staffRole,
      values,
      expectedVersion: version == null ? undefined : String(version),
    });
    return { hash: "#car" };
  });
}

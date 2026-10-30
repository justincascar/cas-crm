import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { FLEET_DETAIL_FIELDS, saveMissingFleetDetails } from "@/lib/db/fleet-details";
import { VersionConflictError } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";

/** "Fleet details to complete" on Hire / Fleet: fills what is missing on one car's fleet record. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL("/hire", origin);
  back.hash = "details-to-complete";
  try {
    const form = await request.formData();
    const values = Object.fromEntries(FLEET_DETAIL_FIELDS.map((field) => [field, String(form.get(field) || "")]));
    const version = form.get("fleetVersion");
    const fleetVehicleId = String(form.get("fleetVehicleId") || "");
    saveMissingFleetDetails({
      fleetVehicleId,
      actorId: staff.id,
      values,
      expectedVersion: version == null ? undefined : String(version),
    });
    back.searchParams.set("saved", "1");
    back.searchParams.set("car", fleetVehicleId);
  } catch (error) {
    const message =
      error instanceof VersionConflictError
        ? "Someone else changed this car's fleet record after you opened the page. Nothing was saved. Check the list and enter it again."
        : error instanceof Error
          ? error.message
          : "That was not saved.";
    back.searchParams.set("error", message);
  }
  return NextResponse.redirect(back, 303);
}

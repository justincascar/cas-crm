import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { closeStaleBooking, confirmFleetRecordCheck } from "@/lib/db/fleet-availability";
import { browserOrigin } from "@/lib/http/browser-origin";

function back(origin: string, error?: string) {
  const url = new URL("/hire", origin);
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("saved", "1");
  url.hash = "records-to-check";
  return url;
}

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  try {
    const form = await request.formData();
    const action = String(form.get("action") || "");
    if (action === "confirm") {
      confirmFleetRecordCheck({
        fleetVehicleId: String(form.get("fleetVehicleId") || ""),
        checkKey: String(form.get("checkKey") || ""),
        actorId: staff.id,
      });
    } else if (action === "close") {
      closeStaleBooking({ reservationId: String(form.get("reservationId") || ""), actorId: staff.id });
    } else {
      throw new Error("Choose what to do with this fleet record.");
    }
    return NextResponse.redirect(back(origin), 303);
  } catch (error) {
    return NextResponse.redirect(back(origin, error instanceof Error ? error.message : "That was not saved."), 303);
  }
}

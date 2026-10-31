import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { FLEET_DETAIL_LABELS, hireDetailsMissing, saveFleetDetail, type FleetDetailField } from "@/lib/db/fleet-details";

const FIELDS = new Set(["vehicleClass", "transmission", "fuel", "seats", "colour", "gtaGroup"]);

/** R60: one detail from the Complete fleet details table, saved as it changes. Office staff only. */
export async function POST(request: Request) {
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isOfficeRole(staff.role)) return NextResponse.json({ error: "Office staff keep the fleet records." }, { status: 403 });
  try {
    const body = (await request.json()) as { fleetVehicleId?: string; field?: string; value?: string };
    const field = String(body.field || "");
    if (!FIELDS.has(field)) throw new Error("That detail is not kept on the fleet record here.");
    const car = saveFleetDetail({
      fleetVehicleId: String(body.fleetVehicleId || ""),
      field: field as FleetDetailField | "vehicleClass",
      value: String(body.value ?? ""),
      actorId: staff.id,
    });
    const missing = hireDetailsMissing(car).map((item) => (item === "gtaGroup" ? "GTA group" : FLEET_DETAIL_LABELS[item].toLowerCase()));
    return NextResponse.json({ ok: true, missing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Not saved." }, { status: 400 });
  }
}

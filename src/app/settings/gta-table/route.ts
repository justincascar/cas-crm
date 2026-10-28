import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { saveGtaTable } from "@/lib/db/gta-rates";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Adds a GTA table with the date it applies from. Earlier tables and rates already on hires are not changed. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL("/settings", origin);
  back.hash = "gta-rate";
  const form = await request.formData();
  try {
    saveGtaTable({
      effectiveFrom: String(form.get("effectiveFrom") || ""),
      source: String(form.get("source") || ""),
      figures: String(form.get("figures") || ""),
      actorId: staff.id,
    });
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The GTA table was not saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "gta-table");
  return NextResponse.redirect(back, 303);
}

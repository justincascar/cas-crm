import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { saveEngineerDispatchSettings } from "@/lib/db/engineer-dispatch";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R65: the default engineer, the extra addresses copied into instructions, and who prepares Audatex estimates. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = new URL("/settings/engineers", origin);
  try {
    saveEngineerDispatchSettings({
      defaultEngineerId: String(form.get("defaultEngineerId") || ""),
      extraCc: String(form.get("extraCc") || ""),
      estimatorId: String(form.get("estimatorId") || ""),
    });
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That could not be saved.");
  }
  back.hash = "instructions";
  return NextResponse.redirect(back, 303);
}

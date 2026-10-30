import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { removeFleetGtaRule, saveFleetGtaRule } from "@/lib/db/fleet-details";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Make-and-model rules that suggest a fleet car's GTA group. A suggestion is still checked by staff before it is saved. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL("/settings", origin);
  back.hash = "fleet-gta-rules";
  const form = await request.formData();
  try {
    const action = String(form.get("action") || "");
    if (action === "add") {
      saveFleetGtaRule({
        make: String(form.get("make") || ""),
        model: String(form.get("model") || ""),
        group: String(form.get("group") || ""),
        actorId: staff.id,
      });
    } else if (action === "remove") {
      removeFleetGtaRule({ id: String(form.get("ruleId") || ""), actorId: staff.id });
    } else {
      throw new Error("Choose whether to add or remove a rule.");
    }
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The rule was not saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "fleet-gta-rules");
  return NextResponse.redirect(back, 303);
}

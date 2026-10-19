import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { adoptHireClaimedIfNone } from "@/lib/db/hire-charge";
import { syncRecoveryClaimed, syncStorageClaimed } from "@/lib/db/storage-charge";
import { browserOrigin } from "@/lib/http/browser-origin";

function headPath(head: string): string {
  if (head === "storage") return "storage";
  if (head === "hire") return "hire";
  return "recovery";
}

/** Records a calculated charge. Opening the charge page does not call this. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const head = String(form.get("head") || "");
  const back = new URL(`/claims/${id}/heads/${headPath(head)}`, origin);
  try {
    if (head === "recovery") {
      const decision = syncRecoveryClaimed(id);
      if (!decision.write || decision.totalPence <= 0) throw new Error("There is no recovery charge to record.");
    } else if (head === "storage") {
      const charge = syncStorageClaimed(id);
      if (!charge || charge.status !== "calculated") throw new Error("There is no storage charge to record.");
    } else if (head === "hire") {
      if (!adoptHireClaimedIfNone(id)) throw new Error("There is no hire charge to record.");
    } else {
      throw new Error("That charge is not recorded from this button.");
    }
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The charge could not be recorded.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "recorded");
  return NextResponse.redirect(back, 303);
}

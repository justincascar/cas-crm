import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { setClaimStorageRate } from "@/lib/db/storage-charge";
import { poundsFieldToPence } from "@/lib/domain/recovery-charges";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = (message?: string) => {
    const url = new URL(`/claims/${id}/heads/storage`, origin);
    if (message) url.searchParams.set("error", message);
    else url.searchParams.set("saved", "1");
    return NextResponse.redirect(url, 303);
  };
  try {
    setClaimStorageRate({
      claimId: id,
      actorId: staff.id,
      ratePence: poundsFieldToPence(String(form.get("dailyRate") || "")),
      reason: String(form.get("reason") || ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change the daily rate.";
    return back(message);
  }
  return back();
}

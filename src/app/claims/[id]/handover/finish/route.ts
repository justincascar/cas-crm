import { NextResponse } from "next/server";
import { browserOrigin } from "@/lib/http/browser-origin";
import { getRequestStaff } from "@/lib/auth/session";
import { finishVehicleHandover } from "@/lib/db/handover";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);

  try {
    const form = await request.formData();
    const claimId = String(form.get("claimId") || id);
    if (claimId !== id) throw new Error("That handover is not on this file.");
    finishVehicleHandover({
      claimId,
      handoverId: String(form.get("handoverId") || ""),
      actorId: staff.id,
    });
    const url = new URL("/jobs", origin);
    url.searchParams.set("finished", "1");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The handover could not be finished.";
    const url = new URL(`/claims/${id}/handover`, origin);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url, 303);
  }
}

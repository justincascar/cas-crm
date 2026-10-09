import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { recordPrehireOverride } from "@/lib/db/prehire-checks";
import { browserOrigin } from "@/lib/http/browser-origin";

function back(origin: string, claimId: string, error?: string, saved?: string) {
  const url = new URL(`/claims/${claimId}/prehire`, origin);
  if (error) url.searchParams.set("error", error);
  else if (saved) url.searchParams.set("saved", saved);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);

  try {
    const form = await request.formData();
    recordPrehireOverride({
      claimId: id,
      actorId: staff.id,
      checkKind: String(form.get("checkKind") || ""),
      reason: String(form.get("reason") || ""),
    });
    return back(origin, id, undefined, "override");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The override was not saved.";
    return back(origin, id, message);
  }
}

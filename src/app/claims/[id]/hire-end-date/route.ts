import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { confirmHireEndDate } from "@/lib/db/hire-collection-date";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const choice = String(form.get("choice") || "");
  const episodeId = String(form.get("episodeId") || "");
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}`;
  if ((choice === "job" || choice === "file") && episodeId) {
    confirmHireEndDate({ claimId: id, episodeId, choice, actorId: staff.id });
  }
  const url = new URL(safeReturn, origin);
  url.searchParams.set("hireEnd", "1");
  return NextResponse.redirect(url, 303);
}

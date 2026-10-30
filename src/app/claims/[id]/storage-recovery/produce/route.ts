import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { generateStorageRecoveryDocument } from "@/lib/db/hire-pack";
import { headScreenPath } from "@/lib/domain/head-screen";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Produces the Storage & Recovery Agreement for signature. It is filed unsigned; nothing is sent. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const back = new URL(headScreenPath(id, "recovery"), origin);
  try {
    generateStorageRecoveryDocument(id, staff.id);
    back.searchParams.set("saved", "sr-produced");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The agreement was not produced.");
  }
  back.hash = "agreement";
  return NextResponse.redirect(back, 303);
}

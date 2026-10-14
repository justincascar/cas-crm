import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { setInsurerPaymentTerm } from "@/lib/db/insurers";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) {
    return NextResponse.redirect(new URL("/settings?error=You%20cannot%20change%20payment%20terms.", origin), 303);
  }
  const form = await request.formData();
  try {
    setInsurerPaymentTerm(String(form.get("insurerName") || ""), String(form.get("paymentTerm") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The payment term could not be saved.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, origin), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=1", origin), 303);
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { saveInsurerPaymentDetails } from "@/lib/db/payment-details";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/settings", origin), 303);
  const form = await request.formData();
  try {
    saveInsurerPaymentDetails({
      accountName: String(form.get("accountName") || ""),
      sortCode: String(form.get("sortCode") || ""),
      accountNumber: String(form.get("accountNumber") || ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The payment details could not be saved.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, origin), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=1", origin), 303);
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { saveInsurerPaymentDetails } from "@/lib/db/payment-details";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) {
    return NextResponse.redirect(new URL("/settings?error=You%20cannot%20change%20the%20bank%20details.", origin), 303);
  }
  const form = await request.formData();
  const submitted = {
    accountName: String(form.get("accountName") || ""),
    sortCode: String(form.get("sortCode") || ""),
    accountNumber: String(form.get("accountNumber") || ""),
  };
  try {
    withSectionSave({
      scope: "bank-details",
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted,
      labels: {
        accountName: "Account name",
        sortCode: "Sort code",
        accountNumber: "Account number",
      },
      fields: {
        accountName: submitted.accountName.trim(),
        sortCode: submitted.sortCode.replace(/\D/g, ""),
        accountNumber: submitted.accountNumber.replace(/\D/g, ""),
      },
      write: () => saveInsurerPaymentDetails(submitted, { staffId: staff.id, role: staff.role }),
    });
  } catch (error) {
    const refused = clashRedirect(origin, "/settings", error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message : "The payment details could not be saved.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, origin), 303);
  }
  return NextResponse.redirect(new URL("/settings?saved=1", origin), 303);
}

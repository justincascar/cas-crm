import { NextResponse } from "next/server";
import { isAdministrator } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { COMPANY_DETAIL_LABELS, saveCompanyDetails, type CompanyDetails } from "@/lib/db/company-details";
import { browserOrigin } from "@/lib/http/browser-origin";

/** R41: CAS's company details for the headed paper footer. Administrators only. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL("/settings", origin);
  back.hash = "company-details";
  if (!isAdministrator(staff.role)) {
    back.searchParams.set("error", "Only an administrator can change the company details.");
    return NextResponse.redirect(back, 303);
  }
  const form = await request.formData();
  try {
    const values = Object.fromEntries(
      (Object.keys(COMPANY_DETAIL_LABELS) as Array<keyof CompanyDetails>).map((field) => [field, String(form.get(field) ?? "")]),
    ) as Record<keyof CompanyDetails, string>;
    saveCompanyDetails({ actorId: staff.id, values });
    back.searchParams.set("saved", "company-details");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "The company details could not be saved.");
  }
  return NextResponse.redirect(back, 303);
}

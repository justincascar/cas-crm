import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { setLicenceCheckWindowDays } from "@/lib/db/licence-window";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL("/settings", origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const days = String(form.get("licenceCheckWindowDays") || "");
  try {
    withSectionSave({
      scope: "settings-licence-window",
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted: { licenceCheckWindowDays: days },
      labels: { licenceCheckWindowDays: "Licence check window (days)" },
      fields: { licenceCheckWindowDays: days },
      write: () => setLicenceCheckWindowDays(days),
    });
  } catch (error) {
    const refused = clashRedirect(origin, "/settings", error);
    if (refused) return refused;
    back.searchParams.set("error", error instanceof Error ? error.message : "The licence check window could not be saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "licence-window");
  return NextResponse.redirect(back, 303);
}

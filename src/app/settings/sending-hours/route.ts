import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { setSendingHours } from "@/lib/db/sending-hours";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const back = new URL("/settings", origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  try {
    const days = form.getAll("day").map((value) => String(value));
    const start = String(form.get("start") || "");
    const end = String(form.get("end") || "");
    const submitted = { days: days.join(","), start, end };
    withSectionSave({
      scope: "settings-sending-hours",
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted,
      labels: { days: "Sending days", start: "Sending starts", end: "Sending ends" },
      fields: submitted,
      write: () => setSendingHours(days, start, end),
    });
  } catch (error) {
    const refused = clashRedirect(origin, "/settings", error);
    if (refused) return refused;
    back.searchParams.set("error", error instanceof Error ? error.message : "The sending hours could not be saved.");
    return NextResponse.redirect(back, 303);
  }
  back.searchParams.set("saved", "sending-hours");
  return NextResponse.redirect(back, 303);
}

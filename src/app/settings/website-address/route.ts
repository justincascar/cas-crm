import { NextResponse } from "next/server";
import { getRequestStaff } from "@/lib/auth/session";
import { saveWebsiteOrigins } from "@/lib/db/website-enquiries";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Saves the live website address that may send enquiries (J16). Administrator only. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const back = new URL("/settings", origin);
  try {
    saveWebsiteOrigins({ actorRole: staff.role, value: String(form.get("websiteOrigins") || "") });
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Nothing was changed.");
  }
  back.hash = "website-address";
  return NextResponse.redirect(back, 303);
}

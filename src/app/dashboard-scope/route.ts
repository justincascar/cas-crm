import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { DASHBOARD_SCOPE_COOKIE, parseDashboardScope, scopeCookieValue } from "@/lib/domain/dashboard-scope";
import { browserOrigin } from "@/lib/http/browser-origin";

/** Remembers My claims / All claims for this browser session. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const scope = parseDashboardScope(String(form.get("scope") || ""));
  const response = NextResponse.redirect(new URL(scope ? `/?scope=${scope}` : "/", origin), 303);
  if (scope) {
    response.cookies.set(DASHBOARD_SCOPE_COOKIE, scopeCookieValue(staff.id, scope), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return response;
}

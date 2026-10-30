import { NextResponse } from "next/server";
import { CHALLENGE_COOKIE, startChallenge, switchOffTwoStep } from "@/lib/auth/login-security";
import { getRequestStaff } from "@/lib/auth/session";
import { browserOrigin } from "@/lib/http/browser-origin";

/** A person switches their own authenticator app on (set up now) or off (where it is optional). */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const form = await request.formData();
  const back = new URL("/settings", origin);
  back.hash = "my-sign-in";
  try {
    if (String(form.get("intent")) === "on") {
      const token = startChallenge({ staffId: staff.id, kind: "setup", nextPath: "/settings" });
      const response = NextResponse.redirect(new URL("/login/setup", origin), 303);
      response.cookies.set(CHALLENGE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 5 * 60 });
      return response;
    }
    switchOffTwoStep({ staffId: staff.id, role: staff.role });
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "Not changed.");
  }
  return NextResponse.redirect(back, 303);
}

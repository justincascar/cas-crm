import { NextResponse } from "next/server";
import { pathAllowedForRole } from "@/lib/auth/roles";
import { browserOrigin } from "@/lib/http/browser-origin";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
  safeNextPath,
  verifyStaffLogin,
} from "@/lib/auth/session";

/** Ordinary form post, so the phone does not depend on a script fetch to sign in. */
export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const next = safeNextPath(String(form.get("next") || "/"));
  const origin = browserOrigin(request);
  const staff = verifyStaffLogin(username, password);

  if (!staff) {
    const back = new URL("/login", origin);
    if (next !== "/") back.searchParams.set("next", next);
    back.searchParams.set("error", "1");
    return NextResponse.redirect(back, 303);
  }

  const destination = pathAllowedForRole(staff.role, next) ? next : "/jobs";
  const response = NextResponse.redirect(new URL(destination, origin), 303);
  response.cookies.set(SESSION_COOKIE, createSession(staff.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}

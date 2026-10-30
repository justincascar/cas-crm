import { NextResponse } from "next/server";
import { CHALLENGE_COOKIE, startChallenge, twoStepEnabled, twoStepRequired } from "../auth/login-security";
import { pathAllowedForRole } from "../auth/roles";
import { createSession, SESSION_COOKIE, SESSION_DAYS, type StaffUser } from "../auth/session";

/** After the password: the authenticator step if it is on (or required and not set up yet), otherwise signed in. */
export function afterPassword(staff: StaffUser, next: string, origin: string): NextResponse {
  const enabled = twoStepEnabled(staff.id);
  if (enabled || twoStepRequired(staff.role)) {
    const token = startChallenge({ staffId: staff.id, kind: enabled ? "code" : "setup", nextPath: next });
    const response = NextResponse.redirect(new URL(enabled ? "/login/code" : "/login/setup", origin), 303);
    response.cookies.set(CHALLENGE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/login",
      maxAge: 5 * 60,
    });
    return response;
  }
  return signedIn(staff.id, staff.role, next, origin);
}

export function signedIn(staffId: string, role: string, next: string, origin: string): NextResponse {
  const destination = pathAllowedForRole(role, next) ? next : "/jobs";
  const response = NextResponse.redirect(new URL(destination, origin), 303);
  response.cookies.set(SESSION_COOKIE, createSession(staffId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  response.cookies.set(CHALLENGE_COOKIE, "", { path: "/login", maxAge: 0 });
  return response;
}

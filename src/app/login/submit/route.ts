import { NextResponse } from "next/server";
import { browserOrigin } from "@/lib/http/browser-origin";
import { afterPassword } from "@/lib/http/sign-in";
import { checkStaffLogin, safeNextPath } from "@/lib/auth/session";

/** Ordinary form post, so the phone does not depend on a script fetch to sign in. */
export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const next = safeNextPath(String(form.get("next") || "/"));
  const origin = browserOrigin(request);
  const check = checkStaffLogin(username, password);

  if (!check.ok) {
    const back = new URL("/login", origin);
    if (next !== "/") back.searchParams.set("next", next);
    back.searchParams.set("error", check.lockedUntil ? "locked" : "1");
    return NextResponse.redirect(back, 303);
  }
  return afterPassword(check.staff, next, origin);
}

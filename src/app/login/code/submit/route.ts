import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CHALLENGE_COOKIE, completeChallenge } from "@/lib/auth/login-security";
import { get } from "@/lib/db/connection";
import { browserOrigin } from "@/lib/http/browser-origin";
import { signedIn } from "@/lib/http/sign-in";

/** The authenticator code, for an ordinary sign-in or to finish setting the app up. */
export async function POST(request: Request) {
  const origin = browserOrigin(request);
  const form = await request.formData();
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value || "";
  const step = String(form.get("step") || "code") === "setup" ? "/login/setup" : "/login/code";
  try {
    const done = completeChallenge(token, String(form.get("code") || ""));
    const role = String(get<{ role: string }>(`SELECT role FROM staff WHERE id = ?`, [done.staffId])?.role || "");
    return signedIn(done.staffId, role, done.nextPath, origin);
  } catch (error) {
    const back = new URL(step, origin);
    back.searchParams.set("error", error instanceof Error ? error.message : "That code is not right.");
    return NextResponse.redirect(back, 303);
  }
}

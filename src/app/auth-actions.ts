"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie, destroySession, getRequestStaff, SESSION_COOKIE } from "@/lib/auth/session";

// Signing in is only through /login/submit, which applies the lockout and the authenticator step (J15).

export async function actionLogout() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const staff = await getRequestStaff();
  destroySession(token, staff?.id);
  await clearSessionCookie();
  redirect("/login");
}

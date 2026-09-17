"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getRequestStaff,
  safeNextPath,
  SESSION_COOKIE,
  setSessionCookie,
  verifyStaffLogin,
} from "@/lib/auth/session";

export async function actionLogin(formData: FormData) {
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const next = safeNextPath(String(formData.get("next") || "/"));
  const staff = verifyStaffLogin(username, password);
  if (!staff) {
    return { error: "Username or password is not right." };
  }
  const token = createSession(staff.id);
  await setSessionCookie(token);
  redirect(next);
}

export async function actionLogout() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const staff = await getRequestStaff();
  destroySession(token, staff?.id);
  await clearSessionCookie();
  redirect("/login");
}

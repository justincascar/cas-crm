"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/session";
import {
  createStaffAccount,
  resetStaffPassword,
  setStaffActive,
  setStaffRole,
} from "@/lib/db/staff-admin";

function bounce(error?: string) {
  redirect(error ? `/settings/staff?error=${encodeURIComponent(error)}` : "/settings/staff?saved=1");
}

export async function actionCreateStaff(formData: FormData) {
  const admin = await requireAdministrator();
  const result = createStaffAccount({
    name: String(formData.get("name") || ""),
    username: String(formData.get("username") || ""),
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || ""),
    role: String(formData.get("role") || "staff"),
    actorId: admin.id,
  });
  revalidatePath("/settings/staff");
  if (!result.ok) bounce(result.error);
  bounce();
}

export async function actionSetStaffActive(formData: FormData) {
  const admin = await requireAdministrator();
  const result = setStaffActive(
    String(formData.get("staffId") || ""),
    String(formData.get("active") || "") === "1",
    admin.id,
  );
  revalidatePath("/settings/staff");
  if (!result.ok) bounce(result.error);
  bounce();
}

export async function actionResetStaffPassword(formData: FormData) {
  const admin = await requireAdministrator();
  const result = resetStaffPassword(
    String(formData.get("staffId") || ""),
    String(formData.get("password") || ""),
    admin.id,
  );
  revalidatePath("/settings/staff");
  if (!result.ok) bounce(result.error);
  bounce();
}

export async function actionSetStaffRole(formData: FormData) {
  const admin = await requireAdministrator();
  const result = setStaffRole(
    String(formData.get("staffId") || ""),
    String(formData.get("role") || "staff"),
    admin.id,
  );
  revalidatePath("/settings/staff");
  if (!result.ok) bounce(result.error);
  bounce();
}

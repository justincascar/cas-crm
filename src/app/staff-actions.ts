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
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { resetTwoStep, setIdleMinutes } from "@/lib/auth/login-security";
import { redirectClash } from "@/lib/http/version-clash";

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

function saveStaffRow(formData: FormData, adminId: string, submitted: Record<string, string>, write: () => { ok: true } | { ok: false; error: string }) {
  const staffId = String(formData.get("staffId") || "");
  try {
    withSectionSave({
      scope: "staff",
      recordKey: staffId,
      expected: formVersion(formData),
      actorId: adminId,
      submitted,
      fields: submitted,
      write: () => {
        const result = write();
        if (!result.ok) throw new Error(result.error);
      },
    });
  } catch (error) {
    redirectClash("/settings/staff", error);
    bounce(error instanceof Error ? error.message : "Could not save.");
  }
}

export async function actionSetStaffActive(formData: FormData) {
  const admin = await requireAdministrator();
  const active = String(formData.get("active") || "") === "1";
  saveStaffRow(formData, admin.id, { active: active ? "1" : "0" }, () =>
    setStaffActive(String(formData.get("staffId") || ""), active, admin.id),
  );
  revalidatePath("/settings/staff");
  bounce();
}

export async function actionResetStaffPassword(formData: FormData) {
  const admin = await requireAdministrator();
  saveStaffRow(formData, admin.id, { password: "entered" }, () =>
    resetStaffPassword(String(formData.get("staffId") || ""), String(formData.get("password") || ""), admin.id),
  );
  revalidatePath("/settings/staff");
  bounce();
}

/** A lost phone: the person sets up their authenticator again at their next sign-in. */
export async function actionResetTwoStep(formData: FormData) {
  const admin = await requireAdministrator();
  resetTwoStep({ staffId: String(formData.get("staffId") || ""), actorId: admin.id });
  revalidatePath("/settings/staff");
  bounce();
}

export async function actionSetIdleMinutes(formData: FormData) {
  await requireAdministrator();
  try {
    setIdleMinutes(String(formData.get("minutes") || ""));
  } catch (error) {
    bounce(error instanceof Error ? error.message : "Not saved.");
  }
  revalidatePath("/settings/staff");
  bounce();
}

export async function actionSetStaffRole(formData: FormData) {
  const admin = await requireAdministrator();
  const role = String(formData.get("role") || "staff");
  saveStaffRow(formData, admin.id, { role }, () => setStaffRole(String(formData.get("staffId") || ""), role, admin.id));
  revalidatePath("/settings/staff");
  bounce();
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createEngineer, setEngineerActive, updateEngineer } from "@/lib/db/engineers";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { redirectClash } from "@/lib/http/version-clash";

function bounce(error?: string) {
  redirect(error ? `/settings/engineers?error=${encodeURIComponent(error)}` : "/settings/engineers?saved=1");
}

export async function actionCreateEngineer(formData: FormData) {
  await requireStaff();
  try {
    createEngineer({
      name: String(formData.get("name") || ""),
      address: String(formData.get("address") || ""),
      email: String(formData.get("email") || ""),
    });
  } catch (error) {
    bounce(error instanceof Error ? error.message : "Could not add the engineer.");
  }
  revalidatePath("/settings/engineers");
  bounce();
}

export async function actionUpdateEngineer(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("engineerId") || "");
  const submitted = {
    name: String(formData.get("name") || ""),
    address: String(formData.get("address") || ""),
    email: String(formData.get("email") || ""),
  };
  try {
    withSectionSave({
      scope: "engineer",
      recordKey: id,
      expected: formVersion(formData),
      actorId: staff.id,
      submitted,
      labels: { name: "Name", address: "Address", email: "Email" },
      fields: submitted,
      write: () => updateEngineer({ id, ...submitted }),
    });
  } catch (error) {
    redirectClash("/settings/engineers", error);
    bounce(error instanceof Error ? error.message : "Could not save the engineer.");
  }
  revalidatePath("/settings/engineers");
  bounce();
}

export async function actionSetEngineerActive(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("engineerId") || "");
  const active = String(formData.get("active") || "") === "1";
  try {
    withSectionSave({
      scope: "engineer",
      recordKey: id,
      expected: formVersion(formData),
      actorId: staff.id,
      submitted: { active: active ? "1" : "0" },
      labels: { active: "Shown in the list" },
      fields: { active: active ? "1" : "0" },
      write: () => setEngineerActive(id, active),
    });
  } catch (error) {
    redirectClash("/settings/engineers", error);
    bounce(error instanceof Error ? error.message : "Could not update the engineer.");
  }
  revalidatePath("/settings/engineers");
  bounce();
}

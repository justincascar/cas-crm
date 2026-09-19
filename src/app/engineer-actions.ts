"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { createEngineer, setEngineerActive, updateEngineer } from "@/lib/db/engineers";

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
  await requireStaff();
  try {
    updateEngineer({
      id: String(formData.get("engineerId") || ""),
      name: String(formData.get("name") || ""),
      address: String(formData.get("address") || ""),
      email: String(formData.get("email") || ""),
    });
  } catch (error) {
    bounce(error instanceof Error ? error.message : "Could not save the engineer.");
  }
  revalidatePath("/settings/engineers");
  bounce();
}

export async function actionSetEngineerActive(formData: FormData) {
  await requireStaff();
  try {
    setEngineerActive(String(formData.get("engineerId") || ""), String(formData.get("active") || "") === "1");
  } catch (error) {
    bounce(error instanceof Error ? error.message : "Could not update the engineer.");
  }
  revalidatePath("/settings/engineers");
  bounce();
}

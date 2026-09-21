"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { setEngineerChaseIntervalDays } from "@/lib/db/engineer-chase";

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/claims");
  revalidatePath("/");
}

export async function actionSaveDefaultVehicleLocation(formData: FormData) {
  await requireStaff();
  try {
    setDefaultVehicleLocation(String(formData.get("defaultVehicleLocation") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the default vehicle location.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

export async function actionSaveEngineerChaseInterval(formData: FormData) {
  await requireStaff();
  try {
    setEngineerChaseIntervalDays(String(formData.get("engineerChaseIntervalDays") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the chase interval.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

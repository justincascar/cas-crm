"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setDefaultVehicleLocation } from "@/lib/db/vehicle-location";

export async function actionSaveDefaultVehicleLocation(formData: FormData) {
  await requireStaff();
  try {
    setDefaultVehicleLocation(String(formData.get("defaultVehicleLocation") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the default vehicle location.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/settings");
  revalidatePath("/claims");
  redirect("/settings?saved=1");
}

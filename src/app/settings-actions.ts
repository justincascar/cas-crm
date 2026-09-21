"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { setChaseIntervalDays, setAgreementMaxDays, setAgreementApproachingDay } from "@/lib/db/chase";

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
    setChaseIntervalDays("engineer_report", String(formData.get("engineerChaseIntervalDays") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the chase interval.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

export async function actionSaveChaseIntervals(formData: FormData) {
  await requireStaff();
  try {
    setChaseIntervalDays("engineer_report", String(formData.get("engineerChaseIntervalDays") || ""));
    setChaseIntervalDays("liability_response", String(formData.get("liabilityChaseIntervalDays") || ""));
    setChaseIntervalDays("repair_authorisation", String(formData.get("repairAuthChaseIntervalDays") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the chase intervals.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

export async function actionSaveAgreementLimits(formData: FormData) {
  await requireStaff();
  try {
    setAgreementApproachingDay(String(formData.get("agreementRenewalApproachingDay") || ""));
    setChaseIntervalDays("hire_agreement_renewal", String(formData.get("agreementRenewalAlertDay") || ""));
    setAgreementMaxDays(String(formData.get("agreementMaxDays") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the agreement limits.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

export async function actionSaveGtaMarkup(formData: FormData) {
  await requireStaff();
  try {
    const { setGtaMarkupPercent } = await import("@/lib/db/hire-agreement");
    setGtaMarkupPercent(String(formData.get("gtaMarkupPercent") || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the GTA markup.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

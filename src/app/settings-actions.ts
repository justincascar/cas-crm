"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setDefaultVehicleLocation } from "@/lib/db/vehicle-location";
import { setStorageDailyRatePence } from "@/lib/db/storage-charge";
import { poundsFieldToPence } from "@/lib/domain/recovery-charges";
import { setChaseIntervalDays, setAgreementMaxDays, setAgreementApproachingDay } from "@/lib/db/chase";
import { setGtaMarkupPercent } from "@/lib/db/hire-agreement";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { testMailboxConnection } from "@/lib/email/microsoft-graph";
import { redirectClash } from "@/lib/http/version-clash";

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/claims");
  revalidatePath("/");
}

function posted(form: FormData, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) out[name] = String(form.get(name) || "");
  return out;
}

async function saveOfficeSetting(form: FormData, scope: string, names: string[], write: () => void) {
  const staff = await requireStaff();
  const submitted = posted(form, names);
  try {
    withSectionSave({
      scope,
      recordKey: "office",
      expected: formVersion(form),
      actorId: staff.id,
      submitted,
      fields: submitted,
      write,
    });
  } catch (error) {
    redirectClash("/settings", error);
    const message = error instanceof Error ? error.message : "Could not save.";
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  revalidateSettings();
  redirect("/settings?saved=1");
}

export async function actionSaveDefaultVehicleLocation(formData: FormData) {
  await saveOfficeSetting(formData, "settings-vehicle-location", ["defaultVehicleLocation"], () => {
    setDefaultVehicleLocation(String(formData.get("defaultVehicleLocation") || ""));
  });
}

export async function actionSaveStorageDailyRate(formData: FormData) {
  await saveOfficeSetting(formData, "settings-storage-rate", ["storageDailyRate"], () => {
    setStorageDailyRatePence(poundsFieldToPence(String(formData.get("storageDailyRate") || "")));
  });
}

export async function actionSaveEngineerChaseInterval(formData: FormData) {
  await saveOfficeSetting(formData, "settings-engineer-chase", ["engineerChaseIntervalDays"], () => {
    setChaseIntervalDays("engineer_report", String(formData.get("engineerChaseIntervalDays") || ""));
  });
}

export async function actionSaveChaseIntervals(formData: FormData) {
  await saveOfficeSetting(
    formData,
    "settings-chase-intervals",
    ["engineerChaseIntervalDays", "liabilityChaseIntervalDays", "repairAuthChaseIntervalDays", "paymentChaseIntervalDays"],
    () => {
      setChaseIntervalDays("engineer_report", String(formData.get("engineerChaseIntervalDays") || ""));
      setChaseIntervalDays("liability_response", String(formData.get("liabilityChaseIntervalDays") || ""));
      setChaseIntervalDays("repair_authorisation", String(formData.get("repairAuthChaseIntervalDays") || ""));
      setChaseIntervalDays("repair_payment", String(formData.get("paymentChaseIntervalDays") || ""));
    },
  );
}

export async function actionSaveAgreementLimits(formData: FormData) {
  await saveOfficeSetting(
    formData,
    "settings-agreement",
    ["agreementRenewalApproachingDay", "agreementRenewalAlertDay", "agreementMaxDays"],
    () => {
      setAgreementApproachingDay(String(formData.get("agreementRenewalApproachingDay") || ""));
      setChaseIntervalDays("hire_agreement_renewal", String(formData.get("agreementRenewalAlertDay") || ""));
      setAgreementMaxDays(String(formData.get("agreementMaxDays") || ""));
    },
  );
}

export async function actionSaveGtaMarkup(formData: FormData) {
  await saveOfficeSetting(formData, "settings-gta", ["gtaMarkupPercent"], () => {
    setGtaMarkupPercent(String(formData.get("gtaMarkupPercent") || ""));
  });
}

export async function actionTestMailboxConnection() {
  await requireStaff();
  const result = await testMailboxConnection();
  if (result.ok) redirect(`/settings?mailboxCheck=${encodeURIComponent(result.message)}`);
  redirect(`/settings?mailboxCheckError=${encodeURIComponent(result.error)}`);
}

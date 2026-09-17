"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import {
  addNote,
  addTask,
  completeTask,
  createReservation,
  updateClaimPosition,
} from "@/lib/db/queries";
import { createClaimFromIntake, intakeFromFormData } from "@/lib/db/intake";
import { complianceLookup } from "@/lib/lookups/compliance";
import {
  generateClaimDocument,
  logIncomingEmail,
  logIncomingWhatsApp,
  recordClaimCall,
  recordClaimEvent,
  sendClaimEmail,
  sendClaimWhatsApp,
} from "@/lib/db/chronology";
import { generateHirePackDocument, saveHirePack } from "@/lib/db/hire-pack";
import { saveScreenData, valuesFromForm } from "@/lib/db/screens";
import { isoDaysFromNow } from "@/lib/dates";
import { postcodeLookup } from "@/lib/lookups/postcode";
import { vehicleLookup } from "@/lib/lookups/vehicle";
import type { LetterTemplateKey } from "@/lib/documents/templates";

export async function actionCreateClaim(formData: FormData) {
  await requireStaff();
  const result = await createClaimFromIntake(intakeFromFormData(formData));
  revalidatePath("/");
  revalidatePath("/claims");
  redirect(`/claims/${result.id}`);
}

export async function actionAddNote(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const body = String(formData.get("body") || "").trim();
  if (!body) return { error: "Note cannot be empty." };
  addNote(claimId, String(formData.get("authorId") || "staff-sian"), body);
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

export async function actionAddTask(formData: FormData) {
  await requireStaff();
  addTask({
    claimId: String(formData.get("claimId")),
    handlerId: String(formData.get("handlerId") || "staff-sian"),
    title: String(formData.get("title") || "").trim(),
    details: String(formData.get("details") || "").trim() || undefined,
    type: String(formData.get("type") || "general"),
    dueAt: String(formData.get("dueAt") || "") || undefined,
  });
  revalidatePath("/tasks");
  revalidatePath(`/claims/${String(formData.get("claimId"))}`);
  return { ok: true };
}

export async function actionCompleteTask(formData: FormData) {
  await requireStaff();
  completeTask(String(formData.get("taskId")));
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}

export async function actionUpdateClaim(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("claimId"));
  updateClaimPosition(id, {
    current_position: String(formData.get("current_position") || ""),
    circumstances: String(formData.get("circumstances") || ""),
    accident_location: String(formData.get("accident_location") || ""),
    claim_type: String(formData.get("claim_type") || ""),
    cas_liability_assessment: String(formData.get("cas_liability_assessment") || ""),
    insurer_liability_position: String(formData.get("insurer_liability_position") || ""),
    roadworthiness: String(formData.get("roadworthiness") || ""),
    roadworthiness_reasons: String(formData.get("roadworthiness_reasons") || ""),
    next_action: String(formData.get("next_action") || ""),
    next_action_due: String(formData.get("next_action_due") || ""),
    handler_id: String(formData.get("handler_id") || ""),
    own_insurer_name: String(formData.get("own_insurer_name") || ""),
    own_policy_ref: String(formData.get("own_policy_ref") || ""),
    own_claim_ref: String(formData.get("own_claim_ref") || ""),
  });
  revalidatePath(`/claims/${id}`);
  revalidatePath("/");
  return { ok: true };
}

export async function actionReserveVehicle(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId") || "");
  const returnTo = String(formData.get("returnTo") || "");
  try {
    createReservation({
      fleetVehicleId: String(formData.get("fleetVehicleId")),
      claimId: claimId || undefined,
      startAt: new Date(String(formData.get("startAt"))).toISOString(),
      endAt: new Date(String(formData.get("endAt"))).toISOString(),
      kind: String(formData.get("kind") || "hire"),
      createdBy: String(formData.get("createdBy") || "staff-sian"),
    });
    revalidatePath("/hire");
    if (claimId) {
      revalidatePath(`/claims/${claimId}`);
      revalidatePath(`/claims/${claimId}/work/hire-vehicle`);
      revalidatePath(`/claims/${claimId}/work/reserve`);
    }
    if (returnTo) redirect(`${returnTo}?saved=1`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reservation failed.";
    if (returnTo) redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
    return { error: message };
  }
}

export async function actionSaveClaimScreen(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const screenKey = String(formData.get("screenKey"));
  saveScreenData(claimId, screenKey, valuesFromForm(formData, screenKey), String(formData.get("actorId") || "staff-sian"));
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/${screenKey}`);
  redirect(`/claims/${claimId}/work/${screenKey}?saved=1`);
}

export async function actionLookupPostcode(postcode: string) {
  await requireStaff();
  const result = await postcodeLookup.search(postcode);
  return {
    simulated: postcodeLookup.simulated,
    licensedPaf: postcodeLookup.licensedPaf,
    provider: postcodeLookup.name,
    ...result,
  };
}

export async function actionLookupVehicle(registration: string) {
  await requireStaff();
  const result = await vehicleLookup.lookup(registration);
  return { simulated: vehicleLookup.simulated, provider: vehicleLookup.name, result };
}

export async function actionLookupCompliance(registration: string) {
  await requireStaff();
  const result = await complianceLookup.check(registration);
  return { simulated: complianceLookup.simulated, provider: complianceLookup.name, result };
}

export async function actionRecordEvent(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  recordClaimEvent({
    claimId,
    eventType: String(formData.get("eventType") || "other"),
    occurredAt: String(formData.get("occurredAt") || ""),
    details: String(formData.get("details") || "").trim() || undefined,
    actorId: String(formData.get("actorId") || "staff-sian"),
    channel: String(formData.get("channel") || "system"),
    source: "staff",
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/");
}

export async function actionGenerateDocument(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const result = generateClaimDocument({
    claimId,
    templateKey: String(formData.get("templateKey") || "initial_tp_insurer") as LetterTemplateKey,
    actorId: String(formData.get("actorId") || "staff-sian"),
    letterDate: String(formData.get("letterDate") || "") || undefined,
    recordOnFile: formData.get("recordOnFile") === "yes",
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/documents");
  redirect(`/documents/${result.documentId}`);
}

export async function actionSendEmail(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const result = await sendClaimEmail({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    to: String(formData.get("to") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

export async function actionLogIncomingEmail(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  logIncomingEmail({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    from: String(formData.get("from") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
}

export async function actionSendWhatsApp(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const result = await sendClaimWhatsApp({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    to: String(formData.get("to") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

export async function actionLogIncomingWhatsApp(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  logIncomingWhatsApp({
    claimId,
    actorId: String(formData.get("actorId") || "staff-sian"),
    from: String(formData.get("from") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
}

export async function actionRecordCall(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  const actorId = String(formData.get("actorId") || "staff-sian");
  const outcome = String(formData.get("outcome") || "connected");
  const party = String(formData.get("party") || "").trim();
  const result = await recordClaimCall({
    claimId,
    actorId,
    direction: String(formData.get("direction") || "outgoing") === "incoming" ? "incoming" : "outgoing",
    number: String(formData.get("number") || "").trim(),
    party,
    outcome,
    notes: String(formData.get("notes") || "").trim() || undefined,
    occurredAt: String(formData.get("occurredAt") || "") || undefined,
  });
  if (formData.get("createTask") && outcome !== "connected") {
    addTask({
      claimId,
      handlerId: actorId,
      title: `Call back ${party || "this file"}`,
      details: `Previous outcome: ${outcome}.`,
      type: "call",
      dueAt: isoDaysFromNow(1),
    });
    revalidatePath("/tasks");
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath(`/claims/${claimId}/work/comms`);
  revalidatePath("/communications");
  return result;
}

function poundsToPence(formData: FormData, name: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return 0;
  return Math.round(Number.parseFloat(raw) * 100);
}

export async function actionSaveHirePack(formData: FormData) {
  await requireStaff();
  const claimId = String(formData.get("claimId"));
  saveHirePack(claimId, {
    title: String(formData.get("title") || ""),
    home_tel: String(formData.get("home_tel") || ""),
    work_tel: String(formData.get("work_tel") || ""),
    mobile_tel: String(formData.get("mobile_tel") || ""),
    licence_issued_on: String(formData.get("licence_issued_on") || ""),
    licence_expires_on: String(formData.get("licence_expires_on") || ""),
    additional_name: String(formData.get("additional_name") || ""),
    additional_address: String(formData.get("additional_address") || ""),
    additional_dob: String(formData.get("additional_dob") || ""),
    additional_licence: String(formData.get("additional_licence") || ""),
    additional_licence_issued_on: String(formData.get("additional_licence_issued_on") || ""),
    additional_licence_expires_on: String(formData.get("additional_licence_expires_on") || ""),
    delivery_address: String(formData.get("delivery_address") || ""),
    hire_fuel: String(formData.get("hire_fuel") || ""),
    vehicle_group: String(formData.get("vehicle_group") || ""),
    group_charged: String(formData.get("group_charged") || ""),
    date_out: String(formData.get("date_out") || ""),
    date_in: String(formData.get("date_in") || ""),
    daily_rate_pence: poundsToPence(formData, "daily_rate"),
    sat_nav_pence: poundsToPence(formData, "sat_nav"),
    additional_driver_pence: poundsToPence(formData, "additional_driver"),
    hands_free_pence: poundsToPence(formData, "hands_free"),
    cdw_pence: poundsToPence(formData, "cdw"),
    child_seat_pence: poundsToPence(formData, "child_seat"),
    automatic_pence: poundsToPence(formData, "automatic"),
    insurance_daily_pence: poundsToPence(formData, "insurance_daily"),
    estate_pence: poundsToPence(formData, "estate"),
    insurance_pence: poundsToPence(formData, "insurance"),
    tow_bar_pence: poundsToPence(formData, "tow_bar"),
    admin_pence: poundsToPence(formData, "admin"),
    roof_rack_pence: poundsToPence(formData, "roof_rack"),
    delivery_collection_pence: poundsToPence(formData, "delivery_collection"),
    no_replacement_offer: formData.get("no_replacement_offer") ? 1 : 0,
    declined_offer_reason: String(formData.get("declined_offer_reason") || ""),
    understands_personal_liability: formData.get("understands_personal_liability") ? 1 : 0,
    need_reason: String(formData.get("need_reason") || ""),
    own_vehicle_unusable: formData.get("own_vehicle_unusable") ? 1 : 0,
    no_other_vehicle: formData.get("no_other_vehicle") ? 1 : 0,
    delivery_mileage: Number(formData.get("delivery_mileage") || 0) || null,
    delivery_fuel: String(formData.get("delivery_fuel") || ""),
    delivery_tyres: String(formData.get("delivery_tyres") || ""),
    delivery_damage: String(formData.get("delivery_damage") || ""),
    delivery_interior: String(formData.get("delivery_interior") || ""),
    collection_mileage: Number(formData.get("collection_mileage") || 0) || null,
    collection_fuel: String(formData.get("collection_fuel") || ""),
    collection_damage: String(formData.get("collection_damage") || ""),
    storage_daily_pence: poundsToPence(formData, "storage_daily"),
    recovery_pence: poundsToPence(formData, "recovery"),
    driver_delivery_start: String(formData.get("driver_delivery_start") || ""),
    driver_delivery_finish: String(formData.get("driver_delivery_finish") || ""),
    driver_name: String(formData.get("driver_name") || ""),
    date_of_birth: String(formData.get("date_of_birth") || ""),
    licence_number: String(formData.get("licence_number") || ""),
  });
  revalidatePath(`/claims/${claimId}/hire-pack`);
  revalidatePath(`/claims/${claimId}`);
}

export async function actionGenerateHirePack(formData: FormData) {
  await requireStaff();
  await actionSaveHirePack(formData);
  const claimId = String(formData.get("claimId"));
  const result = generateHirePackDocument(claimId, String(formData.get("actorId") || "staff-sian"));
  revalidatePath("/documents");
  redirect(`/documents/${result.documentId}`);
}

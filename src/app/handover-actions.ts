"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/session";
import { addHandoverPhotographs, attachHandoverScan, DAMAGE_SHOT, recordVehicleHandover, STANDARD_SHOTS, type HandoverPhotoInput } from "@/lib/db/handover";
import { errorQuery } from "@/lib/form-validation";

function page(claimId: string) {
  return `/claims/${claimId}/handover`;
}

async function oneFile(formData: FormData, fields: string[], label: string): Promise<HandoverPhotoInput | null> {
  const found: HandoverPhotoInput[] = [];
  for (const field of fields) {
    const file = await fileFromField(formData, field, "scan.pdf");
    if (file) found.push(file);
  }
  if (found.length > 1) {
    throw new Error(`Choose either a new photograph or an existing file for the ${label}, not both.`);
  }
  return found[0] || null;
}

async function fileFromField(formData: FormData, field: string, fallbackName: string): Promise<HandoverPhotoInput | null> {
  const value = formData.get(field);
  if (!value || typeof value === "string" || value.size === 0) return null;
  return {
    buffer: Buffer.from(await value.arrayBuffer()),
    filename: value.name || fallbackName,
    mimeType: value.type || "",
    slot: DAMAGE_SHOT,
  };
}

async function photosFromForm(formData: FormData): Promise<HandoverPhotoInput[]> {
  const photos: HandoverPhotoInput[] = [];
  for (const shot of STANDARD_SHOTS) {
    const file = await oneFile(formData, [`${shot.slot}Camera`, `${shot.slot}File`], shot.label);
    if (file) photos.push({ ...file, slot: shot.slot });
  }
  const damageCamera = await fileFromField(formData, "damageCamera", "damage.jpg");
  if (damageCamera) photos.push({ ...damageCamera, slot: DAMAGE_SHOT });
  for (const value of formData.getAll("damageFiles")) {
    if (typeof value === "string" || !value || value.size === 0) continue;
    photos.push({
      buffer: Buffer.from(await value.arrayBuffer()),
      filename: value.name || "damage.jpg",
      mimeType: value.type || "",
      slot: DAMAGE_SHOT,
    });
  }
  return photos;
}

export async function actionRecordHandover(formData: FormData) {
  const staff = await requireSignedIn();
  const claimId = String(formData.get("claimId") || "");
  try {
    const preScan = await oneFile(formData, ["preScanCamera", "preScan"], "pre-diagnostic scan");
    const postScan = await oneFile(formData, ["postScanCamera", "postScan"], "post-diagnostic scan");
    await recordVehicleHandover({
      claimId,
      eventKind: String(formData.get("eventKind") || ""),
      hireEpisodeId: String(formData.get("hireEpisodeId") || ""),
      mileage: String(formData.get("mileage") || ""),
      fuelLevel: String(formData.get("fuelLevel") || ""),
      spareWheel: String(formData.get("spareWheel") || ""),
      toolsPresent: String(formData.get("toolsPresent") || ""),
      warningLightsOff: String(formData.get("warningLightsOff") || ""),
      tyresLegal: String(formData.get("tyresLegal") || ""),
      conditionNote: String(formData.get("conditionNote") || ""),
      actorId: staff.id,
      photos: await photosFromForm(formData),
      preScan,
      postScan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The handover could not be saved.";
    redirect(`${page(claimId)}${errorQuery(message)}`);
  }
  revalidatePath(page(claimId));
  revalidatePath(`/claims/${claimId}`);
  redirect(`${page(claimId)}?saved=1`);
}

export async function actionAddHandoverPhotos(formData: FormData) {
  const staff = await requireSignedIn();
  const claimId = String(formData.get("claimId") || "");
  const handoverId = String(formData.get("handoverId") || "");
  try {
    await addHandoverPhotographs({
      claimId,
      handoverId,
      actorId: staff.id,
      photos: await photosFromForm(formData),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The photographs could not be added.";
    redirect(`${page(claimId)}${errorQuery(message)}`);
  }
  revalidatePath(page(claimId));
  redirect(`${page(claimId)}?saved=1`);
}

export async function actionAttachHandoverScan(formData: FormData) {
  const staff = await requireSignedIn();
  const claimId = String(formData.get("claimId") || "");
  const handoverId = String(formData.get("handoverId") || "");
  try {
    const file = await oneFile(formData, ["scanCamera", "scan"], "diagnostic scan");
    if (!file) throw new Error("Choose a diagnostic scan file.");
    await attachHandoverScan({
      claimId,
      handoverId,
      actorId: staff.id,
      slot: String(formData.get("slot") || ""),
      file,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The diagnostic scan could not be attached.";
    redirect(`${page(claimId)}${errorQuery(message)}`);
  }
  revalidatePath(page(claimId));
  redirect(`${page(claimId)}?saved=1`);
}

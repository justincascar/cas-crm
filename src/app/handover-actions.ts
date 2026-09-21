"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { addHandoverPhotographs, attachHandoverScan, recordVehicleHandover, type HandoverPhotoInput } from "@/lib/db/handover";
import { errorQuery } from "@/lib/form-validation";

function page(claimId: string) {
  return `/claims/${claimId}/handover`;
}

async function fileFromField(formData: FormData, field: string): Promise<HandoverPhotoInput | null> {
  const value = formData.get(field);
  if (!value || typeof value === "string" || value.size === 0) return null;
  return {
    buffer: Buffer.from(await value.arrayBuffer()),
    filename: value.name || "scan.pdf",
    mimeType: value.type || "",
  };
}

async function photosFromForm(formData: FormData): Promise<HandoverPhotoInput[]> {
  const photos: HandoverPhotoInput[] = [];
  for (const value of formData.getAll("photos")) {
    if (typeof value === "string" || !value || value.size === 0) continue;
    photos.push({
      buffer: Buffer.from(await value.arrayBuffer()),
      filename: value.name || "photo.jpg",
      mimeType: value.type || "",
    });
  }
  return photos;
}

export async function actionRecordHandover(formData: FormData) {
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId") || "");
  try {
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
      preScan: await fileFromField(formData, "preScan"),
      postScan: await fileFromField(formData, "postScan"),
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
  const staff = await requireStaff();
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
  const staff = await requireStaff();
  const claimId = String(formData.get("claimId") || "");
  const handoverId = String(formData.get("handoverId") || "");
  try {
    const file = await fileFromField(formData, "scan");
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

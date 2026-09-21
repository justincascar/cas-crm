"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import {
  attachV5cBuffer,
  createFleetVehicle,
  getFleetVehicle,
  removeFleetVehicle,
  updateFleetVehicle,
} from "@/lib/db/fleet";
import { errorQuery } from "@/lib/form-validation";

function bounce(path: string, error?: string) {
  redirect(error ? `${path}${errorQuery(error)}` : `${path}?saved=1`);
}

function fieldsFromForm(formData: FormData) {
  const engineRaw = String(formData.get("engineCc") || "").trim();
  const seatsRaw = String(formData.get("seats") || "").trim();
  return {
    registration: String(formData.get("registration") || ""),
    make: String(formData.get("make") || ""),
    model: String(formData.get("model") || ""),
    colour: String(formData.get("colour") || ""),
    engineCc: engineRaw ? Number(engineRaw) : null,
    fuel: String(formData.get("fuel") || ""),
    firstRegisteredOn: String(formData.get("firstRegisteredOn") || ""),
    vehicleClass: String(formData.get("vehicleClass") || ""),
    transmission: String(formData.get("transmission") || ""),
    seats: seatsRaw ? Number(seatsRaw) : null,
    location: String(formData.get("location") || ""),
    notes: String(formData.get("notes") || ""),
    gtaGroup: String(formData.get("gtaGroup") || ""),
  };
}

async function v5cFromForm(formData: FormData): Promise<{ buffer: Buffer; filename: string } | null> {
  const value = formData.get("v5c");
  if (!value || typeof value === "string") return null;
  const file = value as File;
  if (!file.size) return null;
  return { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "v5c.pdf" };
}

export async function actionCreateFleetVehicle(formData: FormData) {
  const staff = await requireStaff();
  let id = "";
  try {
    id = createFleetVehicle(fieldsFromForm(formData));
    const vehicle = getFleetVehicle(id);
    const v5c = await v5cFromForm(formData);
    if (vehicle && v5c) {
      attachV5cBuffer({
        fleetVehicleId: id,
        vehicleId: String(vehicle.vehicle_id),
        originalFilename: v5c.filename,
        buffer: v5c.buffer,
        createdBy: staff.id,
      });
    }
  } catch (error) {
    bounce("/hire/new", error instanceof Error ? error.message : "Could not add the vehicle.");
  }
  revalidatePath("/hire");
  redirect(`/hire/${id}?saved=1`);
}

export async function actionUpdateFleetVehicle(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("fleetVehicleId") || "");
  try {
    updateFleetVehicle(id, fieldsFromForm(formData));
    const vehicle = getFleetVehicle(id);
    const v5c = await v5cFromForm(formData);
    if (vehicle && v5c) {
      attachV5cBuffer({
        fleetVehicleId: id,
        vehicleId: String(vehicle.vehicle_id),
        originalFilename: v5c.filename,
        buffer: v5c.buffer,
        createdBy: staff.id,
      });
    }
  } catch (error) {
    bounce(`/hire/${id}`, error instanceof Error ? error.message : "Could not save the vehicle.");
  }
  revalidatePath("/hire");
  revalidatePath(`/hire/${id}`);
  bounce(`/hire/${id}`);
}

export async function actionRemoveFleetVehicle(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("fleetVehicleId") || "");
  const confirmDespiteReservations = String(formData.get("confirmDespiteReservations") || "") === "1";
  const reason = String(formData.get("removedReason") || "");
  try {
    removeFleetVehicle(id, { confirmDespiteReservations, reason });
  } catch (error) {
    bounce(`/hire/${id}`, error instanceof Error ? error.message : "Could not remove the vehicle.");
  }
  revalidatePath("/hire");
  revalidatePath(`/hire/${id}`);
  redirect("/hire?saved=1");
}

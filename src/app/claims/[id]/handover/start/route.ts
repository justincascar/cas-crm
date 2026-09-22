import { NextResponse } from "next/server";
import { browserOrigin } from "@/lib/http/browser-origin";
import { getRequestStaff } from "@/lib/auth/session";
import { handoverEvent, recordVehicleHandover } from "@/lib/db/handover";

function back(origin: string, claimId: string, error?: string) {
  const url = new URL(`/claims/${claimId}/handover`, origin);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);

  try {
    const form = await request.formData();
    const claimId = String(form.get("claimId") || id);
    if (claimId !== id) throw new Error("That handover is not on this file.");
    const vehicle = String(form.get("vehicle") || "");
    const eventKind = String(form.get("eventKind") || "");
    const event = handoverEvent(eventKind);
    if (vehicle !== "hire" && vehicle !== "customer") throw new Error("Choose Hire car or Customer's vehicle.");
    if (!event) throw new Error("Choose what is happening.");
    if (vehicle === "hire" && !event.needsBooking) throw new Error("Choose a hire car handover.");
    if (vehicle === "customer" && event.needsBooking) throw new Error("Choose a customer's vehicle handover.");
    recordVehicleHandover({
      claimId,
      eventKind,
      hireEpisodeId: vehicle === "hire" ? String(form.get("hireEpisodeId") || "") : "",
      mileage: String(form.get("mileage") || ""),
      fuelLevel: String(form.get("fuelLevel") || ""),
      conditionNote: String(form.get("conditionNote") || ""),
      actorId: staff.id,
      photos: [],
      actualDriverId: String(form.get("actualDriverId") || ""),
      actualOccurredAt: String(form.get("actualOccurredAt") || ""),
    });
    const url = new URL(`/claims/${claimId}/handover`, origin);
    url.searchParams.set("saved", "details");
    url.hash = "shot-front";
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The handover could not be saved.";
    return back(origin, id, message);
  }
}

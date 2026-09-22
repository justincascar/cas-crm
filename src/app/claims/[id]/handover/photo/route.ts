import { NextResponse } from "next/server";
import { browserOrigin } from "@/lib/http/browser-origin";
import { getRequestStaff } from "@/lib/auth/session";
import {
  DAMAGE_SHOT,
  addHandoverPhotographs,
  focusAfterShot,
  listVehicleHandovers,
  photoSlot,
} from "@/lib/db/handover";

function fail(origin: string, claimId: string, message: string) {
  const url = new URL(`/claims/${claimId}/handover`, origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);

  let slot = DAMAGE_SHOT;
  try {
    const form = await request.formData();
    const claimId = String(form.get("claimId") || id);
    if (claimId !== id) throw new Error("That handover is not on this file.");
    const handoverId = String(form.get("handoverId") || "");
    slot = photoSlot(String(form.get("slot") || ""));
    const value = form.get("photo");
    if (!value || typeof value === "string" || value.size === 0) {
      throw new Error("The photograph did not arrive. Take it again.");
    }
    const filename = value.name || "photo.jpg";
    await addHandoverPhotographs({
      claimId,
      handoverId,
      actorId: staff.id,
      photos: [
        {
          buffer: Buffer.from(await value.arrayBuffer()),
          filename,
          mimeType: value.type || "",
          slot,
        },
      ],
    });
    const record = listVehicleHandovers(claimId).find((item) => item.id === handoverId);
    const focus = focusAfterShot(slot, (record?.photos || []).map((photo) => photo.slot), record?.shotSet);
    const url = new URL(`/claims/${claimId}/handover`, origin);
    url.searchParams.set("saved", "photo");
    url.hash = `shot-${focus}`;
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The photograph could not be saved.";
    const url = fail(origin, id, message);
    return url;
  }
}

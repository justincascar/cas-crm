import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { addStorageChronologyEntry } from "@/lib/db/storage-chronology";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { recordVehicleMovement } from "@/lib/db/vehicle-movements";
import { browserOrigin } from "@/lib/http/browser-origin";

/** A car movement, or a storage chronology entry. Both are evidence for the recovery and storage charges. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs?notice=office", origin), 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const back = new URL(returnTo.startsWith(`/claims/${id}`) ? returnTo.split("?")[0].split("#")[0] : `/claims/${id}/money/recovery`, origin);
  const text = (name: string) => String(form.get(name) || "");
  try {
    const key = formSubmitKey(form);
    if (!replaySubmit(key)) {
      if (text("kind")) {
        addStorageChronologyEntry({ claimId: id, actorId: staff.id, kind: text("kind"), occurredOn: text("occurredOn"), note: text("note") });
        back.hash = "storage-chronology";
      } else {
        recordVehicleMovement({
          claimId: id,
          actorId: staff.id,
          movedOn: text("movedOn"),
          from: text("from"),
          to: text("to"),
          purpose: text("purpose"),
          necessity: text("necessity"),
        });
        back.hash = "movements";
      }
      storeSubmit(key, { ok: true });
    }
    back.searchParams.set("saved", "1");
  } catch (error) {
    back.searchParams.set("error", error instanceof Error ? error.message : "That was not saved.");
  }
  return NextResponse.redirect(back, 303);
}

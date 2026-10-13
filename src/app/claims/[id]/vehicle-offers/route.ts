import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { recordAgreedRepairInvoice } from "@/lib/db/payment-ledger";
import { confirmTypedVehicleDamageAgreed } from "@/lib/db/total-loss";
import { optionalPoundsToPence } from "@/lib/domain/total-loss";
import {
  markVehicleOffer,
  recordVehicleOffer,
  requireCalendarDate,
  vehicleOfferHead,
} from "@/lib/db/vehicle-offers";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}/heads/vehicle`) ? returnTo : `/claims/${id}/heads/vehicle`;
  const back = (message?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("offerError", message);
    return NextResponse.redirect(url, 303);
  };
  try {
    const head = vehicleOfferHead(id);
    const intent = String(form.get("intent") || "");
    if (intent === "record_offer") {
      const amount = optionalPoundsToPence(String(form.get("amount") || ""));
      if (amount == null || amount <= 0) {
        throw new Error("Enter the amount the insurer offered. It is not taken from the claimed or agreed figure.");
      }
      recordVehicleOffer({
        claimId: id,
        actorId: staff.id,
        head,
        amountPence: amount,
        offeredOn: String(form.get("offeredOn") || ""),
        note: String(form.get("note") || ""),
      });
      return back();
    }
    if (intent === "withdraw" || intent === "lapse" || intent === "reject") {
      markVehicleOffer({
        claimId: id,
        actorId: staff.id,
        head,
        offerId: String(form.get("offerId") || ""),
        status: intent === "withdraw" ? "withdrawn" : intent === "lapse" ? "lapsed" : "rejected",
        note: String(form.get("note") || ""),
      });
      return back();
    }
    if (intent === "record_agreed") {
      const agreed = optionalPoundsToPence(String(form.get("agreed") || ""));
      if (agreed == null) throw new Error("Enter the agreed amount. It is not taken from an offer unless you choose to.");
      const agreedOn = requireCalendarDate(String(form.get("agreedOn") || ""), "the date agreement was reached");
      if (head === "repairs") {
        recordAgreedRepairInvoice({ claimId: id, actorId: staff.id, agreedPence: agreed, agreedOn });
      } else {
        confirmTypedVehicleDamageAgreed({ claimId: id, actorId: staff.id, agreedPence: agreed, agreedOn });
      }
      return back();
    }
    throw new Error("That action is not available on this screen.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The offer could not be saved.";
    return back(message);
  }
}

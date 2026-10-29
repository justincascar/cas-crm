import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { acceptChargeFigure } from "@/lib/db/charge-decision";
import { recordAgreedRepairInvoice } from "@/lib/db/payment-ledger";
import { confirmTypedVehicleDamageAgreed } from "@/lib/db/total-loss";
import { optionalPoundsToPence } from "@/lib/domain/total-loss";
import {
  markVehicleOffer,
  recordSplitOffer,
  recordVehicleOffer,
  requireCalendarDate,
  vehicleOfferHead,
  type VehicleOfferHead,
} from "@/lib/db/vehicle-offers";
import { formSubmitKey, SubmitNeedsConfirm } from "@/lib/db/submit-key";
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
  const allowed = [`/claims/${id}/heads/vehicle`, `/claims/${id}/heads/hire`, `/claims/${id}/heads/storage`, `/claims/${id}/heads/recovery`];
  const safeReturn = allowed.some((prefix) => returnTo.startsWith(prefix)) ? returnTo : `/claims/${id}/heads/vehicle`;
  const back = (message?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("offerError", message);
    return NextResponse.redirect(url, 303);
  };
  try {
    const head = postedOfferHead(form.get("head"), vehicleOfferHead(id));
    const intent = String(form.get("intent") || "");
    if (intent === "record_offer") {
      const amount = optionalPoundsToPence(String(form.get("amount") || ""));
      if (amount == null || amount <= 0) {
        throw new Error("Enter the amount the insurer offered. It is not taken from the claimed or agreed figure.");
      }
      if (form.get("multiHead") === "yes") {
        const vehicle = vehicleOfferHead(id);
        const part = (name: string) => optionalPoundsToPence(String(form.get(name) || "")) || 0;
        recordSplitOffer({
          claimId: id,
          actorId: staff.id,
          totalPence: amount,
          offeredOn: String(form.get("offeredOn") || ""),
          note: String(form.get("note") || ""),
          parts: [
            { head: vehicle, pence: part("split_vehicle") },
            { head: "recovery", pence: part("split_recovery") },
            { head: "storage", pence: part("split_storage") },
            { head: "hire", pence: part("split_hire") },
          ],
          submitKey: formSubmitKey(form),
        });
        return back();
      }
      const offeredDays = optionalWholeNumber(String(form.get("offeredDays") || ""), "offered days");
      const offeredDailyRatePence = optionalPoundsToPence(String(form.get("offeredDailyRate") || ""));
      recordVehicleOffer({
        claimId: id,
        actorId: staff.id,
        head,
        amountPence: amount,
        offeredOn: String(form.get("offeredOn") || ""),
        note: String(form.get("note") || ""),
        offeredDays,
        offeredDailyRatePence,
        submitKey: formSubmitKey(form),
        confirmDuplicate: String(form.get("confirmDuplicate") || "") === "yes",
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
      if (head === "hire" || head === "storage" || head === "recovery") {
        acceptChargeFigure({
          claimId: id,
          actorId: staff.id,
          role: staff.role,
          head,
          agreedPence: agreed,
          submitKey: formSubmitKey(form),
        });
      } else if (head === "repairs") {
        recordAgreedRepairInvoice({
          claimId: id,
          actorId: staff.id,
          agreedPence: agreed,
          agreedOn,
          submitKey: formSubmitKey(form),
        });
      } else {
        confirmTypedVehicleDamageAgreed({
          claimId: id,
          actorId: staff.id,
          agreedPence: agreed,
          agreedOn,
          submitKey: formSubmitKey(form),
        });
      }
      return back();
    }
    throw new Error("That action is not available on this screen.");
  } catch (error) {
    if (error instanceof SubmitNeedsConfirm) {
      const url = new URL(safeReturn, origin);
      url.searchParams.set("offerWarn", error.message);
      url.searchParams.set("offerAmount", String(form.get("amount") || ""));
      url.searchParams.set("offerOn", String(form.get("offeredOn") || ""));
      url.searchParams.set("offerNote", String(form.get("note") || ""));
      url.searchParams.set("offerHead", String(form.get("head") || ""));
      url.searchParams.set("offerDays", String(form.get("offeredDays") || ""));
      url.searchParams.set("offerRate", String(form.get("offeredDailyRate") || ""));
      url.searchParams.set("returnTo", safeReturn);
      return NextResponse.redirect(url, 303);
    }
    const message = error instanceof Error ? error.message : "The offer could not be saved.";
    return back(message);
  }
}

function postedOfferHead(value: FormDataEntryValue | null, fallback: VehicleOfferHead): VehicleOfferHead {
  const posted = String(value || "");
  if (posted === "hire" || posted === "storage" || posted === "recovery" || posted === "repairs" || posted === "vehicle_damage") {
    return posted;
  }
  return fallback;
}

function optionalWholeNumber(raw: string, label: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Enter the ${label} as a whole number, or leave it blank.`);
  return n;
}

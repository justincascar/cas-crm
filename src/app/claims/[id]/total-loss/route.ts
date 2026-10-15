import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { markTotalLossPaymentChaseSent, prepareTotalLossPaymentChaseEmail } from "@/lib/db/follow-up-chases";
import { confirmTotalLossOffHire } from "@/lib/db/total-loss-off-hire";
import {
  confirmInsurerSendingPayment,
  confirmTotalLossSuggestion,
  confirmTypedVehicleDamageAgreed,
  markTotalLossNoticeSent,
  prepareTotalLossInsurerEmail,
  recordTotalLossPaymentReceived,
  saveTotalLossReport,
} from "@/lib/db/total-loss";
import { optionalPoundsToPence, type CasSalvageRequest, type InsurerSalvageInterest, type SalvageDisposal } from "@/lib/domain/total-loss";
import { requireCalendarDate } from "@/lib/db/vehicle-offers";
import { formVersion, postedVersion, withSectionSave } from "@/lib/db/record-version";
import { formSubmitKey, SubmitNeedsConfirm } from "@/lib/db/submit-key";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

function interestOf(raw: string): InsurerSalvageInterest | null {
  if (raw === "no_interest" || raw === "takes_interest") return raw;
  return null;
}

function disposalOf(raw: string): SalvageDisposal | null {
  if (raw === "sold" || raw === "returned" || raw === "bought_by_cas") return raw;
  return null;
}

function requestOf(raw: string): CasSalvageRequest | null {
  if (raw === "full_pav" || raw === "net_cas") return raw;
  return null;
}

function optionalAgreedOn(form: FormData): string | undefined {
  if (!form.has("agreedOn")) return undefined;
  const raw = String(form.get("agreedOn") || "").trim();
  if (!raw) return undefined;
  return requireCalendarDate(raw, "the date agreement was reached");
}

function dateOrNull(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Enter the return date as a calendar day.");
  return text;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}`;
  const back = (message?: string, mailId?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("tlError", message);
    if (mailId) url.searchParams.set("tlMail", mailId);
    return NextResponse.redirect(url, 303);
  };
  try {
    const intent = String(form.get("intent") || "save");
    if (intent === "confirm_suggestion" && !form.has("pav")) {
      confirmTotalLossSuggestion({ claimId: id, actorId: staff.id, agreedOn: optionalAgreedOn(form) });
      return back();
    }
    if (intent === "confirm_agreed" && !form.has("pav")) {
      const agreedOnly = optionalPoundsToPence(String(form.get("agreed") || ""));
      if (agreedOnly == null) throw new Error("Enter the agreed amount, or use the suggestion button.");
      confirmTypedVehicleDamageAgreed({
        claimId: id,
        actorId: staff.id,
        agreedPence: agreedOnly,
        agreedOn: optionalAgreedOn(form),
        submitKey: formSubmitKey(form),
      });
      return back();
    }
    if (intent === "mark_sent") {
      markTotalLossNoticeSent({
        claimId: id,
        correspondenceId: String(form.get("correspondenceId") || ""),
        actorId: staff.id,
      });
      return back();
    }
    if (intent === "promise_payment") {
      confirmInsurerSendingPayment({ claimId: id, actorId: staff.id });
      return back();
    }
    if (intent === "confirm_off_hire") {
      const choice = String(form.get("choice") || "");
      if (choice !== "suggested" && choice !== "keep") throw new Error("Choose whether to use the suggested hire end or keep the date already on the file.");
      confirmTotalLossOffHire({
        claimId: id,
        actorId: staff.id,
        choice,
        hireEndVersion: postedVersion(form, "hireEndVersion"),
      });
      return back();
    }
    if (intent === "record_payment") {
      const received = optionalPoundsToPence(String(form.get("received") || ""));
      if (received == null || received <= 0) throw new Error("Enter the amount that has arrived.");
      recordTotalLossPaymentReceived({
        claimId: id,
        actorId: staff.id,
        receivedPence: received,
        submitKey: formSubmitKey(form),
        confirmSeparate: String(form.get("confirmSeparate") || "") === "yes",
      });
      return back();
    }
    if (intent === "prepare_payment_chase") {
      const prepared = prepareTotalLossPaymentChaseEmail({ claimId: id, actorId: staff.id });
      return back(undefined, prepared.id);
    }
    if (intent === "mark_payment_chase_sent") {
      markTotalLossPaymentChaseSent({
        claimId: id,
        correspondenceId: String(form.get("correspondenceId") || ""),
        actorId: staff.id,
      });
      return back();
    }
    const interest = interestOf(String(form.get("interest") || ""));
    const disposal = disposalOf(String(form.get("disposal") || ""));
    const offerRaw = String(form.get("insurerOffer") || "");
    const applyDisposal = interest === "no_interest";
    const submitted = {
      pav: String(form.get("pav") || ""),
      salvage: String(form.get("salvage") || ""),
      interest: String(form.get("interest") || ""),
      insurerOffer: offerRaw,
    };
    withSectionSave({
      scope: "total-loss",
      recordKey: id,
      expected: formVersion(form),
      actorId: staff.id,
      submitted,
      labels: {
        pav: "Pre-accident value",
        salvage: "Salvage",
        interest: "Insurer interest in salvage",
        insurerOffer: "Insurer offer",
      },
      fields: submitted,
      write: () =>
        saveTotalLossReport({
          claimId: id,
          actorId: staff.id,
          pavPence: optionalPoundsToPence(submitted.pav),
          salvagePence: optionalPoundsToPence(submitted.salvage),
          interest,
          insurerOfferedPence: offerRaw.trim() ? optionalPoundsToPence(offerRaw) : undefined,
          disposal: applyDisposal ? disposal : null,
          saleProceedsPence: applyDisposal && disposal === "sold" ? optionalPoundsToPence(String(form.get("saleProceeds") || "")) : undefined,
          returnedOn: applyDisposal && disposal === "returned" ? dateOrNull(String(form.get("returnedOn") || "")) : undefined,
          customerChargePence:
            applyDisposal && disposal === "returned" ? optionalPoundsToPence(String(form.get("customerCharge") || "")) : undefined,
          casPurchasePence: applyDisposal && disposal === "bought_by_cas" ? optionalPoundsToPence(String(form.get("casPurchase") || "")) : undefined,
          casRequest: requestOf(String(form.get("casRequest") || "")),
        }),
    });
    if (intent === "prepare_email") {
      const prepared = prepareTotalLossInsurerEmail({ claimId: id, actorId: staff.id });
      return back(undefined, prepared.id);
    }
    if (intent === "confirm_suggestion") {
      confirmTotalLossSuggestion({ claimId: id, actorId: staff.id, agreedOn: optionalAgreedOn(form) });
    } else if (intent === "confirm_agreed") {
      const agreed = optionalPoundsToPence(String(form.get("agreed") || ""));
      if (agreed == null) throw new Error("Enter the agreed amount, or use the suggestion button.");
      confirmTypedVehicleDamageAgreed({
        claimId: id,
        actorId: staff.id,
        agreedPence: agreed,
        agreedOn: optionalAgreedOn(form),
        submitKey: formSubmitKey(form),
      });
    }
    return back();
  } catch (error) {
    if (error instanceof SubmitNeedsConfirm) {
      const url = new URL(safeReturn, origin);
      url.searchParams.set("payWarn", error.message);
      url.searchParams.set("payAmount", String(form.get("received") || ""));
      return NextResponse.redirect(url, 303);
    }
    const refused = clashRedirect(origin, safeReturn, error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message : "The total-loss figures could not be saved.";
    return back(message);
  }
}

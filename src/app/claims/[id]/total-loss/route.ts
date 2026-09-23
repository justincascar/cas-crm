import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { confirmTotalLossSuggestion, confirmTypedVehicleDamageAgreed, saveTotalLossReport } from "@/lib/db/total-loss";
import { optionalPoundsToPence, type InsurerSalvageInterest, type SalvageDisposal } from "@/lib/domain/total-loss";
import { browserOrigin } from "@/lib/http/browser-origin";

function interestOf(raw: string): InsurerSalvageInterest | null {
  if (raw === "no_interest" || raw === "takes_interest") return raw;
  return null;
}

function disposalOf(raw: string): SalvageDisposal | null {
  if (raw === "sold" || raw === "returned" || raw === "bought_by_cas") return raw;
  return null;
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
  const back = (message?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("tlError", message);
    return NextResponse.redirect(url, 303);
  };
  try {
    const interest = interestOf(String(form.get("interest") || ""));
    const disposal = disposalOf(String(form.get("disposal") || ""));
    const offerRaw = String(form.get("insurerOffer") || "");
    const applyDisposal = interest === "no_interest";
    saveTotalLossReport({
      claimId: id,
      actorId: staff.id,
      pavPence: optionalPoundsToPence(String(form.get("pav") || "")),
      salvagePence: optionalPoundsToPence(String(form.get("salvage") || "")),
      interest,
      insurerOfferedPence: offerRaw.trim() ? optionalPoundsToPence(offerRaw) : undefined,
      disposal: applyDisposal ? disposal : null,
      saleProceedsPence: applyDisposal && disposal === "sold" ? optionalPoundsToPence(String(form.get("saleProceeds") || "")) : undefined,
      returnedOn: applyDisposal && disposal === "returned" ? dateOrNull(String(form.get("returnedOn") || "")) : undefined,
      customerChargePence:
        applyDisposal && disposal === "returned" ? optionalPoundsToPence(String(form.get("customerCharge") || "")) : undefined,
      casPurchasePence: applyDisposal && disposal === "bought_by_cas" ? optionalPoundsToPence(String(form.get("casPurchase") || "")) : undefined,
    });
    const intent = String(form.get("intent") || "save");
    if (intent === "confirm_suggestion") {
      confirmTotalLossSuggestion({ claimId: id, actorId: staff.id });
    } else if (intent === "confirm_agreed") {
      const agreed = optionalPoundsToPence(String(form.get("agreed") || ""));
      if (agreed == null) throw new Error("Enter the agreed amount, or use the suggestion button.");
      confirmTypedVehicleDamageAgreed({ claimId: id, actorId: staff.id, agreedPence: agreed });
    }
    return back();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The total-loss figures could not be saved.";
    return back(message);
  }
}

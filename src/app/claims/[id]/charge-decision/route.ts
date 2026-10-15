import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { acceptChargeFigure, disputeCharge, proposeChargeAcceptance, type ChargeHead } from "@/lib/db/charge-decision";
import { formVersion } from "@/lib/db/record-version";
import { optionalPoundsToPence } from "@/lib/domain/total-loss";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const head = postedHead(form.get("head"));
  const backTo = new URL(`/claims/${id}/heads/${head || "hire"}`, origin);
  if (!head) {
    backTo.searchParams.set("decisionError", "That charge is not on this screen.");
    return NextResponse.redirect(backTo, 303);
  }
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "accept" || intent === "propose") {
      const agreed = optionalPoundsToPence(String(form.get("agreed") || ""));
      if (agreed == null || agreed <= 0) throw new Error("Enter the agreed amount. It is not taken from the claimed figure.");
      if (intent === "propose") {
        proposeChargeAcceptance({ claimId: id, actorId: staff.id, role: staff.role, head, agreedPence: agreed });
      } else {
        acceptChargeFigure({
          claimId: id,
          actorId: staff.id,
          role: staff.role,
          head,
          agreedPence: agreed,
          expectedVersion: formVersion(form),
        });
      }
    } else if (intent === "dispute") {
      const words = String(form.get("reason") || "").trim();
      const preset = String(form.get("preset") || "").trim();
      disputeCharge({ claimId: id, actorId: staff.id, role: staff.role, head, reason: words || preset });
    } else {
      throw new Error("That action is not available on this screen.");
    }
    return NextResponse.redirect(backTo, 303);
  } catch (error) {
    const refused = clashRedirect(origin, `/claims/${id}/heads/${head}`, error);
    if (refused) return refused;
    backTo.searchParams.set("decisionError", error instanceof Error ? error.message : "The decision could not be saved.");
    return NextResponse.redirect(backTo, 303);
  }
}

function postedHead(value: FormDataEntryValue | null): ChargeHead | null {
  const posted = String(value || "");
  if (posted === "hire" || posted === "storage" || posted === "recovery") return posted;
  return null;
}

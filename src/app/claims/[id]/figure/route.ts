import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { keepStoredFigure, useCalculatedFigure, type FigureHead } from "@/lib/db/figure-resolution";
import { browserOrigin } from "@/lib/http/browser-origin";

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
    backTo.searchParams.set("figureError", "That charge is not on this screen.");
    return NextResponse.redirect(backTo, 303);
  }
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "use_calculated") {
      useCalculatedFigure({ claimId: id, actorId: staff.id, role: staff.role, head });
    } else if (intent === "keep_stored") {
      keepStoredFigure({ claimId: id, actorId: staff.id, role: staff.role, head, reason: String(form.get("reason") || "") });
    } else {
      throw new Error("That action is not available on this screen.");
    }
    return NextResponse.redirect(backTo, 303);
  } catch (error) {
    backTo.searchParams.set("figureError", error instanceof Error ? error.message : "The figure could not be saved.");
    return NextResponse.redirect(backTo, 303);
  }
}

function postedHead(value: FormDataEntryValue | null): FigureHead | null {
  const posted = String(value || "");
  if (posted === "hire" || posted === "storage" || posted === "recovery") return posted;
  return null;
}

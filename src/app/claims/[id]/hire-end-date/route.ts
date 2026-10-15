import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { confirmHireEndDate } from "@/lib/db/hire-collection-date";
import { formVersion, withSectionSave } from "@/lib/db/record-version";
import { browserOrigin } from "@/lib/http/browser-origin";
import { clashRedirect } from "@/lib/http/version-clash";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const fallback = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(fallback, 303);
  const form = await request.formData();
  const choice = String(form.get("choice") || "");
  const episodeId = String(form.get("episodeId") || "");
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}`;
  if ((choice === "job" || choice === "file") && episodeId) {
    try {
      withSectionSave({
        scope: "hire-end",
        recordKey: episodeId,
        expected: formVersion(form),
        actorId: staff.id,
        submitted: { choice },
        labels: { choice: "Hire end" },
        fields: { choice },
        write: () => confirmHireEndDate({ claimId: id, episodeId, choice, actorId: staff.id }),
      });
    } catch (error) {
      const refused = clashRedirect(origin, safeReturn, error);
      if (refused) return refused;
      const url = new URL(safeReturn, origin);
      url.searchParams.set("error", error instanceof Error ? error.message : "The hire end could not be saved.");
      return NextResponse.redirect(url, 303);
    }
  }
  const url = new URL(safeReturn, origin);
  url.searchParams.set("hireEnd", "1");
  return NextResponse.redirect(url, 303);
}

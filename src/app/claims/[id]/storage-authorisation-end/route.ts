import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { confirmStorageAuthorisationEnd } from "@/lib/db/storage-authorisation-end";
import { formVersion, postedVersion, withSectionSave } from "@/lib/db/record-version";
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
  const returnTo = String(form.get("returnTo") || "");
  const safeReturn = returnTo.startsWith(`/claims/${id}`) ? returnTo : `/claims/${id}`;
  const back = (message?: string) => {
    const url = new URL(safeReturn, origin);
    if (message) url.searchParams.set("error", message);
    return NextResponse.redirect(url, 303);
  };
  if (choice !== "suggested" && choice !== "keep") return back("Choose whether to use the authorisation date or keep the date already on the file.");
  try {
    withSectionSave({
      scope: "storage-auth-end",
      recordKey: id,
      expected: formVersion(form),
      actorId: staff.id,
      submitted: { choice },
      labels: { choice: "Storage authorisation end" },
      fields: { choice },
      write: () =>
        confirmStorageAuthorisationEnd({
          claimId: id,
          actorId: staff.id,
          choice,
          storageEndVersion: postedVersion(form, "storageEndVersion"),
        }),
    });
  } catch (error) {
    const refused = clashRedirect(origin, safeReturn, error);
    if (refused) return refused;
    const message = error instanceof Error ? error.message : "Could not confirm the storage end.";
    return back(message);
  }
  return back();
}

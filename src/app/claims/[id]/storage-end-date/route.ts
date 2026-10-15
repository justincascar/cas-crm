import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { confirmStorageEndDate } from "@/lib/db/storage-recovery-date";
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
  if (choice === "job" || choice === "file") {
    try {
      withSectionSave({
        scope: "storage-end-date",
        recordKey: id,
        expected: formVersion(form),
        actorId: staff.id,
        submitted: { choice },
        labels: { choice: "Storage end" },
        fields: { choice },
        write: () =>
          confirmStorageEndDate({
            claimId: id,
            choice,
            actorId: staff.id,
            storageEndVersion: postedVersion(form, "storageEndVersion"),
          }),
      });
    } catch (error) {
      const refused = clashRedirect(origin, safeReturn, error);
      if (refused) return refused;
      const url = new URL(safeReturn, origin);
      url.searchParams.set("error", error instanceof Error ? error.message : "The storage end could not be saved.");
      return NextResponse.redirect(url, 303);
    }
  }
  const url = new URL(safeReturn, origin);
  url.searchParams.set("storageEnd", "1");
  return NextResponse.redirect(url, 303);
}

import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { formLoaded, formVersion, pathWithClash, VersionConflictError } from "@/lib/db/record-version";
import { saveScreenData } from "@/lib/db/screens";
import { syncStorageClaimed } from "@/lib/db/storage-charge";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = (message?: string) => {
    const url = new URL(`/claims/${id}/heads/storage`, origin);
    if (message) url.searchParams.set("error", message);
    else url.searchParams.set("saved", "1");
    return NextResponse.redirect(url, 303);
  };
  const values: Record<string, string> = {
    name: String(form.get("name") || ""),
    address: String(form.get("address") || ""),
    postcode: String(form.get("postcode") || ""),
    telMain: String(form.get("telMain") || ""),
    email: String(form.get("email") || ""),
    ref: String(form.get("ref") || ""),
    invoiceNo: String(form.get("invoiceNo") || ""),
    startDate: String(form.get("startDate") || ""),
  };
  if (form.has("endDate")) values.endDate = String(form.get("endDate") || "");
  if (form.has("endDateReason")) values.endDateReason = String(form.get("endDateReason") || "");
  try {
    saveScreenData(id, "storage", values, staff.id, formVersion(form), formLoaded(form));
    syncStorageClaimed(id);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.redirect(new URL(pathWithClash(`/claims/${id}/heads/storage`, error), origin), 303);
    }
    const message = error instanceof Error ? error.message : "Could not save storage.";
    return back(message);
  }
  return back();
}

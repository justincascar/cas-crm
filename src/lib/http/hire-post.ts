import { NextResponse } from "next/server";
import { isOfficeRole } from "../auth/roles";
import { getRequestStaff } from "../auth/session";
import { pathWithClash, VersionConflictError } from "../db/record-version";
import { formSubmitKey, replaySubmit } from "../db/submit-key";
import { browserOrigin } from "./browser-origin";

export async function officeHirePost(
  request: Request,
  context: { params: Promise<{ id: string }> },
  work: (
    input: { id: string; staffId: string; staffRole: string; form: FormData; key: string },
  ) => void | { hash?: string } | Promise<void | { hash?: string }>,
) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = (error?: string) => {
    const url = new URL(`/claims/${id}/hire`, origin);
    if (error) url.searchParams.set("error", error.slice(0, 500));
    else url.searchParams.set("saved", "1");
    const hash = String(form.get("returnHash") || "");
    if (hash.startsWith("#")) url.hash = hash;
    return NextResponse.redirect(url, 303);
  };
  try {
    const key = formSubmitKey(form);
    if (replaySubmit(key)) return back();
    const outcome = await work({ id, staffId: staff.id, staffRole: staff.role, form, key });
    if (outcome?.hash) {
      const url = new URL(`/claims/${id}/hire`, origin);
      url.searchParams.set("saved", "1");
      url.hash = outcome.hash;
      return NextResponse.redirect(url, 303);
    }
    return back();
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.redirect(new URL(pathWithClash(`/claims/${id}/hire`, error), origin), 303);
    }
    return back(error instanceof Error ? error.message : "That could not be saved.");
  }
}

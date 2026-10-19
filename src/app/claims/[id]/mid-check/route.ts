import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { nowUtcIso } from "@/lib/dates";
import { newId, run } from "@/lib/db/connection";
import { recordClaimEvent } from "@/lib/db/chronology";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  const { id } = await context.params;
  const back = new URL(`/claims/${id}`, origin);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const result = String(form.get("midResult") || "").trim();
  const registration = String(form.get("midRegistration") || "").trim();
  if (!registration || !result) {
    back.searchParams.set("error", "Enter the registration searched and the result from the manual askMID check.");
    return NextResponse.redirect(back, 303);
  }
  const insurer = result === "no_record" ? "No record found" : String(form.get("midInsurerName") || "").trim();
  const policy = String(form.get("midPolicy") || "").trim();
  const now = nowUtcIso();
  run(
    `INSERT INTO mid_lookups(id, claim_id, registration, accident_on, lookup_on, insurer, checker_id, evidence, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
    [
      newId("mid"),
      id,
      registration,
      String(form.get("midAccidentOn") || "") || null,
      String(form.get("midCheckedOn") || "") || now,
      insurer || null,
      staff.id,
      result === "no_record"
        ? "Manual askMID check. No record found. Not scraped."
        : `Manual askMID check. Insurer ${insurer || "not stated"}. Policy ${policy || "not stated"}. Not scraped.`,
    ],
  );
  recordClaimEvent({
    claimId: id,
    eventType: "other",
    occurredAt: now,
    details:
      result === "no_record"
        ? "Manual askMID check recorded. No record found. The CRM did not look this up."
        : `Manual askMID check recorded. ${insurer || "Insurer not stated"}. Policy ${policy || "not stated"}. The CRM did not look this up.`,
    actorId: staff.id,
    source: "staff",
  });
  back.searchParams.set("saved", "mid");
  return NextResponse.redirect(back, 303);
}

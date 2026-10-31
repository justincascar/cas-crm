import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeClaimDocument } from "@/lib/db/claim-documents";
import { logEngineerReportReceived } from "@/lib/db/chronology";
import { readReportOutcome, saveReportOutcome } from "@/lib/db/report-outcome";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { browserOrigin } from "@/lib/http/browser-origin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "");
  const safe = returnTo.startsWith(`/claims/${id}`) && !returnTo.includes("..") ? returnTo.split("?")[0] : `/claims/${id}`;
  const back = (error?: string) => {
    const url = new URL(safe, origin);
    if (error) url.searchParams.set("stepError", error);
    else url.searchParams.set("stepSaved", "report");
    return NextResponse.redirect(url, 303);
  };
  try {
    const key = formSubmitKey(form);
    if (replaySubmit(key)) return back();
    const occurredOn = String(form.get("occurredOn") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error("Enter the date the report was received.");
    // R32: the outcome and its figures are checked before anything is saved.
    const text = (name: string) => String(form.get(name) || "");
    const outcome = {
      claimId: id,
      actorId: staff.id,
      outcome: text("outcome"),
      estimateNet: text("estimateNet"),
      estimateVat: text("estimateVat"),
      estimateGross: text("estimateGross"),
      pav: text("pav"),
      salvageCategory: text("salvageCategory"),
      salvageDeduction: text("salvageDeduction"),
    };
    readReportOutcome(outcome);
    const uploaded = form.get("document");
    if (uploaded instanceof File && uploaded.size > 0) {
      const buffer = Buffer.from(await uploaded.arrayBuffer());
      storeClaimDocument({
        claimId: id,
        actorId: staff.id,
        actorRole: staff.role,
        documentType: "engineer_report",
        file: { buffer, filename: uploaded.name, mimeType: uploaded.type },
      });
    }
    logEngineerReportReceived({ claimId: id, actorId: staff.id, occurredAt: occurredOn });
    saveReportOutcome({ ...outcome, occurredOn });
    storeSubmit(key, { ok: true });
    return back();
  } catch (error) {
    return back(error instanceof Error ? error.message : "The report could not be recorded.");
  }
}

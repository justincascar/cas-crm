import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { storeClaimDocument } from "@/lib/db/claim-documents";
import {
  recordAudatexEstimate,
  confirmRepairableHireEnd,
  recordCarReturnedByHand,
  recordClientExcessPaid,
  recordEngineerInstructedByHand,
  recordFaultCarReturn,
  recordFaultInvoice,
  recordInspectionRoute,
  recordOwnInsurerNotified,
  recordRepairAuthorisedByHand,
  recordRepairMilestoneByHand,
  recordReportSentByHand,
} from "@/lib/db/claim-step-record";
import { formSubmitKey, replaySubmit, storeSubmit } from "@/lib/db/submit-key";
import { confirmStorageAuthorisationEnd } from "@/lib/db/storage-authorisation-end";
import { confirmTotalLossOffHire } from "@/lib/db/total-loss-off-hire";
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
    else url.searchParams.set("stepSaved", "1");
    return NextResponse.redirect(url, 303);
  };
  try {
    const key = formSubmitKey(form);
    if (replaySubmit(key)) return back();
    const intent = String(form.get("intent") || "");
    const text = (name: string) => String(form.get(name) || "");
    if (intent === "route") {
      recordInspectionRoute({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        route: text("route"),
        occurredOn: text("occurredOn"),
      });
    } else if (intent === "audatex_sent" || intent === "audatex_received" || intent === "audatex_auth") {
      let documentId: string | null = null;
      const uploaded = form.get("document");
      if (uploaded instanceof File && uploaded.size > 0) {
        const buffer = Buffer.from(await uploaded.arrayBuffer());
        const stored = storeClaimDocument({
          claimId: id,
          actorId: staff.id,
          actorRole: staff.role,
          documentType: "other",
          file: { buffer, filename: uploaded.name, mimeType: uploaded.type },
        });
        documentId = stored.id;
      }
      recordAudatexEstimate({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        kind: intent === "audatex_sent" ? "sent" : intent === "audatex_received" ? "received" : "authorised",
        occurredOn: text("occurredOn"),
        reference: text("reference"),
        estimate: text("estimate"),
        labour: text("labour"),
        parts: text("parts"),
        paint: text("paint"),
        authorised: text("authorised"),
        hourly: text("hourly"),
        hourlyNote: text("hourlyNote"),
        times: text("times"),
        timesNote: text("timesNote"),
        partsReduction: text("partsReduction"),
        partsNote: text("partsNote"),
        other: text("other"),
        otherNote: text("otherNote"),
        documentId,
      });
    } else if (intent === "engineer_instructed") {
      recordEngineerInstructedByHand({ claimId: id, actorId: staff.id, role: staff.role, occurredOn: text("occurredOn") });
    } else if (intent === "report_sent") {
      recordReportSentByHand({ claimId: id, actorId: staff.id, role: staff.role, occurredOn: text("occurredOn") });
    } else if (intent === "authorisation") {
      recordRepairAuthorisedByHand({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        occurredOn: text("occurredOn"),
        authorised: text("authorised"),
        reduction: text("reduction"),
        reductionNote: text("reductionNote"),
      });
    } else if (intent === "repairs_started" || intent === "repairs_complete") {
      recordRepairMilestoneByHand({ claimId: id, actorId: staff.id, role: staff.role, occurredOn: text("occurredOn"), milestone: intent });
    } else if (intent === "car_returned") {
      recordCarReturnedByHand({ claimId: id, actorId: staff.id, role: staff.role, occurredOn: text("occurredOn") });
    } else if (intent === "hire_end") {
      confirmRepairableHireEnd({ claimId: id, actorId: staff.id, role: staff.role, occurredOn: text("occurredOn") });
    } else if (intent === "storage_end") {
      confirmStorageAuthorisationEnd({ claimId: id, actorId: staff.id, choice: "suggested" });
    } else if (intent === "tl_off_hire") {
      confirmTotalLossOffHire({ claimId: id, actorId: staff.id, choice: "suggested" });
    } else if (intent === "own_insurer") {
      recordOwnInsurerNotified({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        occurredOn: text("occurredOn"),
        claimNumber: text("claimNumber"),
        note: text("note"),
      });
    } else if (intent === "excess") {
      recordClientExcessPaid({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        occurredOn: text("occurredOn"),
        amount: text("amount"),
        method: text("method"),
      });
    } else if (intent === "return") {
      recordFaultCarReturn({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        occurredOn: text("occurredOn"),
        reason: text("reason"),
      });
    } else if (intent === "invoice" || intent === "invoice_paid") {
      recordFaultInvoice({
        claimId: id,
        actorId: staff.id,
        role: staff.role,
        occurredOn: text("occurredOn"),
        kind: intent === "invoice" ? "sent" : "paid",
      });
    } else {
      throw new Error("That step could not be saved.");
    }
    storeSubmit(key, { ok: true });
    return back();
  } catch (error) {
    return back(error instanceof Error ? error.message : "The step could not be saved.");
  }
}

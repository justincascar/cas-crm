import { NextResponse } from "next/server";
import { isOfficeRole } from "@/lib/auth/roles";
import { getRequestStaff } from "@/lib/auth/session";
import { sendClaimEmail } from "@/lib/db/chronology";
import { all, get } from "@/lib/db/connection";
import { formSubmitKey } from "@/lib/db/submit-key";
import { recordTotalLossStepNine, resolveValuationDispute, sendValuationToClient, sendValuationToInsurer } from "@/lib/db/total-loss-steps";
import { ENGINEER_REPORT_DOCUMENT_TYPE } from "@/lib/domain/repair-progress";
import { browserOrigin } from "@/lib/http/browser-origin";

function pence(raw: FormDataEntryValue | null): number | null {
  const text = String(raw || "").replace(/[£,\s]/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Enter amounts in pounds and pence, for example 1250.00.");
  return Math.round(Number(text) * 100);
}

/** R66: steps 7 to 9 done on the card (total loss), and the repairable report sent to the insurer in one click. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = browserOrigin(request);
  const staff = await getRequestStaff();
  if (!staff) return NextResponse.redirect(new URL("/login", origin), 303);
  if (!isOfficeRole(staff.role)) return NextResponse.redirect(new URL("/jobs", origin), 303);
  const form = await request.formData();
  const back = new URL(`/claims/${id}`, origin);
  const intent = String(form.get("intent") || "");
  back.hash = intent === "step9" ? "step-finish" : intent === "send_insurer" || intent === "send_report" ? "step-send_report" : "step-agree";
  try {
    let said = "";
    if (intent === "send_client") {
      const sent = await sendValuationToClient({ claimId: id, actorId: staff.id, to: String(form.get("to") || ""), attachReport: form.get("attachReport") === "yes", origin });
      said = `Valuation sent to the client with a signing link${sent.simulated ? " (simulated: the mailbox is not connected)" : ""}.`;
    } else if (intent === "resolve_dispute") {
      resolveValuationDispute({ claimId: id, actorId: staff.id, note: String(form.get("note") || "") });
      said = "Dispute marked resolved. Send the client a new valuation, or record what was agreed.";
    } else if (intent === "send_insurer") {
      const sent = await sendValuationToInsurer({ claimId: id, actorId: staff.id, to: String(form.get("to") || ""), cc: String(form.get("cc") || "") });
      said = `Valuation sent to the insurer${sent.simulated ? " (simulated: the mailbox is not connected)" : ""}. The payment chase has started.`;
    } else if (intent === "step9") {
      said = recordTotalLossStepNine({
        claimId: id,
        actorId: staff.id,
        paymentPence: pence(form.get("payment")),
        submitKey: formSubmitKey(form),
        salvageCollectedOn: String(form.get("salvageCollectedOn") || ""),
        proceedsPence: pence(form.get("proceeds")),
      });
    } else if (intent === "send_report") {
      const to = String(form.get("to") || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter the insurer's email address.");
      const reports = all<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND document_type = ? ORDER BY created_at DESC LIMIT 1`, [id, ENGINEER_REPORT_DOCUMENT_TYPE]).map((row) => String(row.id));
      if (!reports.length) throw new Error("No engineer's report on the file yet. Upload it at step 6.");
      const claim = get<{ file_reference: string }>(`SELECT file_reference FROM claims WHERE id = ?`, [id]);
      const sent = await sendClaimEmail({
        claimId: id,
        actorId: staff.id,
        to,
        subject: `Engineer's report and estimate — ${claim?.file_reference || ""}`,
        body: `Please find attached the engineer's report and repair estimate for our client's vehicle. Please quote our reference ${claim?.file_reference || ""} on all correspondence.\n\nComplete Accident Solutions Ltd`,
        attachmentIds: reports,
      });
      if (!sent.ok) throw new Error(sent.error || "It was not sent.");
      said = sent.status === "sent" ? `Report and estimate sent to ${to}.` : `Report and estimate filed as an email to ${to} (simulated). ${sent.engineerReportNotice || "A simulated send is not recorded as sent."}`;
    } else {
      throw new Error("Nothing was changed.");
    }
    back.searchParams.set("stepDone", said.slice(0, 600));
  } catch (error) {
    back.searchParams.set("stepError", (error instanceof Error ? error.message : "Nothing was changed.").slice(0, 500));
  }
  return NextResponse.redirect(back, 303);
}

import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { ENGINEER_REPORT_DOCUMENT_TYPE } from "../domain/repair-progress";
import { formatGbp } from "../money";
import { savedText } from "../email/send-to";
import { generateClaimDocument, recordClaimEvent, sendClaimEmail } from "./chronology";
import { clientDocumentSignature, sendClientDocumentLink } from "./client-document-signing";
import { all, get, getDb, run } from "./connection";
import { isDocumentApproved } from "./document-approvals";
import { getTotalLossReport, recordTotalLossPaymentReceived } from "./total-loss";
import { vehicleLocationForClaim } from "./vehicle-location";

/**
 * R66: steps 6 to 9 of a total-loss file, done on the Steps page. The client answers the valuation on Draft 8a (A, B or
 * C); the insurer gets Draft 8b with the report and the client's signed acceptance; step 9 records the payment and the
 * salvage. Drafts 8a and 8b wait for Justin's approval like the other drafts (R64).
 */

export function ensureTotalLossStepColumns() {
  const db = getDb();
  const table = db.prepare(`PRAGMA table_info(total_loss_reports)`).all() as Array<{ name: string }>;
  if (!table.length) return;
  const have = new Set(table.map((row) => row.name));
  for (const column of ["inspected_on", "finance", "finance_lender", "salvage_collected_on"]) {
    if (!have.has(column)) db.exec(`ALTER TABLE total_loss_reports ADD COLUMN ${column} TEXT`);
  }
}

type Extras = { inspected_on: string | null; finance: string | null; finance_lender: string | null; salvage_collected_on: string | null };

function extras(claimId: string): Extras | undefined {
  ensureTotalLossStepColumns();
  return get<Extras>(`SELECT inspected_on, finance, finance_lender, salvage_collected_on FROM total_loss_reports WHERE claim_id = ?`, [claimId]);
}

/** Step 6, total loss: the inspection date, whether there is finance (and the lender), and what CAS asks the insurer for. */
export function saveTotalLossStepSix(input: { claimId: string; inspectedOn: string; finance: string; lender: string; casRequest: string }) {
  ensureTotalLossStepColumns();
  const inspected = input.inspectedOn.trim();
  if (inspected && (!/^\d{4}-\d{2}-\d{2}$/.test(inspected) || inspected > londonTodayIso())) throw new Error("Enter the inspection date, not after today.");
  const finance = input.finance === "yes" || input.finance === "no" ? input.finance : "";
  const lender = finance === "yes" ? input.lender.trim().slice(0, 120) : "";
  if (finance === "yes" && !lender) throw new Error("Enter the finance lender.");
  const request = input.casRequest === "full_pav" || input.casRequest === "net_cas" ? input.casRequest : null;
  run(
    `UPDATE total_loss_reports SET inspected_on = COALESCE(NULLIF(?, ''), inspected_on), finance = COALESCE(NULLIF(?, ''), finance), finance_lender = ?, cas_request = COALESCE(?, cas_request) WHERE claim_id = ?`,
    [inspected, finance, lender || null, request, input.claimId],
  );
}

/** The amount CAS asks the insurer for: the pre-accident value, or less the salvage when the client keeps the car (B). */
function amountRequested(claimId: string): number | null {
  const report = getTotalLossReport(claimId);
  if (report.pavPence == null) return null;
  const answer = clientDocumentSignature(claimId, "draft_tl_client")?.answer;
  // Before the client answers, the request matches the amount claimed on Money (pre-accident value less salvage)
  // unless staff chose the full value at step 6.
  const net = answer ? answer.choice === "B" : report.casRequest !== "full_pav";
  return net ? report.pavPence - (report.salvagePence || 0) : report.pavPence;
}

/** R66: the facts Drafts 8a and 8b print, read from the file. */
export function totalLossDraftFacts(claimId: string, reportEnclosed = true) {
  const report = getTotalLossReport(claimId);
  const more = extras(claimId);
  const engineer = get<{ name: string }>(`SELECT e.name FROM claims c JOIN engineers e ON e.id = c.engineer_id WHERE c.id = ?`, [claimId]);
  const answer = clientDocumentSignature(claimId, "draft_tl_client")?.answer;
  return {
    engineerName: String(engineer?.name || ""),
    inspectionDate: String(more?.inspected_on || ""),
    pavPence: report.pavPence,
    salvageCategory: String(report.salvageCategory || ""),
    salvagePence: report.salvagePence,
    amountRequestedPence: amountRequested(claimId),
    clientChoice: answer?.choice === "A" ? ("release" as const) : answer?.choice === "B" ? ("keep" as const) : ("" as const),
    vehicleLocation: vehicleLocationForClaim(claimId),
    financeLender: answer?.finance === "yes" ? answer.lender : more?.finance === "yes" ? String(more.finance_lender || "") : "",
    reportEnclosed,
  };
}

/** Step 6's finished line, in figures. */
export function totalLossStepSixLine(claimId: string): string {
  const report = getTotalLossReport(claimId);
  if (report.pavPence == null) return "";
  const amount = amountRequested(claimId);
  const reportOnFile = Boolean(get<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND document_type = ? LIMIT 1`, [claimId, ENGINEER_REPORT_DOCUMENT_TYPE]));
  const more = extras(claimId);
  return [
    "Total loss",
    `${formatGbp(report.pavPence)} pre-accident`,
    report.salvageCategory ? `Cat ${report.salvageCategory}` : "",
    report.salvagePence != null ? `salvage ${formatGbp(report.salvagePence)}` : "",
    amount != null ? `claiming ${formatGbp(amount)}` : "",
    more?.finance === "yes" ? `finance with ${more.finance_lender}` : more?.finance === "no" ? "no finance" : "",
    reportOnFile ? "report on file" : "report not uploaded",
  ]
    .filter(Boolean)
    .join(" · ");
}

export type ValuationState = {
  answer: "A" | "B" | "C" | null;
  answeredAt: string | null;
  disputeOpen: boolean;
  linkSentAt: string | null;
};

const DISPUTE_RESOLVED = "Valuation dispute resolved";

export function valuationState(claimId: string): ValuationState {
  const signed = clientDocumentSignature(claimId, "draft_tl_client");
  const resolved = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = 'other' AND details LIKE ? ORDER BY occurred_at DESC LIMIT 1`,
    [claimId, `${DISPUTE_RESOLVED}%`],
  );
  const link = get<{ requested_at: string }>(
    `SELECT requested_at FROM client_document_links WHERE claim_id = ? AND template_key = 'draft_tl_client' ORDER BY requested_at DESC LIMIT 1`,
    [claimId],
  );
  const answer = signed?.answer?.choice || null;
  return {
    answer,
    answeredAt: signed?.signedAt || null,
    disputeOpen: answer === "C" && !(resolved && signed && resolved.occurred_at >= signed.signedAt),
    linkSentAt: link ? String(link.requested_at) : null,
  };
}

/** A handler resolves the client's dispute (the client then answers a new valuation, or the handler records the outcome). */
export function resolveValuationDispute(input: { claimId: string; actorId: string; note: string }) {
  const note = input.note.trim();
  if (note.length < 5) throw new Error("Say how the dispute was resolved.");
  if (!valuationState(input.claimId).disputeOpen) throw new Error("There is no open valuation dispute on this file.");
  recordClaimEvent({ claimId: input.claimId, eventType: "other", occurredAt: nowUtcIso(), actorId: input.actorId, details: `${DISPUTE_RESOLVED}: ${note.slice(0, 500)}`, source: "staff" });
}

function engineerReportIds(claimId: string): string[] {
  return all<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND document_type = ? ORDER BY created_at DESC LIMIT 2`, [claimId, ENGINEER_REPORT_DOCUMENT_TYPE]).map((row) => String(row.id));
}

/** Step 7: Draft 8a by email with a signing link (simulated until the mailbox is live), the report attached unless unticked. */
export async function sendValuationToClient(input: { claimId: string; actorId: string; to: string; attachReport: boolean; origin: string }) {
  if (!isDocumentApproved("draft_tl_client")) throw new Error("Draft 8a (valuation to the client) needs Justin's approval before it can be sent.");
  if (getTotalLossReport(input.claimId).pavPence == null) throw new Error("Record the engineer's figures at step 6 first.");
  generateClaimDocument({ claimId: input.claimId, templateKey: "draft_tl_client", actorId: input.actorId, recordOnFile: false });
  const attachments = input.attachReport ? engineerReportIds(input.claimId) : [];
  return sendClientDocumentLink({ claimId: input.claimId, key: "draft_tl_client", actorId: input.actorId, to: input.to, origin: input.origin, attachmentIds: attachments });
}

/** Step 8: Draft 8b to the third-party insurer (or representative), with the report and the client's signed acceptance. */
export async function sendValuationToInsurer(input: { claimId: string; actorId: string; to: string; cc: string }) {
  if (!isDocumentApproved("draft_tl_insurer")) throw new Error("Draft 8b (covering letter to the insurer) needs Justin's approval before it can be sent.");
  const state = valuationState(input.claimId);
  if (state.disputeOpen) throw new Error("The client disputes the valuation. Resolve it at step 7 first.");
  if (state.answer !== "A" && state.answer !== "B") throw new Error("The client has not accepted the valuation yet (step 7).");
  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter the insurer's email address.");
  const produced = generateClaimDocument({ claimId: input.claimId, templateKey: "draft_tl_insurer", actorId: input.actorId, recordOnFile: false });
  if (produced.letter.missing.length) throw new Error(`Not sent. Missing: ${produced.letter.missing.join(", ")}.`);
  const signed = clientDocumentSignature(input.claimId, "draft_tl_client");
  const attachments = [produced.documentId, ...engineerReportIds(input.claimId), ...(signed ? [signed.signedDocumentId] : [])];
  const cc = input.cc.trim() ? [input.cc.trim()] : [];
  const sent = await sendClaimEmail({
    claimId: input.claimId,
    actorId: input.actorId,
    to,
    cc,
    subject: produced.letter.subject,
    body: `Please find attached our letter, the engineer's report and our client's signed acceptance of the valuation. Our reference ${produced.letter.subject}.`,
    attachmentIds: attachments,
  });
  if (!sent.ok) throw new Error(sent.error || "It was not sent.");
  const amount = amountRequested(input.claimId);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "total_loss_notice_sent",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    channel: "email",
    correspondenceId: sent.correspondenceId,
    documentId: produced.documentId,
    details: `Valuation sent to ${to}${cc.length ? `, copied to ${cc.join(", ")}` : ""}, asking for ${amount != null ? formatGbp(amount) : "the amount on the file"}. The payment chase starts from this time.${sent.status === "simulated_sent" ? " Simulated: the mailbox is not connected." : ""}`,
    source: "staff",
  });
  return { simulated: sent.status === "simulated_sent" };
}

/** Step 9: the payment received, the salvage collection date and the actual proceeds, each optional. */
export function recordTotalLossStepNine(input: { claimId: string; actorId: string; paymentPence: number | null; submitKey: string; salvageCollectedOn: string; proceedsPence: number | null }) {
  ensureTotalLossStepColumns();
  const said: string[] = [];
  if (input.paymentPence != null) {
    recordTotalLossPaymentReceived({ claimId: input.claimId, actorId: input.actorId, receivedPence: input.paymentPence, submitKey: input.submitKey });
    said.push(`Payment of ${formatGbp(input.paymentPence)} recorded.`);
  }
  const collected = input.salvageCollectedOn.trim();
  if (collected) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collected) || collected > londonTodayIso()) throw new Error("Enter the salvage collection date, not after today.");
    const already = get<{ id: string }>(`SELECT id FROM claim_events WHERE claim_id = ? AND event_type = 'salvage_collected' LIMIT 1`, [input.claimId]);
    run(`UPDATE total_loss_reports SET salvage_collected_on = ? WHERE claim_id = ?`, [collected, input.claimId]);
    if (input.proceedsPence != null) run(`UPDATE total_loss_reports SET sale_proceeds_pence = ? WHERE claim_id = ?`, [input.proceedsPence, input.claimId]);
    if (!already) {
      recordClaimEvent({
        claimId: input.claimId,
        eventType: "salvage_collected",
        occurredAt: `${collected}T12:00:00.000Z`,
        actorId: input.actorId,
        details: `Salvage collected ${formatUkDate(collected)}${input.proceedsPence != null ? `; actual proceeds ${formatGbp(input.proceedsPence)}` : ""}. Agreed and paid amounts were not changed.`,
        source: "staff",
      });
    }
    said.push(`Salvage collected ${formatUkDate(collected)}.`);
  } else if (input.proceedsPence != null) {
    run(`UPDATE total_loss_reports SET sale_proceeds_pence = ? WHERE claim_id = ?`, [input.proceedsPence, input.claimId]);
    said.push(`Salvage proceeds ${formatGbp(input.proceedsPence)} recorded.`);
  }
  if (!said.length) throw new Error("Enter a payment, the salvage collection date or the proceeds.");
  return said.join(" ");
}

/** Where step 8 sends: the representative (insurer copied in) or the insurer. */
export function insurerContacts(claimId: string): { to: string; cc: string; name: string } {
  const tp = get<Record<string, string | null>>(
    `SELECT insurer_name, insurer_email, handler_email, agent_name, agent_email, agent_handler_email FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence ASC LIMIT 1`,
    [claimId],
  );
  const insurer = savedText(tp?.handler_email) || savedText(tp?.insurer_email);
  const agent = savedText(tp?.agent_handler_email) || savedText(tp?.agent_email);
  return agent ? { to: agent, cc: insurer, name: savedText(tp?.agent_name) || "Representative" } : { to: insurer, cc: "", name: savedText(tp?.insurer_name) || "Third-party insurer" };
}

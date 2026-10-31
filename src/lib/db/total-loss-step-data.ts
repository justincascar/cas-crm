import type { TotalLossStepData } from "@/components/claims/TotalLossStepForms";
import { ENGINEER_REPORT_DOCUMENT_TYPE } from "../domain/repair-progress";
import { savedText } from "../email/send-to";
import { letterPreview } from "./chronology";
import { get } from "./connection";
import { isDocumentApproved } from "./document-approvals";
import { insurerContacts } from "./total-loss-steps";

function previewText(claimId: string, key: "draft_tl_client" | "draft_tl_insurer"): string {
  try {
    return letterPreview(claimId, key).text;
  } catch {
    return "";
  }
}

/** R66: what the step 7–9 cards need, read from the file. Nothing is written. */
export function totalLossStepData(claimId: string): TotalLossStepData {
  const claim = get<{ client_email: string | null; total_loss: number | null }>(
    `SELECT p.email AS client_email, c.total_loss FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
  const totalLoss = Number(claim?.total_loss) === 1;
  const insurer = insurerContacts(claimId);
  return {
    approved8a: isDocumentApproved("draft_tl_client"),
    approved8b: isDocumentApproved("draft_tl_insurer"),
    clientEmail: savedText(claim?.client_email),
    insurer,
    reportOnFile: Boolean(get<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND document_type = ? LIMIT 1`, [claimId, ENGINEER_REPORT_DOCUMENT_TYPE])),
    preview8a: totalLoss ? previewText(claimId, "draft_tl_client") : "",
    preview8b: totalLoss ? previewText(claimId, "draft_tl_insurer") : "",
    insurerEmailForReport: insurer.to,
  };
}

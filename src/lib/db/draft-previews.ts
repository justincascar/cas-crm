import { CLIENT_DRAFTS, MID_BLOCK_KEY, midBlockLines, WAITING_FOR_CAS_WORDING, type ClientDraftKey } from "../documents/client-drafts";
import { letterPreview } from "./chronology";
import { all } from "./connection";
import { documentApproval, isDocumentApproved, latestMidSearch, type DocumentApproval } from "./document-approvals";

export type DraftDocumentRow = {
  key: string;
  number: string;
  title: string;
  solicitor: boolean;
  outlineOnly: boolean;
  approval: DocumentApproval | null;
  approved: boolean;
  /** The wording as it would be produced on a TEST file, or an explanation. Nothing is filed or sent. */
  example: { fileReference: string; subject: string; text: string; missing: string[] } | null;
  note: string;
};

const FAULT_DRAFTS = new Set<string>(["draft_repair_authority", "draft_own_insurer_network", "client_welcome_fault"]);
const SPLIT_DRAFTS = new Set<string>(["draft_split_tp", "draft_split_client"]);

/** A TEST file to show each draft on: a fault file for fault letters, a split file for split ones, otherwise non-fault. */
function exampleFile(key: string): { id: string; reference: string } | null {
  if (key.startsWith("draft_tl_")) {
    const row = all<{ id: string; file_reference: string }>(`SELECT id, file_reference FROM claims WHERE file_reference LIKE 'TEST-%' AND total_loss = 1 ORDER BY file_reference LIMIT 1`)[0];
    return row ? { id: String(row.id), reference: String(row.file_reference) } : null;
  }
  const wanted = FAULT_DRAFTS.has(key) ? ["fault"] : SPLIT_DRAFTS.has(key) ? ["split", "non_fault"] : key === "draft_liability_position" ? ["disputed", "", "non_fault"] : ["non_fault"];
  for (const type of wanted) {
    const row = all<{ id: string; file_reference: string }>(
      `SELECT id, file_reference FROM claims WHERE file_reference LIKE 'TEST-%' AND COALESCE(claim_type, '') = ? ORDER BY file_reference LIMIT 1`,
      [type],
    )[0];
    if (row) return { id: String(row.id), reference: String(row.file_reference) };
  }
  return null;
}

/** R64: Settings → Draft documents. Each draft, its approval, and its wording on a TEST file. */
export function draftDocumentRows(): DraftDocumentRow[] {
  const rows: DraftDocumentRow[] = CLIENT_DRAFTS.map((info) => {
    const approval = documentApproval(info.key);
    const base = {
      key: info.key,
      number: info.number,
      title: info.title,
      solicitor: info.solicitor,
      outlineOnly: Boolean(info.outlineOnly),
      approval,
      approved: isDocumentApproved(info.key),
    };
    if (info.outlineOnly) return { ...base, example: null, note: `${WAITING_FOR_CAS_WORDING}. The outline is in the drafts file; nothing is generated until the solicitor's wording and Justin's figures are in Settings.` };
    const file = exampleFile(info.key);
    if (!file) return { ...base, example: null, note: "No TEST file of the right kind to show it on." };
    try {
      const letter = letterPreview(file.id, info.key as Exclude<ClientDraftKey, "draft_courtesy_car">);
      return { ...base, example: { fileReference: file.reference, subject: letter.subject, text: letter.text, missing: letter.missing }, note: "" };
    } catch (error) {
      return { ...base, example: null, note: error instanceof Error ? error.message : "It could not be shown." };
    }
  });
  // R63: the MID block added to the initial letter to the third-party insurer.
  const midFile = all<{ id: string; file_reference: string }>(
    `SELECT c.id, c.file_reference FROM claims c JOIN mid_lookups m ON m.claim_id = c.id WHERE c.file_reference LIKE 'TEST-%' ORDER BY m.lookup_on DESC LIMIT 1`,
  )[0];
  const mid = midFile ? midBlockLines(latestMidSearch(String(midFile.id))) : null;
  rows.push({
    key: MID_BLOCK_KEY,
    number: "MID block",
    title: "MID search block in the initial letter to the third-party insurer",
    solicitor: false,
    outlineOnly: false,
    approval: documentApproval(MID_BLOCK_KEY),
    approved: isDocumentApproved(MID_BLOCK_KEY),
    example: mid && midFile ? { fileReference: String(midFile.file_reference), subject: "Added after the accident details", text: mid.text, missing: [] } : null,
    note: mid ? "" : "No TEST file has a MID search recorded. The block reads: MID search: on [date] we searched the Motor Insurance Database for registration [registration]; the vehicle was shown as insured by [insurer] under policy [policy].",
  });
  return rows;
}

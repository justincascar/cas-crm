import { fileSetupGaps, fileSetupIncompleteMessage, SAFE_TO_DRIVE_QUESTIONS, safeToDriveReasons, type SafeToDriveAnswers } from "../domain/file-setup";
import { get } from "./connection";

/**
 * R50: what the file set-up still has as "Not yet known". While anything is, the things that depend on it do not
 * start: chasers, the storage and recovery agreement, the hire agreement (credit hire or courtesy depends on
 * liability), and letters that choose fault or non-fault wording.
 */
export function fileSetupGapsFor(claimId: string): string[] {
  const row = get<{ claim_type: string | null; jurisdiction: string | null; roadworthiness: string | null }>(
    `SELECT claim_type, jurisdiction, roadworthiness FROM claims WHERE id = ?`,
    [claimId],
  );
  if (!row) return [];
  return fileSetupGaps({ claimType: row.claim_type, jurisdiction: row.jurisdiction, roadworthiness: row.roadworthiness });
}

/** Refusal for something that needs the whole file set-up, or null. */
export function fileSetupRefusal(claimId: string, what: string): string | null {
  const gaps = fileSetupGapsFor(claimId);
  return gaps.length ? fileSetupIncompleteMessage(gaps, what) : null;
}

/** Refusal for something that needs only the liability status (fault or non-fault wording), or null. */
export function liabilityUnknownRefusal(claimId: string, what: string): string | null {
  const gaps = fileSetupGapsFor(claimId).filter((gap) => gap === "liability status");
  return gaps.length ? fileSetupIncompleteMessage(gaps, what) : null;
}

/** R52: the safe-to-drive questions answered Yes on the file, as reasons, for the recovery record. */
export function safeToDriveReasonsForClaim(claimId: string): string[] {
  const row = get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = 'damage'`, [claimId]);
  let data: Record<string, unknown> = {};
  try {
    data = row?.data_json ? (JSON.parse(row.data_json) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  const answers: SafeToDriveAnswers = {};
  for (const q of SAFE_TO_DRIVE_QUESTIONS) answers[q.key] = String(data[q.key] || "");
  return safeToDriveReasons(answers);
}

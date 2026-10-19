import { formatUkDateTime, nowUtcIso } from "../dates";
import { actorName, VersionConflictError } from "./record-version";
import { get, all, newId, run } from "./connection";

export type ClaimDraftRow = {
  id: string;
  payload_json: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  discarded_at: string | null;
  claim_id: string | null;
  author_name?: string;
};

export function listOpenClaimDrafts(): ClaimDraftRow[] {
  return all<ClaimDraftRow>(
    `SELECT d.*, s.name AS author_name
     FROM claim_drafts d
     LEFT JOIN staff s ON s.id = d.updated_by
     WHERE d.discarded_at IS NULL AND d.claim_id IS NULL
     ORDER BY d.updated_at DESC`,
  );
}

export function getClaimDraft(id: string): ClaimDraftRow | undefined {
  return get<ClaimDraftRow>(
    `SELECT d.*, s.name AS author_name
     FROM claim_drafts d
     LEFT JOIN staff s ON s.id = d.updated_by
     WHERE d.id = ?`,
    [id],
  );
}

export function draftPayload(row: ClaimDraftRow | undefined): Record<string, string> {
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.payload_json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value == null) out[key] = "";
      else out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Saves the typed form. It does not create a claim, a charge, a message or a history entry.
 * A stale version is refused. The caller's entries are not written over the newer draft.
 */
export function saveClaimDraft(input: {
  draftId?: string | null;
  expectedVersion?: string | null;
  payload: Record<string, string>;
  actorId: string;
}): { id: string; version: string; savedLabel: string } {
  const now = nowUtcIso();
  const payload = JSON.stringify(input.payload);
  const existingId = (input.draftId || "").trim();
  if (!existingId) {
    const id = newId("draft");
    run(
      `INSERT INTO claim_drafts(id, payload_json, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, payload, now, input.actorId, now, input.actorId],
    );
    return { id, version: now, savedLabel: `Draft saved ${formatUkDateTime(now)}` };
  }
  const current = getClaimDraft(existingId);
  if (!current || current.discarded_at || current.claim_id) {
    throw new Error("That draft is no longer open.");
  }
  const expected = input.expectedVersion ?? "";
  if (current.updated_at !== expected) {
    throw new VersionConflictError(
      actorName(current.updated_by),
      current.updated_at,
      [{ name: "draft", label: "Draft", saved: "Saved draft", yours: "Your entries" }],
      input.payload,
      expected,
      "claim-draft",
      existingId,
    );
  }
  run(`UPDATE claim_drafts SET payload_json = ?, updated_at = ?, updated_by = ? WHERE id = ?`, [
    payload,
    now,
    input.actorId,
    existingId,
  ]);
  return { id: existingId, version: now, savedLabel: `Draft saved ${formatUkDateTime(now)}` };
}

export function discardClaimDraft(input: { draftId: string; expectedVersion: string; confirm: boolean; actorId: string }) {
  if (!input.confirm) throw new Error("Confirm that you want to discard this draft.");
  const current = getClaimDraft(input.draftId);
  if (!current || current.discarded_at) return;
  if (current.updated_at !== input.expectedVersion) {
    throw new VersionConflictError(
      actorName(current.updated_by),
      current.updated_at,
      [{ name: "draft", label: "Draft", saved: "Saved draft", yours: "Discard" }],
      {},
      input.expectedVersion,
      "claim-draft",
      input.draftId,
    );
  }
  run(`UPDATE claim_drafts SET discarded_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`, [
    nowUtcIso(),
    nowUtcIso(),
    input.actorId,
    input.draftId,
  ]);
}

export function finishClaimDraft(draftId: string | null | undefined, claimId: string, actorId: string) {
  const id = (draftId || "").trim();
  if (!id) return;
  const now = nowUtcIso();
  run(
    `UPDATE claim_drafts SET claim_id = ?, updated_at = ?, updated_by = ? WHERE id = ? AND claim_id IS NULL AND discarded_at IS NULL`,
    [claimId, now, actorId, id],
  );
}

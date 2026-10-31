import { chaseKindForRuleKey, type ChaseKind } from "../domain/chase";
import { chaseFileStateFromPosition, chaseStopReason } from "../domain/rules";
import { listChasesForClaim, type ChaseView } from "./chase";
import { AUTO_CHASE_KINDS, chaseRuleApprovals } from "./auto-chasers";
import { all } from "./connection";

export type AutomationRow = {
  id: string;
  claimId: string;
  fileReference: string;
  kind: ChaseKind;
  title: string;
  dueAt: string | null;
  every: string;
  state: string;
  sending: string;
};

/** Where a chase stands, in plain words, worked out from the file now (a stored status can be out of date). */
function stateWords(view: ChaseView, stop: string | null): string {
  if (stop) return `Stopped: ${stop}`;
  if (view.handlerState === "cancelled") return "Cancelled on the file";
  if (view.handlerState === "paused") return "Paused on the file";
  if (view.outcomeOnFile) return `Done: ${view.reason}`;
  if (view.due) return `Due: ${view.label || view.reason}`;
  if (!view.active) return view.reason || "Not started";
  return `Waiting: ${view.reason}`;
}

/**
 * R34: the Automations page. Each chase row is worked out again from its file, so a chase whose answer is on file
 * reads "Done" (for example the engineer's report received), whatever the stored row says. Old demonstration rows that
 * no chaser uses are left out.
 */
export function listAutomationView(asAt?: string): AutomationRow[] {
  const rows = all<{ id: string; claim_id: string; rule_key: string; file_reference: string; current_position: string | null; lit: number; closed: number; solicitors: number }>(
    `SELECT a.id, a.claim_id, a.rule_key, c.file_reference, c.current_position,
            EXISTS(SELECT 1 FROM litigation l WHERE l.claim_id = a.claim_id) AS lit,
            EXISTS(SELECT 1 FROM claim_events e WHERE e.claim_id = a.claim_id AND e.event_type = 'case_closed') AS closed,
            EXISTS(SELECT 1 FROM claim_events e WHERE e.claim_id = a.claim_id AND e.event_type = 'handed_to_solicitors') AS solicitors
     FROM automations a JOIN claims c ON c.id = a.claim_id
     ORDER BY a.next_run_at`,
  );
  const approved = new Map(chaseRuleApprovals().map((rule) => [rule.kind, rule.approved]));
  const byClaim = new Map<string, ChaseView[]>();
  const out: AutomationRow[] = [];
  for (const row of rows) {
    const kind = chaseKindForRuleKey(row.rule_key);
    if (!kind) continue;
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, listChasesForClaim(row.claim_id, asAt));
    const view = byClaim.get(row.claim_id)!.find((item) => item.kind === kind);
    if (!view) continue;
    const stop = chaseStopReason(
      chaseFileStateFromPosition({
        currentPosition: row.current_position,
        hasLitigation: Number(row.lit) > 0,
        paused: false,
        caseClosedEvent: Number(row.closed) > 0,
        handedToSolicitorsEvent: Number(row.solicitors) > 0,
      }),
    );
    const days = view.intervalDays;
    out.push({
      id: row.id,
      claimId: row.claim_id,
      fileReference: String(row.file_reference),
      kind,
      title: view.title,
      dueAt: view.outcomeOnFile || stop ? null : view.dueAt,
      every: kind === "hire_agreement_renewal" ? "Reminder on the renewal days" : `Every ${days} ${days === 1 ? "day" : "days"}`,
      state: stateWords(view, stop),
      sending: !AUTO_CHASE_KINDS.includes(kind)
        ? "A reminder for staff. No email."
        : approved.get(kind)
          ? "Sends automatically (simulated until the mailbox is connected)"
          : "Waits for Justin to approve the wording",
    });
  }
  return out.sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")) || a.fileReference.localeCompare(b.fileReference));
}

import { chaseDefinition, isPaymentChaseKind, type ChaseKind } from "../domain/chase";
import { chaseHistorySentence, type ChaseHistory } from "../domain/chase-history";
import { all, get } from "./connection";

/**
 * R48: when we first wrote and how often we have chased, read from the file's events. The count is of chasers sent
 * or marked sent; a scheduled chase is not an event, so it is never counted.
 */

type Outcome = "repairable" | "total_loss" | "unknown";

const PAYMENT_WORDS: Record<string, string> = {
  repairs: "payment of the repair invoice",
  vehicle_damage: "payment of the agreed total-loss settlement",
  hire: "payment of the hire charge",
  storage: "payment of the storage charge",
  recovery: "payment of the recovery charge",
};

function requestingFor(kind: ChaseKind, outcome: Outcome): string {
  if (kind === "liability_response") return "your decision on liability";
  if (kind === "engineer_report") return "your engineer's report";
  if (kind === "repair_authorisation") {
    return outcome === "repairable"
      ? "repair authorisation"
      : outcome === "total_loss"
        ? "the total-loss payment (the pre-accident value less salvage)"
        : "your decision on the vehicle damage claim";
  }
  const head = chaseDefinition(kind).paymentHead;
  return head ? PAYMENT_WORDS[head] || "" : "";
}

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

function earliest(claimId: string, eventTypes: readonly string[]): string | null {
  if (!eventTypes.length) return null;
  const row = get<{ at: string | null }>(
    `SELECT MIN(occurred_at) AS at FROM claim_events WHERE claim_id = ? AND event_type IN (${placeholders(eventTypes)})`,
    [claimId, ...eventTypes],
  );
  return row?.at ? String(row.at) : null;
}

/** The latest substantive reply to this chase after the first request, which restarts the count. */
function replyFor(claimId: string, kind: ChaseKind | "hire_pack", after: string): string | null {
  let sql = "";
  let params: Array<string> = [];
  if (kind === "hire_pack") {
    sql = `event_type = 'payment_reply_substantive'`;
  } else if (isPaymentChaseKind(kind)) {
    sql = `event_type = 'payment_reply_substantive' AND details LIKE ?`;
    params = [`head=${chaseDefinition(kind).paymentHead} %`];
  } else if (kind === "liability_response" || kind === "repair_authorisation") {
    sql = `event_type = 'chase_reply_substantive' AND details LIKE ?`;
    params = [`%the ${chaseDefinition(kind).title.toLowerCase()}%`];
  } else {
    return null;
  }
  const row = get<{ at: string | null }>(
    `SELECT MAX(occurred_at) AS at FROM claim_events WHERE claim_id = ? AND ${sql} AND occurred_at > ?`,
    [claimId, ...params, after],
  );
  return row?.at ? String(row.at) : null;
}

function sentSince(claimId: string, eventTypes: readonly string[], since: string): string[] {
  return all<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events
     WHERE claim_id = ? AND event_type IN (${placeholders(eventTypes)}) AND occurred_at > ?
     ORDER BY occurred_at`,
    [claimId, ...eventTypes, since],
  ).map((row) => String(row.occurred_at));
}

export function chaseHistoryFor(claimId: string, kind: ChaseKind, outcome: Outcome = "unknown"): ChaseHistory | null {
  if (kind === "hire_agreement_renewal") return null;
  const def = chaseDefinition(kind);
  const firstRequestAt = earliest(claimId, def.startEventTypes);
  if (!firstRequestAt) return null;
  const replyAt = replyFor(claimId, kind, firstRequestAt);
  return {
    firstRequestAt,
    requesting: requestingFor(kind, outcome),
    replyAt,
    chasesSent: sentSince(claimId, [def.chaseSentEventType, ...def.extraChaseSentEventTypes], replyAt || firstRequestAt),
  };
}

export function chaseHistoryLine(claimId: string, kind: ChaseKind, outcome: Outcome = "unknown"): string | null {
  return chaseHistorySentence(chaseHistoryFor(claimId, kind, outcome));
}

/**
 * The same sentence for the chasers staff produce from the letter and email templates: the liability chaser letter,
 * and the supplied payment chases that follow the hire pack.
 */
export function chaseHistoryLineForTemplate(claimId: string, templateKey: string): string | null {
  if (templateKey === "liability_chaser") return chaseHistoryLine(claimId, "liability_response");
  if (templateKey !== "payment_chase_1" && templateKey !== "payment_chase_2") return null;
  const firstRequestAt = earliest(claimId, ["hire_pack_sent"]);
  if (!firstRequestAt) return null;
  const replyAt = replyFor(claimId, "hire_pack", firstRequestAt);
  return chaseHistorySentence({
    firstRequestAt,
    requesting: "payment of the claim set out in our hire pack",
    replyAt,
    chasesSent: sentSince(claimId, ["payment_chase_1_sent", "payment_chase_2_sent"], replyAt || firstRequestAt),
  });
}

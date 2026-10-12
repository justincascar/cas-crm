import { HEAD_LABELS } from "../constants";
import { eventLabel } from "../domain/events";
import { describeHeadStatus } from "../domain/head-screen";
import type { PaymentReviewHead } from "../domain/payment-review";
import { all, get } from "./connection";
import { chaseRow } from "./chase";
import type { ChaseKind } from "../domain/chase";
import {
  comparisonForHead,
  headAcceptedAsFinal,
  headDisputeStands,
  latestInsurerReason,
  listOpenPaymentReviews,
  listPaymentsAfterSettlement,
  type PaymentReviewItem,
  type SettledPaymentFlag,
} from "./payment-review";
import { formatGbp } from "../money";
import { insurerReasonLabel } from "../domain/payment-review";

const REPAIR_EVENTS = new Set([
  "repair_payment_request_sent",
  "repair_payment_reminder_sent",
  "repair_payment_chase_paused",
  "repair_payment_chase_resumed",
  "repair_payment_chase_cancelled",
  "repair_payment_chase_cleared",
  "repair_invoice_payment_logged",
]);

const SETTLEMENT_EVENTS = new Set([
  "settlement_payment_request_sent",
  "settlement_payment_reminder_sent",
  "settlement_payment_chase_paused",
  "settlement_payment_chase_resumed",
  "settlement_payment_chase_cancelled",
  "settlement_payment_chase_cleared",
  "settlement_payment_logged",
  "total_loss_payment_promised",
  "total_loss_payment_received",
  "total_loss_payment_chase_sent",
]);

const DECISION_EVENTS = new Set(["payment_settlement_accepted", "payment_settlement_disputed", "payment_write_off"]);

export type HeadHistoryEntry = {
  at: string;
  title: string;
  detail: string;
  actorName: string | null;
};

export type HeadSectionModel = {
  head: PaymentReviewHead;
  title: string;
  empty: boolean;
  claimedPence: number;
  agreedPence: number | null;
  agreedCaption: string;
  preAccidentValuePence: number | null;
  salvageProceedsPence: number | null;
  receivedPence: number;
  outstandingPence: number | null;
  statusLabel: string;
  insurerReason: string | null;
  review: PaymentReviewItem | null;
  afterSettlement: SettledPaymentFlag | null;
  history: HeadHistoryEntry[];
};

function chaseKindFor(head: PaymentReviewHead): ChaseKind | null {
  if (head === "repairs") return "repair_payment";
  if (head === "vehicle_damage") return "settlement_payment";
  return null;
}

function chaseState(claimId: string, head: PaymentReviewHead): "none" | "tracking" | "paused" | "cancelled" {
  const kind = chaseKindFor(head);
  if (!kind) return "none";
  const row = chaseRow(claimId, kind);
  if (!row) return "none";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "paused" || Number(row.paused) === 1) return "paused";
  return "tracking";
}

function sectionTitle(head: PaymentReviewHead): string {
  if (head === "vehicle_damage") return "Total loss";
  return HEAD_LABELS[head];
}

function eventMatches(head: PaymentReviewHead, eventType: string, details: string | null): boolean {
  const text = String(details || "");
  if (text.includes(`head=${head}`)) return true;
  if (head === "repairs" && REPAIR_EVENTS.has(eventType)) return true;
  if (head === "vehicle_damage" && SETTLEMENT_EVENTS.has(eventType)) return true;
  return false;
}

function plainDetail(eventType: string, details: string | null): string {
  const raw = String(details || "");
  const amount = raw.match(/amount_pence=(\d+)/);
  const received = raw.match(/received_pence=(\d+)/);
  if (
    amount &&
    (eventType === "repair_invoice_payment_logged" ||
      eventType === "settlement_payment_logged" ||
      eventType === "head_payment_logged")
  ) {
    const now = received ? ` The amount received on this head is ${formatGbp(Number(received[1]))}.` : "";
    return `${formatGbp(Number(amount[1]))} recorded.${now}`;
  }
  return cleanDetails(details);
}

function cleanDetails(details: string | null): string {
  return String(details || "")
    .replace(/head=[a-z_]+ ?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadHeadSection(claimId: string, head: PaymentReviewHead): HeadSectionModel {
  const line = get<{ claimed_pence: number; agreed_pence: number; received_pence: number }>(
    `SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  const claimed = Number(line?.claimed_pence) || 0;
  const agreed = Number(line?.agreed_pence) || 0;
  const received = Number(line?.received_pence) || 0;
  const comparison = line
    ? comparisonForHead(claimId, head, { agreedPence: agreed, claimedPence: claimed, receivedPence: received })
    : { targetPence: null, salvageProceedsPence: 0, acceptedAsFinal: false };
  const review = listOpenPaymentReviews(claimId).find((item) => item.head === head) ?? null;
  const accepted = line ? headAcceptedAsFinal(claimId, head, agreed, received) : false;
  const disputed = line ? headDisputeStands(claimId, head) : false;
  const empty = !line || (claimed === 0 && agreed === 0 && received === 0);
  const paidInFull = comparison.targetPence != null && comparison.targetPence > 0 && received === comparison.targetPence;
  const showSalvage = head === "vehicle_damage" && !accepted && agreed > 0;
  const agreedDisplay = !line || agreed <= 0 ? null : showSalvage ? Math.max(0, agreed - comparison.salvageProceedsPence) : agreed;
  const outstanding = empty || comparison.targetPence == null ? null : Math.max(0, comparison.targetPence - received);
  const history = loadHistory(claimId, head);
  const afterSettlement = listPaymentsAfterSettlement(claimId).find((flag) => flag.head === head) ?? null;
  const reason = line && received > 0 ? insurerReasonLabel(latestInsurerReason(claimId, head)) : null;

  return {
    head,
    title: sectionTitle(head),
    empty,
    claimedPence: claimed,
    agreedPence: agreedDisplay,
    agreedCaption: showSalvage
      ? "Agreed, after salvage proceeds"
      : accepted
        ? "Agreed (accepted as the final figure)"
        : "Agreed",
    preAccidentValuePence: showSalvage ? agreed : null,
    salvageProceedsPence: showSalvage ? comparison.salvageProceedsPence : null,
    receivedPence: received,
    outstandingPence: outstanding,
    statusLabel: describeHeadStatus({
      empty,
      awaitingDecision: review != null,
      acceptedAsFinal: accepted,
      paidInFull,
      disputed: disputed && !paidInFull && !accepted,
      chase: chaseState(claimId, head),
    }),
    insurerReason: reason,
    review,
    afterSettlement,
    history,
  };
}

function loadHistory(claimId: string, head: PaymentReviewHead): HeadHistoryEntry[] {
  const decisions = all<{
    decision: string;
    received_pence: number;
    target_pence: number;
    write_off_pence: number | null;
    insurer_reason: string | null;
    grounds: string | null;
    decided_at: string;
    actor_name: string | null;
  }>(
    `SELECT d.decision, d.received_pence, d.target_pence, d.write_off_pence, d.insurer_reason, d.grounds, d.decided_at, s.name AS actor_name
     FROM payment_settlement_decisions d
     LEFT JOIN staff s ON s.id = d.decided_by
     WHERE d.claim_id = ? AND d.head_of_loss = ?
     ORDER BY d.decided_at ASC, d.rowid ASC`,
    [claimId, head],
  );
  const events = all<{ event_type: string; occurred_at: string; details: string | null; actor_name: string | null }>(
    `SELECT e.event_type, e.occurred_at, e.details, s.name AS actor_name
     FROM claim_events e
     LEFT JOIN staff s ON s.id = e.actor_id
     WHERE e.claim_id = ?
     ORDER BY e.occurred_at ASC, e.recorded_at ASC`,
    [claimId],
  );
  const entries: HeadHistoryEntry[] = [];
  for (const decision of decisions) {
    if (decision.decision === "accept_final") {
      const writeOff = Number(decision.write_off_pence) || 0;
      entries.push({
        at: decision.decided_at,
        title: "Accepted as the final figure",
        detail: `Write-off ${formatGbp(writeOff)}. Reason: ${decision.insurer_reason || "no reason given"}.`,
        actorName: decision.actor_name,
      });
    } else if (decision.decision === "dispute") {
      entries.push({
        at: decision.decided_at,
        title: "Disputed",
        detail: `The agreed figure was left as it was. Grounds: ${String(decision.grounds || "").trim() || "none recorded"}.`,
        actorName: decision.actor_name,
      });
    }
  }
  for (const event of events) {
    if (!eventMatches(head, event.event_type, event.details)) continue;
    if (DECISION_EVENTS.has(event.event_type)) continue;
    entries.push({
      at: event.occurred_at,
      title: eventLabel(event.event_type),
      detail: plainDetail(event.event_type, event.details),
      actorName: event.actor_name,
    });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title));
  return entries;
}

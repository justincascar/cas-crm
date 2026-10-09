import { nowUtcIso } from "../dates";
import { type ChaseKind } from "../domain/chase";
import { TOTAL_LOSS_PAYMENT_RECEIVED_EVENT } from "../domain/follow-up-chases";
import {
  PAYMENT_CORRECTION_WINDOW_MS,
  applyLoggedPayment,
  headSettledInFull,
  isPaymentChaseHead,
  outstandingOnHead,
  type PaymentChaseHead,
} from "../domain/payment-chase";
import { formatGbp } from "../money";
import { pauseChase, syncOutstandingPaymentChases } from "./chase";
import { recordClaimEvent } from "./chronology";
import { all, get, run } from "./connection";
import { recordTotalLossPaymentReceived } from "./total-loss";

const PARTIAL_PAUSE =
  "Paused for review after a part-payment. The balance has been reduced. This is not treated as paid. Resume after review to chase the amount still outstanding. Nothing is sent automatically.";

type MoneyLine = { id: string; agreed_pence: number; received_pence: number; claimed_pence: number };

function kindForHead(head: PaymentChaseHead): ChaseKind {
  return head === "repairs" ? "repair_payment" : "settlement_payment";
}

function moneyLine(claimId: string, head: PaymentChaseHead): MoneyLine | undefined {
  return get<MoneyLine>(
    `SELECT id, agreed_pence, received_pence, claimed_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
}

function snapshot(claimId: string): string {
  const rows = all<{ id: string; head_of_loss: string; agreed_pence: number; received_pence: number; claimed_pence: number }>(
    `SELECT id, head_of_loss, agreed_pence, received_pence, claimed_pence FROM financial_lines WHERE claim_id = ? ORDER BY id`,
    [claimId],
  );
  return JSON.stringify(rows);
}

function parseAmount(details: string | null): number | null {
  const text = String(details || "");
  const tagged = text.match(/amount_pence=(\d+)/);
  if (tagged) return Number(tagged[1]);
  const added = text.match(/Staff added (\d+(?:\.\d+)?) pounds/);
  if (!added) return null;
  const pounds = Number(added[1]);
  if (!Number.isFinite(pounds)) return null;
  return Math.round(pounds * 100);
}

function lastLogged(claimId: string, head: PaymentChaseHead): { amountPence: number; at: string } | null {
  const types =
    head === "repairs"
      ? ["repair_invoice_payment_logged"]
      : ["settlement_payment_logged", TOTAL_LOSS_PAYMENT_RECEIVED_EVENT];
  const rows = all<{ details: string | null; occurred_at: string; event_type: string }>(
    `SELECT details, occurred_at, event_type FROM claim_events
     WHERE claim_id = ? AND event_type IN (${types.map(() => "?").join(", ")})
     ORDER BY occurred_at DESC, recorded_at DESC`,
    [claimId, ...types],
  );
  for (const row of rows) {
    if (head === "repairs" && !String(row.details || "").includes("head=repairs") && row.event_type !== "repair_invoice_payment_logged") {
      continue;
    }
    const amount = parseAmount(row.details);
    if (amount == null || amount <= 0) continue;
    return { amountPence: amount, at: String(row.occurred_at) };
  }
  return null;
}

function claimRow(claimId: string) {
  return get<{ id: string; total_loss: number | null; later_declared_total_loss: number | null }>(
    `SELECT id, total_loss, later_declared_total_loss FROM claims WHERE id = ?`,
    [claimId],
  );
}

function flagReview(claimId: string, actorId: string, head: string, details: string) {
  recordClaimEvent({
    claimId,
    eventType: "payment_chase_review_flagged",
    occurredAt: nowUtcIso(),
    actorId,
    details: `head=${head} ${details}`,
    source: "staff",
    channel: "file",
  });
}

function flagHireStorage(claimId: string, actorId: string, head: PaymentChaseHead, totalLoss: boolean) {
  const where = totalLoss
    ? "The total-loss screen may suggest a hire end seven days after this payment. That date is not set until a handler confirms it."
    : "No hire end date is suggested or set from this payment. Repairable hire still ends only when repairs are complete and the repaired vehicle is back.";
  recordClaimEvent({
    claimId,
    eventType: "payment_hire_storage_review",
    occurredAt: nowUtcIso(),
    actorId,
    details: `head=${head} Full payment recorded. Hire and storage are flagged for review and have not been closed. ${where} The storage end date was not changed.`,
    source: "staff",
    channel: "file",
  });
}

export function recordAgreedRepairInvoice(input: { claimId: string; actorId: string; agreedPence: number }) {
  if (!claimRow(input.claimId)) throw new Error("File not found.");
  if (!Number.isInteger(input.agreedPence) || input.agreedPence <= 0) {
    throw new Error("Enter the agreed repair invoice amount. It is not taken from the claimed figure.");
  }
  const existing = moneyLine(input.claimId, "repairs");
  const receivedBefore = existing?.received_pence || 0;
  const claimedBefore = existing?.claimed_pence || 0;
  if (existing) {
    run(`UPDATE financial_lines SET agreed_pence = ? WHERE id = ?`, [input.agreedPence, existing.id]);
  } else {
    run(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
      ) VALUES (?, ?, 'repairs', 'Agreed repair invoice', 1, 'job', 0, 0, 0, 0, 0, 0, ?, 0, NULL)`,
      [`rep-${input.claimId}`, input.claimId, input.agreedPence],
    );
  }
  const after = moneyLine(input.claimId, "repairs");
  if (!after || Number(after.received_pence) !== receivedBefore || (existing && Number(after.claimed_pence) !== claimedBefore)) {
    throw new Error("The agreed repair invoice could not be saved without changing claimed or received.");
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "repair_invoice_agreed_recorded",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff recorded ${formatGbp(input.agreedPence)} as the agreed repair invoice. Claimed and received were not changed. Storage was not included.`,
    source: "staff",
    channel: "file",
  });
  syncOutstandingPaymentChases([input.claimId]);
}

export function recordUnreferencedPayment(input: { claimId: string; actorId: string; amountPence: number | null; note?: string }) {
  if (!claimRow(input.claimId)) throw new Error("File not found.");
  const before = snapshot(input.claimId);
  const amount = input.amountPence && input.amountPence > 0 ? formatGbp(input.amountPence) : "an amount that was not entered";
  const note = String(input.note || "").trim();
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "payment_reference_unclear",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `head=unclear ${amount} arrived without a clear claim or head of loss.${note ? ` ${note}` : ""} It was not allocated to the repair invoice, the total-loss settlement, or storage.`,
    source: "staff",
    channel: "file",
  });
  if (snapshot(input.claimId) !== before) throw new Error("The payment was not allocated, but a balance changed.");
}

export function recordHeadPayment(input: {
  claimId: string;
  actorId: string;
  head: string;
  amountPence: number;
  correction: boolean;
}) {
  if (!isPaymentChaseHead(input.head)) {
    recordUnreferencedPayment({
      claimId: input.claimId,
      actorId: input.actorId,
      amountPence: input.amountPence,
      note: "No head of loss was chosen.",
    });
    return { allocated: false as const, receivedPence: null, outstandingPence: null, paused: false, paidInFull: false };
  }
  const claim = claimRow(input.claimId);
  if (!claim) throw new Error("File not found.");
  const totalLoss = Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1;
  if (input.head === "vehicle_damage" && !totalLoss) {
    throw new Error("This file is not a total loss. The settlement payment was not recorded.");
  }
  const line = moneyLine(input.claimId, input.head);
  if (!line || Number(line.agreed_pence) <= 0) {
    throw new Error("There is no agreed figure on this head. The payment was not recorded.");
  }
  const agreed = Number(line.agreed_pence) || 0;
  const received = Number(line.received_pence) || 0;
  const outstanding = outstandingOnHead(agreed, received);
  if (!input.correction && input.amountPence > outstanding) {
    flagReview(
      input.claimId,
      input.actorId,
      input.head,
      `${formatGbp(input.amountPence)} is higher than the outstanding ${formatGbp(outstanding)}. It was not added.`,
    );
    throw new Error("That amount is higher than the outstanding balance on this head. It was not recorded.");
  }
  const previous = lastLogged(input.claimId, input.head);
  const applied = applyLoggedPayment({
    receivedPence: received,
    amountPence: input.amountPence,
    previousAmountPence: previous?.amountPence ?? null,
    previousAt: previous?.at ?? null,
    now: nowUtcIso(),
    correction: input.correction,
  });
  if (applied.unchanged) {
    flagReview(input.claimId, input.actorId, input.head, applied.reviewReason || "The balance was not changed.");
    throw new Error(applied.reviewReason || "The balance was not changed.");
  }
  if (applied.receivedPence > agreed) {
    flagReview(
      input.claimId,
      input.actorId,
      input.head,
      "The corrected figure would be higher than the agreed amount. The balance was not changed.",
    );
    throw new Error("That figure would be higher than the agreed amount. The balance was not changed.");
  }
  const storageLine = get<{ received_pence: number; agreed_pence: number }>(
    `SELECT received_pence, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'storage' ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  const kind = kindForHead(input.head);
  const when = nowUtcIso();
  const detail = `head=${input.head} amount_pence=${input.amountPence} correction=${applied.replacedPrevious ? 1 : 0} received_pence=${applied.receivedPence}`;
  if (input.head === "vehicle_damage" && !applied.replacedPrevious) {
    recordTotalLossPaymentReceived({ claimId: input.claimId, actorId: input.actorId, receivedPence: input.amountPence });
  } else {
    run(`UPDATE financial_lines SET received_pence = ? WHERE id = ?`, [applied.receivedPence, line.id]);
    if (input.head === "vehicle_damage") {
      recordClaimEvent({
        claimId: input.claimId,
        eventType: TOTAL_LOSS_PAYMENT_RECEIVED_EVENT,
        occurredAt: when,
        actorId: input.actorId,
        details: `Staff replaced the last settlement figure. Vehicle-damage amount received is now ${(applied.receivedPence / 100).toFixed(2)} pounds. The hire end date was not changed. ${detail}`,
        source: "staff",
      });
    }
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: input.head === "repairs" ? "repair_invoice_payment_logged" : "settlement_payment_logged",
    occurredAt: when,
    actorId: input.actorId,
    details: applied.replacedPrevious
      ? `${detail} Correction. The previous figure was replaced so it was not added twice.`
      : `${detail} Added to the amount already received on this head only.`,
    source: "staff",
    channel: "file",
  });
  const after = moneyLine(input.claimId, input.head);
  const storageAfter = get<{ received_pence: number; agreed_pence: number }>(
    `SELECT received_pence, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'storage' ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  if (
    (storageLine?.received_pence || 0) !== (storageAfter?.received_pence || 0) ||
    (storageLine?.agreed_pence || 0) !== (storageAfter?.agreed_pence || 0)
  ) {
    throw new Error("Storage was changed. That must not happen when a repair or settlement payment is logged.");
  }
  const receivedNow = Number(after?.received_pence || 0);
  const paid = headSettledInFull(agreed, receivedNow);
  const partial = receivedNow > 0 && receivedNow < agreed;
  syncOutstandingPaymentChases([input.claimId]);
  if (partial) {
    pauseChase(kind, input.claimId, PARTIAL_PAUSE);
    flagReview(
      input.claimId,
      input.actorId,
      input.head,
      `Part-payment of ${formatGbp(input.amountPence)}. Balance still outstanding ${formatGbp(outstandingOnHead(agreed, receivedNow))}. Not treated as paid.`,
    );
  }
  if (paid) {
    flagHireStorage(input.claimId, input.actorId, input.head, totalLoss);
  }
  return {
    allocated: true as const,
    receivedPence: receivedNow,
    outstandingPence: outstandingOnHead(agreed, receivedNow),
    paused: partial,
    paidInFull: paid,
    replacedPrevious: applied.replacedPrevious,
  };
}

export { PAYMENT_CORRECTION_WINDOW_MS };

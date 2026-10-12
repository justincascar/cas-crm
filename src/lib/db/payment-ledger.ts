import { nowUtcIso } from "../dates";
import { type ChaseKind } from "../domain/chase";
import { TOTAL_LOSS_PAYMENT_RECEIVED_EVENT } from "../domain/follow-up-chases";
import {
  PAYMENT_CORRECTION_WINDOW_MS,
  applyLoggedPayment,
  outstandingOnHead,
} from "../domain/payment-chase";
import {
  isPaymentReviewHead,
  paymentCoversTarget,
  paymentNeedsReview,
  settlementTargetPence,
  type PaymentReviewHead,
} from "../domain/payment-review";
import { formatGbp } from "../money";
import { chaseRow, pauseChase, syncOutstandingPaymentChases } from "./chase";
import { recordClaimEvent } from "./chronology";
import { all, get, run } from "./connection";
import { comparisonForHead, headDisputeStands } from "./payment-review";
import { recordTotalLossPaymentReceived } from "./total-loss";

const PARTIAL_PAUSE =
  "Paused for review after a part-payment. The balance has been reduced. This is not treated as paid. Resume after review to chase the amount still outstanding. Nothing is sent automatically.";

type MoneyLine = { id: string; agreed_pence: number; received_pence: number; claimed_pence: number; offered_pence: number };

function reviewKind(head: PaymentReviewHead): ChaseKind | null {
  if (head === "repairs") return "repair_payment";
  if (head === "vehicle_damage") return "settlement_payment";
  return null;
}

function moneyLine(claimId: string, head: string): MoneyLine | undefined {
  return get<MoneyLine>(
    `SELECT id, agreed_pence, received_pence, claimed_pence, offered_pence FROM financial_lines
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

function lastLogged(claimId: string, head: string): { amountPence: number; at: string } | null {
  const types =
    head === "repairs"
      ? ["repair_invoice_payment_logged"]
      : head === "vehicle_damage"
        ? ["settlement_payment_logged", TOTAL_LOSS_PAYMENT_RECEIVED_EVENT]
        : ["head_payment_logged"];
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

function flagHireStorage(claimId: string, actorId: string, head: string, totalLoss: boolean) {
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

const AGREED_HEAD_FIGURES = ["hire", "recovery", "storage"] as const;
type AgreedHeadFigure = (typeof AGREED_HEAD_FIGURES)[number];

function isAgreedHeadFigure(head: string): head is AgreedHeadFigure {
  return (AGREED_HEAD_FIGURES as readonly string[]).includes(head);
}

/** Staff-entered agreed figure for hire, recovery or storage. Claimed, received and any running chase are left as they are. */
export function recordAgreedHeadFigure(input: { claimId: string; actorId: string; head: string; agreedPence: number }) {
  if (!claimRow(input.claimId)) throw new Error("File not found.");
  if (!isAgreedHeadFigure(input.head)) {
    throw new Error("An agreed figure of this kind is recorded on hire, recovery, or storage.");
  }
  if (!Number.isInteger(input.agreedPence) || input.agreedPence <= 0) {
    throw new Error("Enter the agreed amount. It is not taken from the claimed figure.");
  }
  const existing = moneyLine(input.claimId, input.head);
  const receivedBefore = existing?.received_pence || 0;
  const claimedBefore = existing?.claimed_pence || 0;
  const label = input.head === "hire" ? "hire" : input.head === "recovery" ? "recovery" : "storage";
  if (existing) {
    run(`UPDATE financial_lines SET agreed_pence = ? WHERE id = ?`, [input.agreedPence, existing.id]);
  } else {
    run(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
      ) VALUES (?, ?, ?, ?, 1, 'job', 0, 0, 0, 0, 0, 0, ?, 0, NULL)`,
      [`agr-${input.head}-${input.claimId}`, input.claimId, input.head, `Agreed ${label} figure`, input.agreedPence],
    );
  }
  const after = moneyLine(input.claimId, input.head);
  if (!after || Number(after.received_pence) !== receivedBefore || (existing && Number(after.claimed_pence) !== claimedBefore)) {
    throw new Error("The agreed figure could not be saved without changing claimed or received.");
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "head_agreed_recorded",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `head=${input.head} Staff recorded ${formatGbp(input.agreedPence)} as the agreed ${label} figure. Claimed and received were not changed. A chase already running was not paused, resumed, or cancelled.`,
    source: "staff",
    channel: "file",
  });
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

function reasonSuffix(reason: string | undefined): string {
  const text = String(reason || "").replace(/\s+/g, " ").trim();
  return `\ninsurer_reason: ${text}`;
}

export function recordHeadPayment(input: {
  claimId: string;
  actorId: string;
  head: string;
  amountPence: number;
  correction: boolean;
  insurerReason?: string;
}) {
  if (!isPaymentReviewHead(input.head)) {
    recordUnreferencedPayment({
      claimId: input.claimId,
      actorId: input.actorId,
      amountPence: input.amountPence,
      note: input.head ? `Head ${input.head} is not a payment head.` : "No head of loss was chosen.",
    });
    return {
      allocated: false as const,
      reconciliation: false as const,
      settledReview: false as const,
      receivedPence: null,
      outstandingPence: null,
      paused: false,
      paidInFull: false,
    };
  }
  const claim = claimRow(input.claimId);
  if (!claim) throw new Error("File not found.");
  const totalLoss = Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1;
  if (input.head === "vehicle_damage" && !totalLoss) {
    throw new Error("This file is not a total loss. The settlement payment was not recorded.");
  }
  const line = moneyLine(input.claimId, input.head);
  const agreed = Number(line?.agreed_pence) || 0;
  const claimed = Number(line?.claimed_pence) || 0;
  const received = Number(line?.received_pence) || 0;
  if (!line || (agreed <= 0 && claimed <= 0)) {
    const amount = input.amountPence > 0 ? formatGbp(input.amountPence) : "an amount";
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "payment_manual_reconciliation",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `head=${input.head} ${amount} was logged against this head, but no claim or invoice is recorded on it. It was not added to the financial record.`,
      source: "staff",
      channel: "file",
    });
    return {
      allocated: false as const,
      reconciliation: true as const,
      settledReview: false as const,
      receivedPence: null,
      outstandingPence: null,
      paused: false,
      paidInFull: false,
    };
  }
  const comparison = comparisonForHead(input.claimId, input.head, { agreedPence: agreed, claimedPence: claimed, receivedPence: received });
  if (comparison.acceptedAsFinal) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "payment_after_settlement_flagged",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `head=${input.head} amount_pence=${input.amountPence} ${formatGbp(input.amountPence)} arrived after this head was accepted as the final figure. It was not added to the agreed or received figures.`,
      source: "staff",
      channel: "file",
    });
    const unchanged = moneyLine(input.claimId, input.head);
    if (!unchanged || Number(unchanged.received_pence) !== received || Number(unchanged.agreed_pence) !== agreed) {
      throw new Error("The settled figures were changed. A payment after acceptance must not be added.");
    }
    return {
      allocated: false as const,
      reconciliation: false as const,
      settledReview: true as const,
      receivedPence: received,
      outstandingPence: 0,
      paused: false,
      paidInFull: true,
    };
  }
  const target = comparison.targetPence;
  if (target == null || target <= 0) {
    throw new Error("There is no figure on this head to compare the payment with. It was not recorded.");
  }
  const outstanding = Math.max(0, target - received);
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
  if (applied.receivedPence > target) {
    flagReview(
      input.claimId,
      input.actorId,
      input.head,
      "The corrected figure would be higher than the amount still to pay on this head. The balance was not changed.",
    );
    throw new Error("That figure would be higher than the amount still to pay on this head. The balance was not changed.");
  }
  const storageLine = get<{ received_pence: number; agreed_pence: number }>(
    `SELECT received_pence, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'storage' ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  const when = nowUtcIso();
  const narrative = applied.replacedPrevious
    ? "Correction. The previous figure was replaced so it was not added twice."
    : "Added to the amount already received on this head only.";
  const detail = `head=${input.head} amount_pence=${input.amountPence} correction=${applied.replacedPrevious ? 1 : 0} received_pence=${applied.receivedPence} ${narrative}${reasonSuffix(input.insurerReason)}`;
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
  const eventType =
    input.head === "repairs" ? "repair_invoice_payment_logged" : input.head === "vehicle_damage" ? "settlement_payment_logged" : "head_payment_logged";
  recordClaimEvent({
    claimId: input.claimId,
    eventType,
    occurredAt: when,
    actorId: input.actorId,
    details: detail,
    source: "staff",
    channel: "file",
  });
  const after = moneyLine(input.claimId, input.head);
  const storageAfter = get<{ received_pence: number; agreed_pence: number }>(
    `SELECT received_pence, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'storage' ORDER BY id LIMIT 1`,
    [input.claimId],
  );
  if (
    input.head !== "storage" &&
    ((storageLine?.received_pence || 0) !== (storageAfter?.received_pence || 0) ||
      (storageLine?.agreed_pence || 0) !== (storageAfter?.agreed_pence || 0))
  ) {
    throw new Error("Storage was changed. That must not happen when another head of loss is paid.");
  }
  const receivedNow = Number(after?.received_pence || 0);
  const agreedNow = Number(after?.agreed_pence || 0);
  const fresh = comparisonForHead(input.claimId, input.head, {
    agreedPence: agreedNow,
    claimedPence: Number(after?.claimed_pence) || 0,
    receivedPence: receivedNow,
  });
  const paid = paymentCoversTarget(fresh.targetPence, receivedNow);
  const partial = paymentNeedsReview(fresh.targetPence, receivedNow);
  syncOutstandingPaymentChases([input.claimId]);
  const kind = reviewKind(input.head);
  const keepChasing = partial && headDisputeStands(input.claimId, input.head);
  if (partial && !keepChasing) {
    if (kind && chaseRow(input.claimId, kind)) {
      pauseChase(kind, input.claimId, PARTIAL_PAUSE);
    }
    flagReview(
      input.claimId,
      input.actorId,
      input.head,
      `Part-payment of ${formatGbp(input.amountPence)}. Balance still outstanding ${formatGbp(outstandingOnHead(fresh.targetPence || 0, receivedNow))}. Not treated as paid.`,
    );
  }
  if (paid) {
    flagHireStorage(input.claimId, input.actorId, input.head, totalLoss);
  }
  return {
    allocated: true as const,
    reconciliation: false as const,
    settledReview: false as const,
    receivedPence: receivedNow,
    outstandingPence: fresh.targetPence == null ? 0 : Math.max(0, fresh.targetPence - receivedNow),
    paused: partial && !keepChasing && Boolean(kind && chaseRow(input.claimId, kind)),
    paidInFull: paid,
    replacedPrevious: applied.replacedPrevious,
  };
}

export { PAYMENT_CORRECTION_WINDOW_MS };

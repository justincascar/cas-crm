import type { DatabaseSync } from "node:sqlite";
import { HEAD_LABELS, INDICATIVE_DEFAULTS, type HeadOfLoss } from "../constants";
import { nowUtcIso } from "../dates";
import { lineFromNet } from "../domain/recovery-fees";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { all, getDb, newId, run } from "./connection";
import { cardFeeOnNet, recoveryCardFeePercent } from "./recovery-fee-settings";

/**
 * Card fees (review note R19). CAS only learns that the payer is using a card when the invoice is paid, so the fee is
 * added then: "Paying by card" on a recorded payment, or on a draft invoice prepared for payment. The fee is the
 * Settings percentage of the net amount being paid, plus VAT. It is kept in its own ledger, never added into the
 * charge for the head of loss, so it cannot be counted twice.
 */

export function ensureCardFeesTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_fees (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      head TEXT NOT NULL,
      payment_pence INTEGER NOT NULL,
      basis_net_pence INTEGER NOT NULL,
      percent REAL NOT NULL,
      net_pence INTEGER NOT NULL,
      vat_pence INTEGER NOT NULL,
      gross_pence INTEGER NOT NULL,
      recorded_by TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_fees_claim ON card_fees(claim_id, head);
  `);
}

function ready() {
  ensureCardFeesTable(getDb());
}

/** Heads charged with VAT. A total-loss settlement (vehicle damage) is paid without VAT. */
const VAT_HEADS = new Set(["recovery", "storage", "hire", "repairs"]);

/** The net part of an amount being paid on a head. */
export function netOfPayment(head: string, amountPence: number, vatRate = INDICATIVE_DEFAULTS.vat_rate): number {
  const amount = Math.max(0, Math.round(amountPence));
  return VAT_HEADS.has(head) ? Math.round(amount / (1 + vatRate)) : amount;
}

export type CardFeeQuote = { percent: number; basisNetPence: number; netPence: number; vatPence: number; grossPence: number };

/** The card fee on an amount being paid: the Settings percentage of its net, plus VAT. */
export function quoteCardFee(head: string, amountPence: number, percent = recoveryCardFeePercent()): CardFeeQuote {
  const basisNetPence = netOfPayment(head, amountPence);
  const line = lineFromNet("cardFee", "Card fee", cardFeeOnNet(basisNetPence, percent));
  return { percent, basisNetPence, netPence: line.netPence, vatPence: line.vatPence, grossPence: line.grossPence };
}

export function cardFeeLabel(quote: Pick<CardFeeQuote, "percent" | "basisNetPence">): string {
  return `Card fee (${quote.percent}% of ${formatGbp(quote.basisNetPence)} net, paid by card)`;
}

/** Recorded with the payment it belongs to. The payment on the head itself is not changed. */
export function recordCardFeeOnPayment(input: { claimId: string; head: string; amountPence: number; actorId: string }) {
  ready();
  const quote = quoteCardFee(input.head, input.amountPence);
  if (quote.netPence <= 0) return null;
  const at = nowUtcIso();
  run(
    `INSERT INTO card_fees(id, claim_id, head, payment_pence, basis_net_pence, percent, net_pence, vat_pence, gross_pence, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("cardfee"), input.claimId, input.head, input.amountPence, quote.basisNetPence, quote.percent, quote.netPence, quote.vatPence, quote.grossPence, input.actorId, at],
  );
  const label = HEAD_LABELS[input.head as HeadOfLoss] || input.head;
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "card_fee_recorded",
    occurredAt: at,
    actorId: input.actorId,
    details: `head=${input.head} The ${label} payment of ${formatGbp(input.amountPence)} was made by card. Card fee ${quote.percent}% of ${formatGbp(quote.basisNetPence)} net = ${formatGbp(quote.netPence)} + VAT ${formatGbp(quote.vatPence)} = ${formatGbp(quote.grossPence)}. Kept separate from the ${label} charge.`,
    source: "staff",
    channel: "file",
  });
  return quote;
}

export type CardFeeRow = {
  head: string;
  paymentPence: number;
  basisNetPence: number;
  percent: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  recordedAt: string;
};

export function listCardFees(claimId: string, head?: string): CardFeeRow[] {
  ready();
  const rows = all<{
    head: string;
    payment_pence: number;
    basis_net_pence: number;
    percent: number;
    net_pence: number;
    vat_pence: number;
    gross_pence: number;
    recorded_at: string;
  }>(
    `SELECT head, payment_pence, basis_net_pence, percent, net_pence, vat_pence, gross_pence, recorded_at FROM card_fees
     WHERE claim_id = ?${head ? " AND head = ?" : ""} ORDER BY recorded_at`,
    head ? [claimId, head] : [claimId],
  );
  return rows.map((row) => ({
    head: String(row.head),
    paymentPence: Number(row.payment_pence),
    basisNetPence: Number(row.basis_net_pence),
    percent: Number(row.percent),
    netPence: Number(row.net_pence),
    vatPence: Number(row.vat_pence),
    grossPence: Number(row.gross_pence),
    recordedAt: String(row.recorded_at),
  }));
}

export function cardFeeTotals(rows: CardFeeRow[]) {
  return rows.reduce(
    (total, row) => ({ netPence: total.netPence + row.netPence, vatPence: total.vatPence + row.vatPence, grossPence: total.grossPence + row.grossPence }),
    { netPence: 0, vatPence: 0, grossPence: 0 },
  );
}

const KEPT_MARK = "card fee saved under the old tick on the recovery form";

/**
 * Data repair for R19: a card fee saved on a recovery under the old tick is kept as it was, with a history note.
 * Runs once per file.
 */
export function noteKeptRecoveryCardFees(db: DatabaseSync) {
  const jobs = db
    .prepare(`SELECT claim_id, charge_lines_json FROM recovery_jobs WHERE charge_lines_json LIKE '%"cardFee"%'`)
    .all() as Array<{ claim_id: string; charge_lines_json: string }>;
  for (const job of jobs) {
    const noted = db.prepare(`SELECT 1 FROM claim_events WHERE claim_id = ? AND details LIKE ?`).get(job.claim_id, `%${KEPT_MARK}%`);
    if (noted) continue;
    let fee: { netPence: number; vatPence: number; grossPence: number } | undefined;
    try {
      fee = (JSON.parse(job.charge_lines_json) as Array<{ key: string; netPence: number; vatPence: number; grossPence: number }>).find((line) => line.key === "cardFee");
    } catch {
      fee = undefined;
    }
    if (!fee) continue;
    const at = nowUtcIso();
    db.prepare(
      `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
       VALUES (?, ?, 'other', 'Card fee kept', ?, ?, ?, NULL, 'system')`,
    ).run(
      `ev-cardfee-kept-${job.claim_id}`,
      job.claim_id,
      `The ${KEPT_MARK} (${formatGbp(fee.netPence)} + VAT ${formatGbp(fee.vatPence)} = ${formatGbp(fee.grossPence)}) is kept as it was. Card fees are now added when a card payment is recorded or a draft invoice is prepared for payment.`,
      at,
      at,
    );
  }
}

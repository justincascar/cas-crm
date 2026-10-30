import type { DatabaseSync } from "node:sqlite";
import { HEAD_LABELS, type HeadOfLoss } from "../constants";
import { nowUtcIso } from "../dates";
import { lineFromNet } from "../domain/recovery-fees";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { all, getDb, newId, run } from "./connection";
import { cardFeeOnAmount, recoveryCardFeePercent } from "./recovery-fee-settings";

/**
 * Card fees (review note R19). CAS only learns that the payer is using a card when the invoice is paid, so the fee is
 * added then: "Paying by card" on a recorded payment, or on a draft invoice prepared for payment. The fee is the
 * Settings percentage of the gross amount being paid (VAT included, R25), plus VAT on the fee. Fees recorded before R25
 * were worked out on the net and keep that basis (basis_kind 'net'). It is kept in its own ledger, never added into the
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
  const columns = new Set((db.prepare(`PRAGMA table_info(card_fees)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("basis_kind")) db.exec(`ALTER TABLE card_fees ADD COLUMN basis_kind TEXT NOT NULL DEFAULT 'net'`);
}

function ready() {
  ensureCardFeesTable(getDb());
}

export type CardFeeQuote = { percent: number; basisPence: number; netPence: number; vatPence: number; grossPence: number };

/** The card fee on an amount being paid: the Settings percentage of the gross amount, then VAT on the fee (R25). */
export function quoteCardFee(amountPence: number, percent = recoveryCardFeePercent()): CardFeeQuote {
  const basisPence = Math.max(0, Math.round(amountPence));
  const line = lineFromNet("cardFee", "Card fee", cardFeeOnAmount(basisPence, percent));
  return { percent, basisPence, netPence: line.netPence, vatPence: line.vatPence, grossPence: line.grossPence };
}

/** "Card fee 4.5% of £X", as on the invoice line. A fee recorded before R25 says it was worked out on the net. */
export function cardFeeLabel(fee: { percent: number; basisPence: number; basisKind?: string }): string {
  return `Card fee ${fee.percent}% of ${formatGbp(fee.basisPence)}${fee.basisKind === "net" ? " net" : ""}`;
}

/** Recorded with the payment it belongs to. The payment on the head itself is not changed. */
export function recordCardFeeOnPayment(input: { claimId: string; head: string; amountPence: number; actorId: string }) {
  ready();
  const quote = quoteCardFee(input.amountPence);
  if (quote.netPence <= 0) return null;
  const at = nowUtcIso();
  run(
    `INSERT INTO card_fees(id, claim_id, head, payment_pence, basis_net_pence, percent, net_pence, vat_pence, gross_pence, recorded_by, recorded_at, basis_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gross')`,
    [newId("cardfee"), input.claimId, input.head, input.amountPence, quote.basisPence, quote.percent, quote.netPence, quote.vatPence, quote.grossPence, input.actorId, at],
  );
  const label = HEAD_LABELS[input.head as HeadOfLoss] || input.head;
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "card_fee_recorded",
    occurredAt: at,
    actorId: input.actorId,
    details: `head=${input.head} The ${label} payment of ${formatGbp(input.amountPence)} was made by card. ${cardFeeLabel(quote)} = ${formatGbp(quote.netPence)} + VAT ${formatGbp(quote.vatPence)} = ${formatGbp(quote.grossPence)}. Kept separate from the ${label} charge.`,
    source: "staff",
    channel: "file",
  });
  return quote;
}

export type CardFeeRow = {
  head: string;
  paymentPence: number;
  basisPence: number;
  basisKind: string;
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
    basis_kind: string;
    percent: number;
    net_pence: number;
    vat_pence: number;
    gross_pence: number;
    recorded_at: string;
  }>(
    `SELECT head, payment_pence, basis_net_pence, basis_kind, percent, net_pence, vat_pence, gross_pence, recorded_at FROM card_fees
     WHERE claim_id = ?${head ? " AND head = ?" : ""} ORDER BY recorded_at`,
    head ? [claimId, head] : [claimId],
  );
  return rows.map((row) => ({
    head: String(row.head),
    paymentPence: Number(row.payment_pence),
    basisPence: Number(row.basis_net_pence),
    basisKind: String(row.basis_kind || "net"),
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

import type { DatabaseSync } from "node:sqlite";
import { INDICATIVE_DEFAULTS } from "../constants";
import { nowUtcIso } from "../dates";
import { storageCharge } from "../domain/storage-charge";
import { grossFromNet } from "../money";

/**
 * Demonstration rows only. TEST-0008 gains an insurer offer on hire and keeps its hire money.
 * TEST-0011 gains a storage payment-chase row when its storage end is already confirmed.
 * No storage end is written. TEST-0005 is not confirmed. No email is sent.
 */
export function ensureChargeFigureDemonstration(db: DatabaseSync) {
  const endsBefore = storageEnds(db);
  const hireBefore = hireMoney(db);
  const c5Before = endOn(db, "c5");
  insertHireOffer(db);
  insertStorageChase(db);
  if (storageEnds(db) !== endsBefore) {
    throw new Error("Preparing the charge demonstration changed a storage end. That must not happen.");
  }
  if (hireMoney(db) !== hireBefore) {
    throw new Error("Preparing the charge demonstration changed TEST-0008 hire money. That must not happen.");
  }
  if (endOn(db, "c5") !== c5Before) {
    throw new Error("Preparing the charge demonstration changed TEST-0005's storage end. That must not happen.");
  }
}

function insertHireOffer(db: DatabaseSync) {
  const claim = db.prepare(`SELECT id FROM claims WHERE id = 'c8'`).get();
  const megan = db.prepare(`SELECT id FROM staff WHERE id = 'staff-megan'`).get();
  if (!claim || !megan) return;
  const existing = db.prepare(`SELECT id FROM insurer_offers WHERE id = 'offer-c8-hire-below'`).get();
  if (existing) return;
  db.prepare(
    `INSERT INTO insurer_offers(
      id, claim_id, head_of_loss, amount_pence, offered_on, note, status, recorded_at, recorded_by
    ) VALUES ('offer-c8-hire-below', 'c8', 'hire', 150000, '2026-10-01', ?, 'open', ?, 'staff-megan')`,
  ).run("Insurer offer on hire, below the claimed figure. Awaiting decision.", nowUtcIso());
}

function insertStorageChase(db: DatabaseSync) {
  const claim = db.prepare(
    `SELECT id, storage_billing_end_on, storage_started_on, storage_rate_pence FROM claims WHERE id = 'c11'`,
  ).get() as
    | { id: string; storage_billing_end_on: string | null; storage_started_on: string | null; storage_rate_pence: number | null }
    | undefined;
  if (!claim || !String(claim.storage_billing_end_on || "").trim()) return;
  const justin = db.prepare(`SELECT id FROM staff WHERE id = 'staff-justin'`).get();
  if (!justin) return;
  const line = db.prepare(`SELECT id, claimed_pence FROM financial_lines WHERE claim_id = 'c11' AND head_of_loss = 'storage' ORDER BY id LIMIT 1`).get() as
    | { id: string; claimed_pence: number }
    | undefined;
  if (!line) {
    const priced = storageFigure(claim);
    if (!priced) return;
    db.prepare(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence
      ) VALUES ('f-c11-st', 'c11', 'storage', 'Storage', ?, 'days', ?, ?, ?, ?, ?, 0, 0, 0)`,
    ).run(priced.days, priced.ratePence, priced.netPence, priced.vatPence, priced.totalPence, priced.totalPence);
  } else if ((Number(line.claimed_pence) || 0) <= 0) {
    return;
  }
  const sent = db.prepare(`SELECT id FROM claim_events WHERE id = 'ev-c11-storage-pay-request'`).get();
  if (!sent) {
    const at = nowUtcIso();
    db.prepare(
      `INSERT INTO claim_events(
        id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
      ) VALUES ('ev-c11-storage-pay-request', 'c11', 'storage_payment_request_sent', 'Storage payment request marked as sent', ?, ?, ?, 'staff-justin', 'file', 'staff')`,
    ).run("head=storage Payment request recorded as sent. No email was sent from this demonstration row.", at, at);
  }
}

function storageFigure(claim: { storage_started_on: string | null; storage_billing_end_on: string | null; storage_rate_pence: number | null }) {
  const end = String(claim.storage_billing_end_on || "").slice(0, 10);
  const start = String(claim.storage_started_on || "").slice(0, 10);
  const rate = Number(claim.storage_rate_pence) || INDICATIVE_DEFAULTS.storage_per_day_net_pence;
  if (start && end) {
    const charge = storageCharge({ startDay: start, confirmedEndDay: end, today: end, ratePence: rate });
    if (charge.status === "calculated") {
      return { days: charge.days, ratePence: charge.ratePence, netPence: charge.netPence, vatPence: charge.vatPence, totalPence: charge.totalPence };
    }
  }
  const oneDay = grossFromNet(rate);
  return { days: 1, ratePence: rate, netPence: oneDay.net, vatPence: oneDay.vat, totalPence: oneDay.gross };
}

function hireMoney(db: DatabaseSync): string {
  const row = db.prepare(
    `SELECT claimed_pence, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'hire' ORDER BY id LIMIT 1`,
  ).get() as { claimed_pence: number; offered_pence: number; agreed_pence: number; received_pence: number } | undefined;
  if (!row) return "";
  return `${row.claimed_pence}|${row.offered_pence}|${row.agreed_pence}|${row.received_pence}`;
}

function storageEnds(db: DatabaseSync): string {
  const rows = db.prepare(`SELECT id, storage_billing_end_on FROM claims ORDER BY id`).all() as Array<{
    id: string;
    storage_billing_end_on: string | null;
  }>;
  return rows.map((row) => `${row.id}=${row.storage_billing_end_on || ""}`).join(";");
}

function endOn(db: DatabaseSync, id: string): string {
  const row = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = ?`).get(id) as
    | { storage_billing_end_on: string | null }
    | undefined;
  return String(row?.storage_billing_end_on || "");
}

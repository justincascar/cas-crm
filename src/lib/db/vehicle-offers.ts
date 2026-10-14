import { applicableVehicleHead } from "../domain/head-screen";
import { dayRateMismatchesOffer } from "../domain/figure-resolution";
import { formatGbp } from "../money";
import { nowUtcIso } from "../dates";
import { get, all, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";

export type VehicleOfferHead = "repairs" | "vehicle_damage" | "hire" | "storage" | "recovery";
export type VehicleOfferStatus = "open" | "withdrawn" | "lapsed" | "rejected";

export type VehicleOffer = {
  id: string;
  amountPence: number;
  offeredOn: string;
  note: string;
  status: VehicleOfferStatus;
  recordedAt: string;
  closedNote: string;
  closedAt: string | null;
  offeredDays: number | null;
  offeredDailyRatePence: number | null;
  rateMismatch: boolean;
};

/** A second save of the same open offer inside this window is the same press, not a new offer. */
export const SAME_OFFER_WINDOW_MS = 60_000;

const NOTE_LIMIT = 500;

export function requireCalendarDate(raw: string, label: string): string {
  const text = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Enter ${label}.`);
  const [year, month, day] = text.split("-").map((part) => Number.parseInt(part, 10));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Enter ${label}.`);
  }
  return text;
}

export function vehicleOfferHead(claimId: string): VehicleOfferHead {
  const claim = get<{ total_loss: number; later_declared_total_loss: number }>(
    `SELECT total_loss, later_declared_total_loss FROM claims WHERE id = ?`,
    [claimId],
  );
  if (!claim) throw new Error("File not found.");
  return applicableVehicleHead(Number(claim.total_loss) === 1 || Number(claim.later_declared_total_loss) === 1);
}

export function listChargeOffers(claimId: string, head: "hire" | "storage" | "recovery"): VehicleOffer[] {
  return listVehicleOffers(claimId, head);
}

export function listVehicleOffers(claimId: string, head: VehicleOfferHead): VehicleOffer[] {
  return all<{
    id: string;
    amount_pence: number;
    offered_on: string;
    note: string;
    status: string;
    recorded_at: string;
    closed_note: string | null;
    closed_at: string | null;
    offered_days: number | null;
    offered_daily_rate_pence: number | null;
  }>(
    `SELECT id, amount_pence, offered_on, note, status, recorded_at, closed_note, closed_at, offered_days, offered_daily_rate_pence
     FROM insurer_offers
     WHERE claim_id = ? AND head_of_loss = ?
     ORDER BY offered_on DESC, recorded_at DESC`,
    [claimId, head],
  ).map((row) => {
    const amountPence = Number(row.amount_pence) || 0;
    const offeredDays = row.offered_days == null ? null : Number(row.offered_days);
    const offeredDailyRatePence = row.offered_daily_rate_pence == null ? null : Number(row.offered_daily_rate_pence);
    return {
      id: row.id,
      amountPence,
      offeredOn: row.offered_on,
      note: row.note || "",
      status: offerStatus(row.status),
      recordedAt: row.recorded_at,
      closedNote: row.closed_note || "",
      closedAt: row.closed_at || null,
      offeredDays,
      offeredDailyRatePence,
      rateMismatch: dayRateMismatchesOffer(offeredDays, offeredDailyRatePence, amountPence),
    };
  });
}

/** An offered figure already stored on the financial line, when this screen has no dated offers yet. */
export function undatedOfferPence(claimId: string, head: VehicleOfferHead): number | null {
  if (listVehicleOffers(claimId, head).length > 0) return null;
  const line = get<{ offered_pence: number }>(
    `SELECT offered_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  const offered = Number(line?.offered_pence) || 0;
  return offered > 0 ? offered : null;
}

export function agreedOnFor(claimId: string, head: VehicleOfferHead): string | null {
  const line = get<{ agreed_on: string | null; agreed_pence: number }>(
    `SELECT agreed_on, agreed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  if (!line || Number(line.agreed_pence) <= 0) return null;
  const date = String(line.agreed_on || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function recordVehicleOffer(input: {
  claimId: string;
  actorId: string;
  head: VehicleOfferHead;
  amountPence: number;
  offeredOn: string;
  note: string;
  offeredDays?: number | null;
  offeredDailyRatePence?: number | null;
}) {
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) {
    throw new Error("Enter the amount the insurer offered. It is not taken from the claimed or agreed figure.");
  }
  const offeredOn = requireCalendarDate(input.offeredOn, "the date of the offer");
  const note = input.note.trim();
  if (note.length > NOTE_LIMIT) throw new Error("The note is too long.");
  const offeredDays = optionalPositiveInt(input.offeredDays, "offered days");
  const offeredDailyRatePence = optionalPositiveInt(input.offeredDailyRatePence, "offered daily rate");
  const existing = get<{ id: string; recorded_at: string }>(
    `SELECT id, recorded_at FROM insurer_offers
     WHERE claim_id = ? AND head_of_loss = ? AND amount_pence = ? AND offered_on = ? AND note = ? AND status = 'open'
       AND offered_days IS ? AND offered_daily_rate_pence IS ?
     ORDER BY recorded_at DESC LIMIT 1`,
    [input.claimId, input.head, input.amountPence, offeredOn, note, offeredDays, offeredDailyRatePence],
  );
  if (existing && sameOfferStillOpen(existing.recorded_at)) return existing.id;
  const before = moneySnapshot(input.claimId, input.head);
  const id = newId("offer");
  const at = nowUtcIso();
  run(
    `INSERT INTO insurer_offers(
      id, claim_id, head_of_loss, amount_pence, offered_on, note, status, recorded_at, recorded_by, offered_days, offered_daily_rate_pence
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [id, input.claimId, input.head, input.amountPence, offeredOn, note, at, input.actorId, offeredDays, offeredDailyRatePence],
  );
  syncCurrentOffer(input.claimId, input.head, before);
  const noted = note ? ` Note: ${note}` : "";
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "insurer_offer_recorded",
    occurredAt: at,
    actorId: input.actorId,
    details: `head=${input.head} Insurer offer of ${formatGbp(input.amountPence)} dated ${offeredOn.split("-").reverse().join("/")}. It was not saved as the agreed figure.${noted}`,
    source: "staff",
    channel: "file",
  });
  return id;
}

export function markVehicleOffer(input: {
  claimId: string;
  actorId: string;
  head: VehicleOfferHead;
  offerId: string;
  status: "withdrawn" | "lapsed" | "rejected";
  note?: string;
}) {
  const offer = get<{ id: string; amount_pence: number; offered_on: string; status: string }>(
    `SELECT id, amount_pence, offered_on, status FROM insurer_offers WHERE id = ? AND claim_id = ? AND head_of_loss = ?`,
    [input.offerId, input.claimId, input.head],
  );
  if (!offer || offer.status !== "open") {
    throw new Error("That offer is already closed, or it is not on this screen.");
  }
  const closedNote = input.status === "rejected" ? String(input.note || "").trim() : "";
  if (closedNote.length > NOTE_LIMIT) throw new Error("The note is too long.");
  const before = moneySnapshot(input.claimId, input.head);
  const at = nowUtcIso();
  run(
    `UPDATE insurer_offers SET status = ?, closed_at = ?, closed_by = ?, closed_note = ? WHERE id = ?`,
    [input.status, at, input.actorId, closedNote, offer.id],
  );
  syncCurrentOffer(input.claimId, input.head, before);
  const word = input.status === "withdrawn" ? "withdrawn" : input.status === "lapsed" ? "lapsed" : "rejected";
  const noted = closedNote ? ` Note: ${closedNote}` : "";
  recordClaimEvent({
    claimId: input.claimId,
    eventType:
      input.status === "withdrawn"
        ? "insurer_offer_withdrawn"
        : input.status === "lapsed"
          ? "insurer_offer_lapsed"
          : "insurer_offer_rejected",
    occurredAt: at,
    actorId: input.actorId,
    details: `head=${input.head} The offer of ${formatGbp(Number(offer.amount_pence))} dated ${String(offer.offered_on).split("-").reverse().join("/")} was marked ${word}. It was kept on the file. The agreed figure was not changed.${noted}`,
    source: "staff",
    channel: "file",
  });
}

function optionalPositiveInt(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Enter the ${label} as a whole number, or leave it blank.`);
  return n;
}

function offerStatus(status: string): VehicleOfferStatus {
  if (status === "withdrawn" || status === "lapsed" || status === "rejected") return status;
  return "open";
}

function sameOfferStillOpen(recordedAt: string): boolean {
  const recorded = Date.parse(recordedAt);
  if (Number.isNaN(recorded)) return false;
  const age = Date.now() - recorded;
  return age >= 0 && age < SAME_OFFER_WINDOW_MS;
}

type MoneySnapshot = { id: string | null; claimed: number; agreed: number; received: number };

function moneySnapshot(claimId: string, head: string): MoneySnapshot {
  const line = get<{ id: string; claimed_pence: number; agreed_pence: number; received_pence: number }>(
    `SELECT id, claimed_pence, agreed_pence, received_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  if (!line) return { id: null, claimed: 0, agreed: 0, received: 0 };
  return {
    id: line.id,
    claimed: Number(line.claimed_pence) || 0,
    agreed: Number(line.agreed_pence) || 0,
    received: Number(line.received_pence) || 0,
  };
}

/** The latest offer still open becomes the single offered figure. Claimed, agreed and received stay as they were. */
function syncCurrentOffer(claimId: string, head: VehicleOfferHead, before: MoneySnapshot) {
  const latest = get<{ amount_pence: number }>(
    `SELECT amount_pence FROM insurer_offers
     WHERE claim_id = ? AND head_of_loss = ? AND status = 'open'
     ORDER BY offered_on DESC, recorded_at DESC LIMIT 1`,
    [claimId, head],
  );
  const offered = latest ? Number(latest.amount_pence) || 0 : 0;
  if (!before.id) {
    if (offered <= 0) return;
    run(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
      ) VALUES (?, ?, ?, 'Insurer offer', 1, 'item', 0, 0, 0, 0, 0, ?, 0, 0, NULL)`,
      [`off-${head}-${claimId}`, claimId, head, offered],
    );
    return;
  }
  run(`UPDATE financial_lines SET offered_pence = ? WHERE id = ?`, [offered, before.id]);
  const after = moneySnapshot(claimId, head);
  if (after.claimed !== before.claimed || after.agreed !== before.agreed || after.received !== before.received) {
    throw new Error("The offer could not be saved without changing claimed, agreed or received.");
  }
}

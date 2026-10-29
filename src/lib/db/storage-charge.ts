import type { DatabaseSync } from "node:sqlite";
import { isOfficeRole } from "../auth/roles";
import { INDICATIVE_DEFAULTS, SETTING_STORAGE_DAILY_RATE_PENCE } from "../constants";
import {
  recoveryClaimDecision,
  recoveryJobNetPence,
  storageCharge,
  type StorageCharge,
} from "../domain/storage-charge";
import { londonTodayIso, nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { all, get, run } from "./connection";
import { getScreenData } from "./screens";
import { storageAuthorisationEndForClaim } from "./storage-authorisation-end";
import { calendarDay } from "./storage-recovery-date";

export function officeFinancialError(role: string | null | undefined): string | null {
  if (isOfficeRole(role)) return null;
  return "You cannot open the money on this file.";
}

export function unconfirmedStorageClaimIds(): Set<string> {
  return new Set(
    all<{ id: string }>(
      `SELECT id FROM claims WHERE storage_billing_end_on IS NULL OR trim(storage_billing_end_on) = ''`,
    ).map((row) => row.id),
  );
}

export function ensureStorageDailyRateSetting(db: DatabaseSync) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTING_STORAGE_DAILY_RATE_PENCE) as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(
      SETTING_STORAGE_DAILY_RATE_PENCE,
      String(INDICATIVE_DEFAULTS.storage_per_day_net_pence),
    );
  }
}

export function getStorageDailyRatePence(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_STORAGE_DAILY_RATE_PENCE]);
  const parsed = Number.parseInt(row?.value || "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) return INDICATIVE_DEFAULTS.storage_per_day_net_pence;
  return parsed;
}

/** Changes the setting only. Rates already stored on a claim are left as they are. */
export function setStorageDailyRatePence(pence: number) {
  if (!Number.isInteger(pence) || pence < 0) throw new Error("Enter the storage daily rate.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [SETTING_STORAGE_DAILY_RATE_PENCE]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(pence), SETTING_STORAGE_DAILY_RATE_PENCE]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_STORAGE_DAILY_RATE_PENCE, String(pence)]);
}

type StorageMoneyRow = {
  storage_started_on: string | null;
  storage_billing_end_on: string | null;
  storage_rate_pence: number | null;
};

function storageRow(claimId: string) {
  return get<StorageMoneyRow>(
    `SELECT storage_started_on, storage_billing_end_on, storage_rate_pence FROM claims WHERE id = ?`,
    [claimId],
  );
}

export function effectiveStorageRatePence(storedRate: number | null | undefined): { pence: number; overridden: boolean } {
  if (storedRate != null && Number.isInteger(Number(storedRate))) {
    return { pence: Number(storedRate), overridden: true };
  }
  return { pence: getStorageDailyRatePence(), overridden: false };
}

/** A live proposal only. A stored end, a conflict, or a review flag is not a proposal to charge to. */
export function proposedStorageEndDay(claimId: string): string | null {
  const decision = storageAuthorisationEndForClaim(claimId);
  if (decision.kind === "suggest") return decision.date;
  return null;
}

export function storageChargeForClaim(claimId: string, today = londonTodayIso()): StorageCharge | null {
  const claim = storageRow(claimId);
  if (!claim) return null;
  const rate = effectiveStorageRatePence(claim.storage_rate_pence);
  return storageCharge({
    startDay: calendarDay(claim.storage_started_on),
    confirmedEndDay: calendarDay(claim.storage_billing_end_on),
    proposedEndDay: proposedStorageEndDay(claimId),
    today,
    ratePence: rate.pence,
  });
}

type LineMoney = {
  id: string;
  claimed_pence: number;
  agreed_pence: number;
  received_pence: number;
  offered_pence: number;
};

function headLine(claimId: string, head: "storage" | "recovery") {
  return get<LineMoney>(
    `SELECT id, claimed_pence, agreed_pence, received_pence, offered_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
}

export function recoveryLineForClaim(claimId: string) {
  return headLine(claimId, "recovery") ?? null;
}

export function storageLineForClaim(claimId: string) {
  return headLine(claimId, "storage") ?? null;
}

function writeClaimed(input: {
  claimId: string;
  head: "storage" | "recovery";
  description: string;
  claimedPence: number;
  netPence: number;
  vatPence: number;
  ratePence: number;
  quantity: number;
  unit: string;
}) {
  const existing = headLine(input.claimId, input.head);
  const agreedBefore = Number(existing?.agreed_pence) || 0;
  const receivedBefore = Number(existing?.received_pence) || 0;
  const offeredBefore = Number(existing?.offered_pence) || 0;
  if (existing) {
    run(
      `UPDATE financial_lines
       SET description = ?, claimed_pence = ?, net_pence = ?, vat_pence = ?, gross_pence = ?, rate_pence = ?, quantity = ?, unit = ?
       WHERE id = ?`,
      [
        input.description,
        input.claimedPence,
        input.netPence,
        input.vatPence,
        input.claimedPence,
        input.ratePence,
        input.quantity,
        input.unit,
        existing.id,
      ],
    );
  } else {
    run(
      `INSERT INTO financial_lines(
        id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
        claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
      [
        `${input.head}-${input.claimId}`,
        input.claimId,
        input.head,
        input.description,
        input.quantity,
        input.unit,
        input.ratePence,
        input.netPence,
        input.vatPence,
        input.claimedPence,
        input.claimedPence,
      ],
    );
  }
  const after = headLine(input.claimId, input.head);
  if (!after || Number(after.agreed_pence) !== agreedBefore || Number(after.received_pence) !== receivedBefore || Number(after.offered_pence) !== offeredBefore) {
    throw new Error("The claimed figure could not be saved without changing agreed, offered or received.");
  }
}

function figureMode(claimId: string, head: "storage" | "recovery"): "follow" | "kept" | null {
  const row = get<{ event_type: string }>(
    `SELECT event_type FROM claim_events
     WHERE claim_id = ? AND event_type IN ('stored_figure_use_calculated', 'stored_figure_kept') AND details LIKE ?
     ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1`,
    [claimId, `%head=${head}%`],
  );
  if (!row) return null;
  return row.event_type === "stored_figure_kept" ? "kept" : "follow";
}

/** Recalculates the storage claimed figure only. Payments and the agreed figure stay as they are. Dates are not written. */
export function syncStorageClaimed(claimId: string, today = londonTodayIso(), options?: { force?: boolean }) {
  const charge = storageChargeForClaim(claimId, today);
  if (!charge || charge.status !== "calculated") return charge;
  const mode = figureMode(claimId, "storage");
  if (mode === "kept") return charge;
  const stored = Number(headLine(claimId, "storage")?.claimed_pence) || 0;
  if (stored > 0 && stored !== charge.totalPence && mode !== "follow" && !options?.force) return charge;
  writeClaimed({
    claimId,
    head: "storage",
    description: charge.label ? `Storage, ${charge.label.charAt(0).toLowerCase()}${charge.label.slice(1)}` : "Storage",
    claimedPence: charge.totalPence,
    netPence: charge.netPence,
    vatPence: charge.vatPence,
    ratePence: charge.ratePence,
    quantity: charge.days,
    unit: "days",
  });
  return charge;
}

export function setClaimStorageRate(input: { claimId: string; actorId: string; ratePence: number; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Record a reason before changing the daily rate on this file.");
  if (!Number.isInteger(input.ratePence) || input.ratePence < 0) throw new Error("Enter the daily rate for this file.");
  const before = storageRow(input.claimId);
  if (!before) throw new Error("File not found.");
  const receivedBefore = Number(headLine(input.claimId, "storage")?.received_pence) || 0;
  run(`UPDATE claims SET storage_rate_pence = ? WHERE id = ?`, [input.ratePence, input.claimId]);
  const after = storageRow(input.claimId);
  if (
    calendarDay(after?.storage_started_on) !== calendarDay(before.storage_started_on) ||
    calendarDay(after?.storage_billing_end_on) !== calendarDay(before.storage_billing_end_on)
  ) {
    throw new Error("Changing the daily rate must not change a storage date.");
  }
  syncStorageClaimed(input.claimId, undefined, { force: true });
  const receivedAfter = Number(headLine(input.claimId, "storage")?.received_pence) || 0;
  if (receivedAfter !== receivedBefore) throw new Error("Changing the daily rate must not change a payment.");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "storage_rate_changed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Daily storage rate on this file set to ${input.ratePence} pence. Reason: ${reason}. Payments were not changed.`,
    source: "staff",
  });
}

type RecoveryJob = {
  location: string | null;
  car_condition: string | null;
  not_driveable_reason: string | null;
  not_driveable_detail: string | null;
  recovered_at: string | null;
  charge_pence: number | null;
  ooh_pence: number | null;
  environmental_pence: number | null;
  winch_pence: number | null;
  forklift_pence: number | null;
  mileage_pence: number | null;
  manual_pence: number | null;
  specialist_winch_pence: number | null;
  skates_pence: number | null;
  waiting_pence: number | null;
  second_operator_pence: number | null;
  charge_lines_json: string | null;
  inherited: number | null;
  inherited_note: string | null;
  inherited_company: string | null;
  inherited_net_pence: number | null;
  inherited_vat_pence: number | null;
  manual_description: string | null;
};

export function recoveryJobForClaim(claimId: string) {
  return get<RecoveryJob>(
    `SELECT location, recovered_at, charge_pence, ooh_pence, environmental_pence, winch_pence, forklift_pence, mileage_pence, manual_pence,
            specialist_winch_pence, skates_pence, waiting_pence, second_operator_pence, charge_lines_json,
            inherited, inherited_note, inherited_company, inherited_net_pence, inherited_vat_pence, manual_description,
            car_condition, not_driveable_reason, not_driveable_detail
     FROM recovery_jobs WHERE claim_id = ? ORDER BY id LIMIT 1`,
    [claimId],
  );
}

export function recoveryCarrierName(claimId: string): string | null {
  const assigned = get<{ name: string }>(
    `SELECT s.name AS name FROM day_assignments a
     LEFT JOIN staff s ON s.id = COALESCE(a.actual_driver_id, a.assignee_id)
     WHERE a.claim_id = ? AND a.job_kind = 'client_recovery'
     ORDER BY a.work_date DESC LIMIT 1`,
    [claimId],
  );
  const name = String(assigned?.name || "").trim();
  return name || null;
}

export function recoveryClaimForClaim(claimId: string) {
  const screen = getScreenData(claimId, "recovery");
  const job = recoveryJobForClaim(claimId);
  const existing = Number(headLine(claimId, "recovery")?.claimed_pence) || 0;
  return recoveryClaimDecision({
    screen,
    jobNetPence: recoveryJobNetPence(job),
    existingClaimedPence: existing,
  });
}

/** Writes the recovery claimed figure from the existing calculation. Agreed, offered and received stay as they are. */
export function syncRecoveryClaimed(claimId: string, options?: { force?: boolean }) {
  const decision = recoveryClaimForClaim(claimId);
  if (!decision.write) return decision;
  const mode = figureMode(claimId, "recovery");
  if (mode === "kept") return { ...decision, write: false };
  const stored = Number(headLine(claimId, "recovery")?.claimed_pence) || 0;
  if (stored > 0 && stored !== decision.totalPence && mode !== "follow" && !options?.force) {
    return { ...decision, write: false };
  }
  writeClaimed({
    claimId,
    head: "recovery",
    description: "Recovery",
    claimedPence: decision.totalPence,
    netPence: decision.netPence,
    vatPence: decision.vatPence,
    ratePence: decision.totalPence,
    quantity: 1,
    unit: "job",
  });
  return decision;
}

export function latestManualStorageEndReason(claimId: string): string | null {
  const row = get<{ details: string | null }>(
    `SELECT details FROM claim_events
     WHERE claim_id = ? AND event_type = 'storage_end_date_confirmed' AND details LIKE '%Reason:%'
     ORDER BY occurred_at DESC LIMIT 1`,
    [claimId],
  );
  const match = String(row?.details || "").match(/Reason:\s*(.+)$/);
  const reason = match?.[1]?.trim() || "";
  return reason || null;
}

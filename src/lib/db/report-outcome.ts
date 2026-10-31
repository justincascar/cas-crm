import { formatUkDate, nowUtcIso } from "../dates";
import { asSalvageCategory } from "../domain/total-loss";
import { formatGbp } from "../money";
import { recordClaimEvent } from "./chronology";
import { get, run } from "./connection";
import { flagStorageEndOnTotalLoss } from "./storage-authorisation-end";
import { saveTotalLossReport } from "./total-loss";
import { closeRepairStepsForTotalLoss } from "./total-loss-switch";

/**
 * Step 6, the engineer's report received (review note R32): the outcome is asked for there, not left to a task after
 * step 7, so the chase at step 7 asks for the right thing.
 *   - Repairable: the estimate (net, VAT, gross) goes to the Repairs head as the amount claimed.
 *   - Total loss: the pre-accident value, salvage category and salvage deduction go to the total-loss figures, and the
 *     pre-accident value less the deduction to the vehicle damage head as the amount claimed.
 *   - Not yet known: nothing is filled, and the task to set the outcome still comes at step 7.
 * Offered, agreed and received are never changed here.
 */

export type ReportOutcome = "repairable" | "total_loss" | "unknown";

export type ReportOutcomeInput = {
  claimId: string;
  actorId: string;
  outcome: string;
  estimateNet?: string;
  estimateVat?: string;
  estimateGross?: string;
  pav?: string;
  salvageCategory?: string;
  salvageDeduction?: string;
};

function pounds(raw: string | undefined, what: string, required: boolean): number | null {
  const text = String(raw || "").replace(/[£,\s]/g, "");
  if (!text) {
    if (required) throw new Error(`Enter ${what}.`);
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Enter ${what} in pounds, for example 1250.00.`);
  return Math.round(Number(text) * 100);
}

/** Checks the answers before anything is saved. Returns the figures in pence. */
export function readReportOutcome(input: ReportOutcomeInput) {
  const outcome = input.outcome as ReportOutcome;
  if (!["repairable", "total_loss", "unknown"].includes(outcome)) throw new Error("Choose repairable, total loss, or not yet known.");
  if (outcome === "repairable") {
    const net = pounds(input.estimateNet, "the estimate before VAT", true)!;
    const vat = pounds(input.estimateVat, "the VAT on the estimate (0 if none)", true)!;
    const gross = pounds(input.estimateGross, "the estimate including VAT", false) ?? net + vat;
    if (net + vat !== gross) throw new Error(`The estimate does not add up: ${formatGbp(net)} + ${formatGbp(vat)} VAT is not ${formatGbp(gross)}.`);
    return { outcome, net, vat, gross } as const;
  }
  if (outcome === "total_loss") {
    const pav = pounds(input.pav, "the pre-accident value", true)!;
    const category = asSalvageCategory(input.salvageCategory);
    if (!category) throw new Error("Choose the salvage category (A, B, S or N).");
    const deduction = pounds(input.salvageDeduction, "the salvage deduction (0 if none)", true)!;
    if (deduction > pav) throw new Error("The salvage deduction is more than the pre-accident value.");
    return { outcome, pav, category, deduction } as const;
  }
  return { outcome } as const;
}

function mergeAssessedDamage(claimId: string, actorId: string, values: Record<string, string>) {
  const row = get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = 'assessed-damage'`, [claimId]);
  let current: Record<string, unknown> = {};
  try {
    current = row ? (JSON.parse(String(row.data_json)) as Record<string, unknown>) : {};
  } catch {
    current = {};
  }
  const next = JSON.stringify({ ...current, ...values });
  run(
    `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at, updated_by) VALUES (?, 'assessed-damage', ?, ?, ?)
     ON CONFLICT(claim_id, screen_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [claimId, next, nowUtcIso(), actorId],
  );
}

function setHeadClaimed(claimId: string, head: "repairs" | "vehicle_damage", description: string, money: { net: number; vat: number; gross: number }): number {
  const line = get<{ id: string; claimed_pence: number }>(
    `SELECT id, claimed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  if (line) {
    run(`UPDATE financial_lines SET net_pence = ?, vat_pence = ?, gross_pence = ?, claimed_pence = ? WHERE id = ?`, [money.net, money.vat, money.gross, money.gross, line.id]);
    return Number(line.claimed_pence) || 0;
  }
  run(
    `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, ?, ?, ?, 1, 'item', ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
    [`${head === "repairs" ? "rp" : "vd"}-${claimId}`, claimId, head, description, money.net, money.net, money.vat, money.gross, money.gross],
  );
  return 0;
}

/** Saves the outcome given at step 6. Call inside the same transaction as the report-received record. */
export function saveReportOutcome(input: ReportOutcomeInput & { occurredOn: string }): string {
  const read = readReportOutcome(input);
  if (read.outcome === "unknown") {
    return "Outcome not yet known. The task to set it comes when the report goes to the insurer.";
  }
  if (read.outcome === "repairable") {
    const claim = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [input.claimId]);
    if (Number(claim?.total_loss) === 1) throw new Error("This file is marked total loss. Change that on the assessed damage screen first.");
    mergeAssessedDamage(input.claimId, input.actorId, {
      totalLoss: "no",
      assessedRepair: "yes",
      subtotal: (read.net / 100).toFixed(2),
      vat: (read.vat / 100).toFixed(2),
      totalReserve: (read.gross / 100).toFixed(2),
    });
    const before = setHeadClaimed(input.claimId, "repairs", "Repairs — engineer's estimate", { net: read.net, vat: read.vat, gross: read.gross });
    const words = `Engineer's report (${formatUkDate(input.occurredOn)}): repairable. Estimate ${formatGbp(read.net)} + VAT ${formatGbp(read.vat)} = ${formatGbp(read.gross)}, recorded as the amount claimed on the Repairs head${before && before !== read.gross ? ` (was ${formatGbp(before)})` : ""}. Offered, agreed and received were not changed.`;
    recordClaimEvent({ claimId: input.claimId, eventType: "other", occurredAt: nowUtcIso(), actorId: input.actorId, details: words, source: "staff" });
    return words;
  }
  const before = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [input.claimId]);
  run(`UPDATE claims SET total_loss = 1 WHERE id = ?`, [input.claimId]);
  if (Number(before?.total_loss) !== 1) {
    flagStorageEndOnTotalLoss(input.claimId, input.actorId);
    closeRepairStepsForTotalLoss(input.claimId, input.actorId);
  }
  mergeAssessedDamage(input.claimId, input.actorId, {
    totalLoss: "yes",
    grossValuation: (read.pav / 100).toFixed(2),
    salvageCategory: read.category,
    salvageValue: (read.deduction / 100).toFixed(2),
  });
  saveTotalLossReport({
    claimId: input.claimId,
    actorId: input.actorId,
    pavPence: read.pav,
    salvagePence: read.deduction,
    interest: null,
    disposal: null,
    salvageCategory: read.category,
  });
  const settlement = read.pav - read.deduction;
  const was = setHeadClaimed(input.claimId, "vehicle_damage", "Vehicle damage — total loss", { net: settlement, vat: 0, gross: settlement });
  const words = `Engineer's report (${formatUkDate(input.occurredOn)}): total loss. Pre-accident value ${formatGbp(read.pav)}, salvage category ${read.category}, salvage deduction ${formatGbp(read.deduction)}. ${formatGbp(settlement)} (pre-accident value less salvage) recorded as the amount claimed on the vehicle damage head${was && was !== settlement ? ` (was ${formatGbp(was)})` : ""}. Offered, agreed and received were not changed.`;
  recordClaimEvent({ claimId: input.claimId, eventType: "other", occurredAt: nowUtcIso(), actorId: input.actorId, details: words, source: "staff" });
  return words;
}

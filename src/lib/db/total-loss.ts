import { nowUtcIso } from "../dates";
import {
  disposalApplies,
  salvageSaleVariance,
  totalLossSuggestion,
  type InsurerSalvageInterest,
  type SalvageDisposal,
  type TotalLossFigures,
} from "../domain/total-loss";
import { recordClaimEvent } from "./chronology";
import { get, run } from "./connection";

export type { TotalLossFigures };

type ReportRow = {
  pav_pence: number | null;
  salvage_pence: number | null;
  insurer_salvage_interest: string | null;
  insurer_offered_pence: number | null;
  disposal: string | null;
  sale_proceeds_pence: number | null;
  returned_on: string | null;
  customer_charge_pence: number | null;
  cas_purchase_pence: number | null;
};

const EMPTY: TotalLossFigures = {
  pavPence: null,
  salvagePence: null,
  interest: null,
  insurerOfferedPence: null,
  disposal: null,
  saleProceedsPence: null,
  returnedOn: null,
  customerChargePence: null,
  casPurchasePence: null,
};

function asInterest(value: string | null): InsurerSalvageInterest | null {
  if (value === "no_interest" || value === "takes_interest") return value;
  return null;
}

function asDisposal(value: string | null): SalvageDisposal | null {
  if (value === "sold" || value === "returned" || value === "bought_by_cas") return value;
  return null;
}

function mapRow(row: ReportRow | undefined): TotalLossFigures {
  if (!row) return { ...EMPTY };
  return {
    pavPence: row.pav_pence,
    salvagePence: row.salvage_pence,
    interest: asInterest(row.insurer_salvage_interest),
    insurerOfferedPence: row.insurer_offered_pence,
    disposal: asDisposal(row.disposal),
    saleProceedsPence: row.sale_proceeds_pence,
    returnedOn: row.returned_on,
    customerChargePence: row.customer_charge_pence,
    casPurchasePence: row.cas_purchase_pence,
  };
}

function assertTotalLoss(claimId: string) {
  const claim = get<{ id: string; total_loss: number | null }>(
    `SELECT id, total_loss FROM claims WHERE id = ?`,
    [claimId],
  );
  if (!claim) throw new Error("File not found.");
  if (Number(claim.total_loss) !== 1) throw new Error("These figures are only for a file marked total loss.");
}

export function getTotalLossReport(claimId: string): TotalLossFigures {
  const row = get<ReportRow>(
    `SELECT pav_pence, salvage_pence, insurer_salvage_interest, insurer_offered_pence, disposal,
            sale_proceeds_pence, returned_on, customer_charge_pence, cas_purchase_pence
     FROM total_loss_reports WHERE claim_id = ?`,
    [claimId],
  );
  return mapRow(row);
}

export type VehicleDamageMoney = {
  id: string | null;
  claimedPence: number;
  offeredPence: number;
  agreedPence: number;
  receivedPence: number;
};

export function getVehicleDamageMoney(claimId: string): VehicleDamageMoney {
  const line = get<{
    id: string;
    claimed_pence: number;
    offered_pence: number;
    agreed_pence: number;
    received_pence: number;
  }>(
    `SELECT id, claimed_pence, offered_pence, agreed_pence, received_pence
     FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'vehicle_damage' ORDER BY id LIMIT 1`,
    [claimId],
  );
  if (!line) return { id: null, claimedPence: 0, offeredPence: 0, agreedPence: 0, receivedPence: 0 };
  return {
    id: line.id,
    claimedPence: line.claimed_pence || 0,
    offeredPence: line.offered_pence || 0,
    agreedPence: line.agreed_pence || 0,
    receivedPence: line.received_pence || 0,
  };
}

function writeAgreed(claimId: string, agreedPence: number) {
  const existing = getVehicleDamageMoney(claimId);
  if (existing.id) {
    run(`UPDATE financial_lines SET agreed_pence = ? WHERE id = ?`, [agreedPence, existing.id]);
    return;
  }
  run(
    `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, ?, 'vehicle_damage', 'Vehicle damage — total loss', 1, 'item', 0, 0, 0, 0, 0, 0, ?, 0, NULL)`,
    [`vd-${claimId}`, claimId, agreedPence],
  );
}

function writeOffered(claimId: string, offeredPence: number) {
  const existing = getVehicleDamageMoney(claimId);
  if (existing.id) {
    run(`UPDATE financial_lines SET offered_pence = ? WHERE id = ?`, [offeredPence, existing.id]);
    return;
  }
  run(
    `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, ?, 'vehicle_damage', 'Vehicle damage — total loss', 1, 'item', 0, 0, 0, 0, 0, ?, 0, 0, NULL)`,
    [`vd-${claimId}`, claimId, offeredPence],
  );
}

export function saveTotalLossReport(input: {
  claimId: string;
  actorId: string;
  pavPence: number | null;
  salvagePence: number | null;
  interest: InsurerSalvageInterest | null;
  /** Undefined leaves the insurer's offer unchanged. A number records that offer. It does not set agreed or paid. */
  insurerOfferedPence?: number | null;
  disposal: SalvageDisposal | null;
  /** Undefined leaves that stored figure unchanged. Null means the box was left empty. */
  saleProceedsPence?: number | null;
  returnedOn?: string | null;
  customerChargePence?: number | null;
  casPurchasePence?: number | null;
}): TotalLossFigures {
  assertTotalLoss(input.claimId);
  const current = getTotalLossReport(input.claimId);
  const applyDisposal = disposalApplies(input.interest);
  const next: TotalLossFigures = {
    pavPence: input.pavPence,
    salvagePence: input.salvagePence,
    interest: input.interest,
    insurerOfferedPence: input.insurerOfferedPence === undefined ? current.insurerOfferedPence : input.insurerOfferedPence,
    disposal: applyDisposal ? input.disposal : current.disposal,
    saleProceedsPence: !applyDisposal || input.saleProceedsPence === undefined ? current.saleProceedsPence : input.saleProceedsPence,
    returnedOn: !applyDisposal || input.returnedOn === undefined ? current.returnedOn : input.returnedOn,
    customerChargePence:
      !applyDisposal || input.customerChargePence === undefined ? current.customerChargePence : input.customerChargePence,
    casPurchasePence: !applyDisposal || input.casPurchasePence === undefined ? current.casPurchasePence : input.casPurchasePence,
  };
  const at = nowUtcIso();
  run(
    `INSERT INTO total_loss_reports(
      claim_id, pav_pence, salvage_pence, insurer_salvage_interest, insurer_offered_pence, disposal,
      sale_proceeds_pence, returned_on, customer_charge_pence, cas_purchase_pence, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claim_id) DO UPDATE SET
      pav_pence = excluded.pav_pence,
      salvage_pence = excluded.salvage_pence,
      insurer_salvage_interest = excluded.insurer_salvage_interest,
      insurer_offered_pence = excluded.insurer_offered_pence,
      disposal = excluded.disposal,
      sale_proceeds_pence = excluded.sale_proceeds_pence,
      returned_on = excluded.returned_on,
      customer_charge_pence = excluded.customer_charge_pence,
      cas_purchase_pence = excluded.cas_purchase_pence,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by`,
    [
      input.claimId,
      next.pavPence,
      next.salvagePence,
      next.interest,
      next.insurerOfferedPence,
      next.disposal,
      next.saleProceedsPence,
      next.returnedOn,
      next.customerChargePence,
      next.casPurchasePence,
      at,
      input.actorId,
    ],
  );
  if (input.insurerOfferedPence != null) writeOffered(input.claimId, input.insurerOfferedPence);
  const variance = next.disposal === "sold" ? salvageSaleVariance(next.salvagePence, next.saleProceedsPence) : null;
  const varianceNote =
    variance == null || variance === 0
      ? ""
      : ` Sale proceeds differ from the engineer's salvage value by ${(variance / 100).toFixed(2)} pounds. That difference is flagged and has not been added to the agreed or paid vehicle-damage amount.`;
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "total_loss_figures_recorded",
    occurredAt: at,
    actorId: input.actorId,
    details: `Engineer's total-loss figures saved. Agreed and paid amounts were not changed.${varianceNote}`,
    source: "staff",
  });
  return next;
}

export function confirmTotalLossSuggestion(input: { claimId: string; actorId: string }) {
  assertTotalLoss(input.claimId);
  const report = getTotalLossReport(input.claimId);
  const suggestion = totalLossSuggestion(report);
  if (suggestion.kind !== "suggestion") throw new Error("A suggestion is only available when both engineer's figures are entered and the insurer has no interest in the salvage.");
  if (suggestion.pence < 0) throw new Error("Salvage value is higher than the pre-accident value. The suggestion was not applied. Check the engineer's figures.");
  const before = getVehicleDamageMoney(input.claimId);
  writeAgreed(input.claimId, suggestion.pence);
  const after = getVehicleDamageMoney(input.claimId);
  if (after.receivedPence !== before.receivedPence || after.claimedPence !== before.claimedPence) {
    throw new Error("Paid and claimed amounts must stay as they are.");
  }
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "total_loss_agreed_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff confirmed the suggested insurer payment of ${(suggestion.pence / 100).toFixed(2)} pounds as the agreed vehicle-damage amount. The amount paid was not changed.`,
    source: "staff",
  });
}

export function confirmTypedVehicleDamageAgreed(input: { claimId: string; actorId: string; agreedPence: number }) {
  assertTotalLoss(input.claimId);
  if (!Number.isInteger(input.agreedPence) || input.agreedPence < 0) throw new Error("Enter the agreed amount in pounds.");
  const before = getVehicleDamageMoney(input.claimId);
  writeAgreed(input.claimId, input.agreedPence);
  const after = getVehicleDamageMoney(input.claimId);
  if (after.receivedPence !== before.receivedPence) throw new Error("The amount paid was not changed.");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "total_loss_agreed_confirmed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Staff recorded ${(input.agreedPence / 100).toFixed(2)} pounds as the agreed vehicle-damage amount. This is separate from the engineer's figures. The amount paid was not changed.`,
    source: "staff",
  });
}

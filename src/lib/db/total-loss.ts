import { CAS_CLAIMS_MAILBOX } from "../constants";
import { nowUtcIso } from "../dates";
import { buildMailtoHref } from "../email/mailto";
import { formatGbp } from "../money";
import {
  disposalApplies,
  salvageRequestLabel,
  salvageRequestMismatch,
  salvageSaleVariance,
  totalLossSuggestion,
  type CasSalvageRequest,
  type InsurerSalvageInterest,
  type SalvageDisposal,
  type TotalLossFigures,
} from "../domain/total-loss";
import { ENGINEER_INSTRUCTION_MARKED_SENT, ENGINEER_INSTRUCTION_PREPARED } from "./engineers";
import { recordClaimEvent } from "./chronology";
import { get, newId, run } from "./connection";

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
  cas_request: string | null;
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
  casRequest: null,
};

function asInterest(value: string | null): InsurerSalvageInterest | null {
  if (value === "no_interest" || value === "takes_interest") return value;
  return null;
}

function asDisposal(value: string | null): SalvageDisposal | null {
  if (value === "sold" || value === "returned" || value === "bought_by_cas") return value;
  return null;
}

function asRequest(value: string | null): CasSalvageRequest | null {
  if (value === "full_pav" || value === "net_cas") return value;
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
    casRequest: asRequest(row.cas_request),
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
            sale_proceeds_pence, returned_on, customer_charge_pence, cas_purchase_pence, cas_request
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
  /** Undefined leaves the recorded request unchanged. Null clears it. */
  casRequest?: CasSalvageRequest | null;
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
    casRequest: input.casRequest === undefined ? current.casRequest : input.casRequest,
  };
  const at = nowUtcIso();
  run(
    `INSERT INTO total_loss_reports(
      claim_id, pav_pence, salvage_pence, insurer_salvage_interest, insurer_offered_pence, disposal,
      sale_proceeds_pence, returned_on, customer_charge_pence, cas_purchase_pence, cas_request, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      cas_request = excluded.cas_request,
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
      next.casRequest,
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
  const mismatch = salvageRequestMismatch(next.casRequest, next.interest);
  const mismatchNote = mismatch ? ` ${mismatch} Storage and recovery figures were not changed.` : "";
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "total_loss_figures_recorded",
    occurredAt: at,
    actorId: input.actorId,
    details: `Engineer's total-loss figures saved. Agreed and paid amounts were not changed.${varianceNote}${mismatchNote}`,
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

export const TOTAL_LOSS_NOTICE_TEMPLATE = "total_loss_salvage_request";

export type PreparedTotalLossNotice = {
  id: string;
  subject: string | null;
  toAddress: string | null;
  body: string | null;
  createdAt: string;
  mailto: string | null;
};

function insurerEmail(claimId: string) {
  return get<{ insurer_name: string | null; insurer_email: string | null; handler_email: string | null; file_reference: string }>(
    `SELECT c.file_reference, tp.insurer_name, tp.insurer_email, tp.handler_email
     FROM claims c
     LEFT JOIN claim_third_parties tp ON tp.claim_id = c.id
     WHERE c.id = ?
     ORDER BY tp.sequence, tp.id
     LIMIT 1`,
    [claimId],
  );
}

function figureOrMissing(pence: number | null) {
  return pence == null ? "not yet on file" : formatGbp(pence);
}

export function totalLossNoticeBody(input: { fileReference: string; report: TotalLossFigures }): { subject: string; body: string } {
  if (!input.report.casRequest) throw new Error("Record what CAS is asking the insurer for, then prepare the email.");
  const request = salvageRequestLabel(input.report.casRequest);
  const subject = `Our ref: ${input.fileReference} — total loss salvage`;
  const lines = [
    `Our ref: ${input.fileReference}`,
    "",
    "We write about the total loss of our client's vehicle.",
    "",
    `Engineer's pre-accident value: ${figureOrMissing(input.report.pavPence)}.`,
    `Engineer's salvage value: ${figureOrMissing(input.report.salvagePence)}.`,
    "",
    `CAS asks for: ${request}.`,
  ];
  if (input.report.casRequest === "full_pav") {
    lines.push(
      "",
      "Please pay the full pre-accident value and arrange collection of the salvage. Recovery and storage charges continue until the salvage is collected.",
    );
  } else {
    const suggestion = totalLossSuggestion({
      pavPence: input.report.pavPence,
      salvagePence: input.report.salvagePence,
      interest: "no_interest",
    });
    lines.push(
      "",
      suggestion.kind === "suggestion"
        ? `Please pay the net figure of ${formatGbp(suggestion.pence)} (pre-accident value less the engineer's salvage value). CAS will retain and dispose of the salvage.`
        : "Please pay the net figure (pre-accident value less the engineer's salvage value). A figure is still missing from the engineer's report, so the net amount is not stated here. CAS will retain and dispose of the salvage.",
    );
  }
  lines.push("", `Prepared for the handler to send from their own email client. Not sent automatically from ${CAS_CLAIMS_MAILBOX}.`);
  return { subject, body: lines.join("\n") };
}

export function prepareTotalLossInsurerEmail(input: { claimId: string; actorId: string }): PreparedTotalLossNotice {
  assertTotalLoss(input.claimId);
  const report = getTotalLossReport(input.claimId);
  const claim = insurerEmail(input.claimId);
  if (!claim) throw new Error("File not found.");
  const { subject, body } = totalLossNoticeBody({ fileReference: claim.file_reference, report });
  const to = String(claim.insurer_email || claim.handler_email || "").trim();
  if (!to) throw new Error("No insurer email on file. Add it on Third party 1. Nothing was sent.");
  const correspondenceId = newId("corr");
  const when = nowUtcIso();
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      correspondenceId,
      input.claimId,
      subject,
      body.slice(0, 180),
      body,
      to,
      CAS_CLAIMS_MAILBOX,
      ENGINEER_INSTRUCTION_PREPARED,
      TOTAL_LOSS_NOTICE_TEMPLATE,
      when,
    ],
  );
  return {
    id: correspondenceId,
    subject,
    toAddress: to,
    body,
    createdAt: when,
    mailto: buildMailtoHref(to, subject, body),
  };
}

export function getPreparedTotalLossNotice(claimId: string): PreparedTotalLossNotice | null {
  const row = get<{
    id: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    created_at: string;
  }>(
    `SELECT id, subject, to_address, body, created_at FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = ?
     ORDER BY created_at DESC LIMIT 1`,
    [claimId, TOTAL_LOSS_NOTICE_TEMPLATE, ENGINEER_INSTRUCTION_PREPARED],
  );
  if (!row) return null;
  const to = String(row.to_address || "").trim();
  const body = String(row.body || "");
  const subject = String(row.subject || "Total loss salvage");
  return {
    id: row.id,
    subject: row.subject,
    toAddress: row.to_address,
    body: row.body,
    createdAt: String(row.created_at),
    mailto: to && body ? buildMailtoHref(to, subject, body) : null,
  };
}

export function markTotalLossNoticeSent(input: { claimId: string; correspondenceId: string; actorId: string }) {
  const row = get<{
    id: string;
    claim_id: string;
    subject: string | null;
    to_address: string | null;
    sent_status: string | null;
    template_key: string | null;
  }>(`SELECT id, claim_id, subject, to_address, sent_status, template_key FROM correspondence WHERE id = ?`, [
    input.correspondenceId,
  ]);
  if (!row || row.claim_id !== input.claimId || row.template_key !== TOTAL_LOSS_NOTICE_TEMPLATE) {
    throw new Error("Prepared total-loss email not found on this file.");
  }
  if (row.sent_status === ENGINEER_INSTRUCTION_MARKED_SENT) throw new Error("This email is already marked as sent.");
  if (row.sent_status !== ENGINEER_INSTRUCTION_PREPARED) {
    throw new Error("This item is not a prepared total-loss email waiting to be marked as sent.");
  }
  const when = nowUtcIso();
  const handler = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [input.actorId]);
  const handlerName = handler?.name || "Unknown handler";
  run(`UPDATE correspondence SET sent_status = ? WHERE id = ?`, [ENGINEER_INSTRUCTION_MARKED_SENT, input.correspondenceId]);
  const subject = String(row.subject || "Total loss salvage");
  const to = String(row.to_address || "");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "outgoing_email",
    occurredAt: when,
    details: `${subject} prepared for ${to}. Marked as sent by ${handlerName} after opening their own email client. Not auto-sent — live sending from ${CAS_CLAIMS_MAILBOX} is not connected.`,
    actorId: input.actorId,
    channel: "email",
    correspondenceId: input.correspondenceId,
    source: "staff",
  });
}

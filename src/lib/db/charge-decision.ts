import { accountCanApproveSettlement } from "./permissions";
import { officeFinancialError } from "./storage-charge";
import { formatGbp } from "../money";
import { nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { get, newId, run } from "./connection";
import { recordAgreedHeadFigure } from "./payment-ledger";

export type ChargeHead = "hire" | "storage" | "recovery";

export type ChargeDecision = {
  decision: "awaiting" | "proposed" | "accepted" | "disputed";
  agreedPence: number | null;
  reason: string;
  recordedAt: string | null;
};

const PRESET_REASONS = new Set(["rate", "period", "need"]);

function assertOffice(role: string | null | undefined) {
  const denied = officeFinancialError(role);
  if (denied) throw new Error(denied);
}

function money(claimId: string, head: ChargeHead) {
  return get<{ claimed_pence: number; agreed_pence: number; received_pence: number }>(
    `SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
}

export function latestChargeDecision(claimId: string, head: ChargeHead): ChargeDecision {
  const row = get<{ decision: string; agreed_pence: number | null; reason: string | null; recorded_at: string }>(
    `SELECT decision, agreed_pence, reason, recorded_at FROM charge_decisions
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
    [claimId, head],
  );
  if (!row) return { decision: "awaiting", agreedPence: null, reason: "", recordedAt: null };
  const decision = row.decision === "proposed" || row.decision === "accepted" || row.decision === "disputed" ? row.decision : "awaiting";
  return {
    decision,
    agreedPence: row.agreed_pence == null ? null : Number(row.agreed_pence),
    reason: String(row.reason || ""),
    recordedAt: row.recorded_at,
  };
}

function insertDecision(input: {
  claimId: string;
  head: ChargeHead;
  decision: "proposed" | "accepted" | "disputed";
  agreedPence: number | null;
  reason: string;
  actorId: string;
}) {
  run(
    `INSERT INTO charge_decisions(id, claim_id, head_of_loss, decision, agreed_pence, reason, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("decision"), input.claimId, input.head, input.decision, input.agreedPence, input.reason, input.actorId, nowUtcIso()],
  );
}

function otherMoney(claimId: string, head: ChargeHead): string {
  const rows = get<{ snapshot: string }>(
    `SELECT group_concat(head_of_loss || ':' || claimed_pence || ':' || agreed_pence || ':' || received_pence, '|') AS snapshot
     FROM financial_lines WHERE claim_id = ? AND head_of_loss != ?`,
    [claimId, head],
  );
  return String(rows?.snapshot || "");
}

function dates(claimId: string): string {
  const hire = get<{ billing_end_at: string | null }>(
    `SELECT billing_end_at FROM hire_episodes WHERE claim_id = ? ORDER BY id LIMIT 1`,
    [claimId],
  );
  const storage = get<{ storage_billing_end_on: string | null }>(
    `SELECT storage_billing_end_on FROM claims WHERE id = ?`,
    [claimId],
  );
  return `${hire?.billing_end_at || ""}|${storage?.storage_billing_end_on || ""}`;
}

/**
 * Records the agreed figure. Below the claimed figure this is a reduced settlement and needs approveSettlement.
 * A direct call without that permission is refused and does not write the agreed figure.
 */
export function acceptChargeFigure(input: {
  claimId: string;
  actorId: string;
  role: string | null | undefined;
  head: ChargeHead;
  agreedPence: number;
  expectedVersion?: string;
}) {
  assertOffice(input.role);
  const before = money(input.claimId, input.head);
  const claimed = Number(before?.claimed_pence) || 0;
  const received = Number(before?.received_pence) || 0;
  const others = otherMoney(input.claimId, input.head);
  const open = dates(input.claimId);
  if (claimed > 0 && input.agreedPence < claimed && !accountCanApproveSettlement(input.actorId, input.role)) {
    throw new Error(
      "Accepting a figure below the claimed figure needs the approveSettlement permission. The agreed figure was not saved.",
    );
  }
  recordAgreedHeadFigure({
    claimId: input.claimId,
    actorId: input.actorId,
    head: input.head,
    agreedPence: input.agreedPence,
    expectedVersion: input.expectedVersion,
  });
  insertDecision({
    claimId: input.claimId,
    head: input.head,
    decision: "accepted",
    agreedPence: input.agreedPence,
    reason: "",
    actorId: input.actorId,
  });
  const after = money(input.claimId, input.head);
  if (Number(after?.claimed_pence) !== claimed || Number(after?.received_pence) !== received) {
    throw new Error("Accepting this charge changed claimed or received. That must not happen.");
  }
  if (otherMoney(input.claimId, input.head) !== others || dates(input.claimId) !== open) {
    throw new Error("Accepting this charge changed another charge, or closed hire or storage. That must not happen.");
  }
}

/** Waits for someone with approveSettlement. Does not write the agreed figure. */
export function proposeChargeAcceptance(input: {
  claimId: string;
  actorId: string;
  role: string | null | undefined;
  head: ChargeHead;
  agreedPence: number;
}) {
  assertOffice(input.role);
  if (!Number.isInteger(input.agreedPence) || input.agreedPence <= 0) {
    throw new Error("Enter the figure to propose. It is not taken from the claimed figure.");
  }
  const before = money(input.claimId, input.head);
  const claimed = Number(before?.claimed_pence) || 0;
  const agreed = Number(before?.agreed_pence) || 0;
  const received = Number(before?.received_pence) || 0;
  insertDecision({
    claimId: input.claimId,
    head: input.head,
    decision: "proposed",
    agreedPence: input.agreedPence,
    reason: "",
    actorId: input.actorId,
  });
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "charge_acceptance_proposed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `head=${input.head} Proposed acceptance of ${formatGbp(input.agreedPence)}. The agreed figure was not changed. It waits for approval.`,
    source: "staff",
    channel: "file",
  });
  const after = money(input.claimId, input.head);
  if (
    Number(after?.claimed_pence) !== claimed ||
    Number(after?.agreed_pence) !== agreed ||
    Number(after?.received_pence) !== received
  ) {
    throw new Error("A proposed acceptance changed claimed, agreed or received. That must not happen.");
  }
}

export function disputeCharge(input: {
  claimId: string;
  actorId: string;
  role: string | null | undefined;
  head: ChargeHead;
  reason: string;
}) {
  assertOffice(input.role);
  const reason = input.reason.trim();
  if (!reason) throw new Error("A dispute needs a reason.");
  if (reason.length > 500) throw new Error("The reason is too long.");
  const before = money(input.claimId, input.head);
  const claimed = Number(before?.claimed_pence) || 0;
  const agreed = Number(before?.agreed_pence) || 0;
  const received = Number(before?.received_pence) || 0;
  const open = dates(input.claimId);
  const others = otherMoney(input.claimId, input.head);
  const storedReason = PRESET_REASONS.has(reason) ? reason : reason;
  insertDecision({
    claimId: input.claimId,
    head: input.head,
    decision: "disputed",
    agreedPence: null,
    reason: storedReason,
    actorId: input.actorId,
  });
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "charge_decision_disputed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `head=${input.head} Disputed. Reason: ${storedReason}. The charge stays open. Agreed, claimed and received were not changed.`,
    source: "staff",
    channel: "file",
  });
  const after = money(input.claimId, input.head);
  if (
    Number(after?.claimed_pence) !== claimed ||
    Number(after?.agreed_pence) !== agreed ||
    Number(after?.received_pence) !== received ||
    dates(input.claimId) !== open ||
    otherMoney(input.claimId, input.head) !== others
  ) {
    throw new Error("Disputing this charge changed the money or closed hire or storage. That must not happen.");
  }
}

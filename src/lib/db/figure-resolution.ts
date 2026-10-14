import { officeFinancialError } from "./storage-charge";
import { STORED_FIGURE_DIFFERS, storedFigureKeptLabel } from "../domain/figure-resolution";
import { formatGbp } from "../money";
import { nowUtcIso } from "../dates";
import { writeCalculatedHireClaimed, hireChargeForClaim, storedHireMoney } from "./hire-charge";
import { recordClaimEvent } from "./chronology";
import { get } from "./connection";
import { recoveryClaimForClaim, storageChargeForClaim, syncRecoveryClaimed, syncStorageClaimed } from "./storage-charge";

export type FigureHead = "hire" | "storage" | "recovery";

export type FigureResolution = {
  mode: "follow" | "kept" | null;
  reason: string | null;
  label: string | null;
};

const USE = "stored_figure_use_calculated";
const KEPT = "stored_figure_kept";

function assertOffice(role: string | null | undefined) {
  const denied = officeFinancialError(role);
  if (denied) throw new Error(denied);
}

export function latestFigureResolution(claimId: string, head: FigureHead): FigureResolution {
  const row = get<{ event_type: string; details: string | null }>(
    `SELECT event_type, details FROM claim_events
     WHERE claim_id = ? AND event_type IN (?, ?) AND details LIKE ?
     ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1`,
    [claimId, USE, KEPT, `%head=${head}%`],
  );
  if (!row) return { mode: null, reason: null, label: null };
  if (row.event_type === KEPT) {
    const reason = String(row.details || "").match(/reason=(.*)$/)?.[1]?.trim() || "";
    return { mode: "kept", reason, label: reason ? storedFigureKeptLabel(reason) : storedFigureKeptLabel("no reason recorded") };
  }
  return { mode: "follow", reason: null, label: null };
}

function claimedPence(claimId: string, head: FigureHead): { claimed: number; agreed: number; received: number } {
  if (head === "hire") {
    const money = storedHireMoney(claimId);
    return { claimed: money.claimedPence, agreed: money.agreedPence, received: money.receivedPence };
  }
  const line = get<{ claimed_pence: number; agreed_pence: number; received_pence: number }>(
    `SELECT claimed_pence, agreed_pence, received_pence FROM financial_lines
     WHERE claim_id = ? AND head_of_loss = ? ORDER BY id LIMIT 1`,
    [claimId, head],
  );
  return {
    claimed: Number(line?.claimed_pence) || 0,
    agreed: Number(line?.agreed_pence) || 0,
    received: Number(line?.received_pence) || 0,
  };
}

function calculatedPence(claimId: string, head: FigureHead): number | null {
  if (head === "hire") {
    const view = hireChargeForClaim(claimId);
    return view.charge.status === "calculated" ? view.charge.totalPence : null;
  }
  if (head === "storage") {
    const charge = storageChargeForClaim(claimId);
    return charge?.status === "calculated" ? charge.totalPence : null;
  }
  const decision = recoveryClaimForClaim(claimId);
  if (!decision.write && decision.source === "kept") return null;
  return decision.totalPence;
}

function writeCalculation(claimId: string, head: FigureHead) {
  if (head === "hire") {
    if (!writeCalculatedHireClaimed(claimId)) throw new Error("There is no calculated figure to use.");
    return;
  }
  if (head === "storage") {
    const charge = syncStorageClaimed(claimId, undefined, { force: true });
    if (!charge || charge.status !== "calculated") throw new Error("There is no calculated figure to use.");
    return;
  }
  const decision = syncRecoveryClaimed(claimId, { force: true });
  if (!decision.write && decision.totalPence <= 0) throw new Error("There is no calculated figure to use.");
}

/** Claimed follows the calculation from now on, including when the days change. Agreed and received stay as they are. */
export function useCalculatedFigure(input: { claimId: string; actorId: string; role: string | null | undefined; head: FigureHead }) {
  assertOffice(input.role);
  const before = claimedPence(input.claimId, input.head);
  const at = nowUtcIso();
  recordClaimEvent({
    claimId: input.claimId,
    eventType: USE,
    occurredAt: at,
    actorId: input.actorId,
    details: `head=${input.head} old_pence=${before.claimed} The stored claimed figure of ${formatGbp(before.claimed)} now follows the calculation. Agreed and received were not changed.`,
    source: "staff",
    channel: "file",
  });
  writeCalculation(input.claimId, input.head);
  const after = claimedPence(input.claimId, input.head);
  if (after.agreed !== before.agreed || after.received !== before.received) {
    throw new Error("Using the calculated figure changed agreed or received. That must not happen.");
  }
}

/** Claimed stays at the stored figure. A reason is required. Agreed and received stay as they are. */
export function keepStoredFigure(input: {
  claimId: string;
  actorId: string;
  role: string | null | undefined;
  head: FigureHead;
  reason: string;
}) {
  assertOffice(input.role);
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required to keep the stored figure.");
  const before = claimedPence(input.claimId, input.head);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: KEPT,
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `head=${input.head} old_pence=${before.claimed} reason=${reason}`,
    source: "staff",
    channel: "file",
  });
  const after = claimedPence(input.claimId, input.head);
  if (after.claimed !== before.claimed || after.agreed !== before.agreed || after.received !== before.received) {
    throw new Error("Keeping the stored figure changed the money. That must not happen.");
  }
}

/** Follow mode rewrites claimed when the days change. A kept figure is left alone. */
export function refreshFollowedFigure(claimId: string, head: FigureHead) {
  if (latestFigureResolution(claimId, head).mode !== "follow") return;
  const before = claimedPence(claimId, head);
  writeCalculation(claimId, head);
  const after = claimedPence(claimId, head);
  if (after.agreed !== before.agreed || after.received !== before.received) {
    throw new Error("Updating the calculation changed agreed or received. That must not happen.");
  }
}

export function figureFlag(claimId: string, head: FigureHead, storedPence: number, calculated: number | null): FigureResolution & {
  differs: boolean;
} {
  const resolution = latestFigureResolution(claimId, head);
  const differs = resolution.mode !== "follow" && resolution.mode !== "kept" && storedPence > 0 && calculated != null && storedPence !== calculated;
  return {
    ...resolution,
    differs,
    label: resolution.mode === "kept" ? resolution.label : differs ? STORED_FIGURE_DIFFERS : null,
  };
}

export function calculatedForHead(claimId: string, head: FigureHead): number | null {
  return calculatedPence(claimId, head);
}

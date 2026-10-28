import { isChaseKind, type ChaseKind } from "../domain/chase";
import { callOutcomeLabel, dayAfter, fleetConflictText, undoStillOpen, waitLimitMessage, type CallOutcome } from "../domain/desk-actions";
import { dueWording } from "../domain/due-wording";
import { repairAuthorisationState, storageAuthorisationEndDecision } from "../domain/storage-authorisation-end";
import { storageCharge, ukDayLabel } from "../domain/storage-charge";
import { blankDeskItem, type DeskWorkItem } from "../domain/todays-work";
import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { formatVehicleRegistration } from "../text";
import { chaseRow, pauseChase, resumeChase } from "./chase";
import { prepareOutstandingChase } from "./chronology";
import { all, get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { hireChargeForClaim } from "./hire-charge";
import { accountCanExtendedWait } from "./permissions";
import { VersionConflictError, withImmediateTransaction } from "./record-version";
import { replaySubmit, storeSubmit } from "./submit-key";
import { calendarDay } from "./storage-recovery-date";
import { getStorageDailyRatePence, storageChargeForClaim } from "./storage-charge";

export type FleetConflict = {
  claimId: string;
  fileReference: string;
  clientName: string;
  handlerName: string;
  registration: string;
  status: string;
  text: string;
};

type WaitRow = {
  id: string;
  claim_id: string;
  item_key: string;
  wait_until: string;
  reason: string;
  actor_id: string;
  created_at: string;
  undone_at: string | null;
  chase_kind: string | null;
  chase_paused: number;
  resumed_at: string | null;
  actor_name: string | null;
};

export type ClaimRunningDaily = {
  /** True only when hire or storage is still accruing at a daily rate above £0. */
  open: boolean;
  dailyPence: number;
  /** Proposed storage end that is already in the past. The charge is not still running. */
  storageProposedPast: string | null;
  /** A charge would still be accruing, but the page's daily rate is missing. */
  rateMissing: boolean;
  /** Hire is running with a rate stored, but the signed agreement is not on the file. */
  hireUnsigned?: boolean;
};

function countedThroughToday(countedTo: string, today: string): boolean {
  return Boolean(countedTo) && countedTo >= today;
}

/**
 * Daily hire rate from the signed agreement, plus the storage rate the storage page would use.
 * A proposed or confirmed end in the past is not still running. £0 is not a running rate.
 */
export function claimRunningDaily(claimId: string, today = londonTodayIso()): ClaimRunningDaily {
  let daily = 0;
  let rateMissing = false;
  let hireUnsigned = false;
  let storageProposedPast: string | null = null;

  const hire = hireChargeForClaim(claimId, today);
  if (hire.charge.status === "calculated" && countedThroughToday(hire.charge.countedTo, today)) {
    if (hire.charge.continuingRatePence > 0) daily += hire.charge.continuingRatePence;
    else rateMissing = true;
  } else if (hire.charge.status === "no_rate" && hire.handoverDay && hire.creditHire) {
    const end = hire.confirmedEndDay || hire.proposedEndDay;
    if (!end || end >= today) {
      const stored = get<{ rate: number | null }>(
        `SELECT rate_pence_per_day AS rate FROM hire_episodes
         WHERE claim_id = ? AND started_at IS NOT NULL AND collection_at IS NULL AND billing_end_at IS NULL AND rate_pence_per_day > 0 LIMIT 1`,
        [claimId],
      );
      if (stored) hireUnsigned = true;
      else rateMissing = true;
    }
  }

  const storage = storageChargeForClaim(claimId, today);
  if (storage?.status === "calculated") {
    if (storage.basis === "proposed" && storage.countedTo < today) {
      storageProposedPast = storage.countedTo;
    } else if (countedThroughToday(storage.countedTo, today)) {
      if (storage.ratePence > 0) daily += storage.ratePence;
      else rateMissing = true;
    }
  }

  return { open: daily > 0, dailyPence: daily, storageProposedPast, rateMissing, hireUnsigned };
}

/** Past proposed storage ends, and charges that are still open without a daily rate. Not Money running. */
export function moneyFollowUpItems(
  rows: Array<{
    claimId: string;
    fileReference: string;
    clientName: string;
    handlerName: string;
    running: ClaimRunningDaily;
  }>,
  today = londonTodayIso(),
): DeskWorkItem[] {
  const items: DeskWorkItem[] = [];
  for (const row of rows) {
    const running = row.running;
    const claimId = row.claimId;
    const fileReference = row.fileReference;
    const clientName = row.clientName;
    const handlerName = row.handlerName;
    if (running.storageProposedPast) {
      const when = dueWording(running.storageProposedPast, today);
      items.push(
        blankDeskItem({
          id: `storage-confirm-${claimId}`,
          claimId,
          fileReference,
          clientName,
          handlerName,
          item: `Confirm storage end (proposed ${ukDayLabel(running.storageProposedPast)})`,
          wording: when.text,
          tone: when.tone,
          sortDays: when.sortDays,
          tier: 3,
        }),
      );
    }
    if (running.rateMissing) {
      items.push(
        blankDeskItem({
          id: `rate-missing-${claimId}`,
          claimId,
          fileReference,
          clientName,
          handlerName,
          item: "Daily rate missing",
          wording: "Due today",
          tone: "today",
          sortDays: 0,
          tier: 3,
        }),
      );
    }
  }
  return items;
}

/**
 * Storage follow-up for files that are not already on the repair-gap list.
 * One read of those files, not a charge calculation per file.
 */
export function storageRunningForClaims(claimIds: string[], today = londonTodayIso()): Map<string, ClaimRunningDaily> {
  const out = new Map<string, ClaimRunningDaily>();
  if (claimIds.length === 0) return out;
  const marks = claimIds.map(() => "?").join(", ");
  const claims = all<{
    id: string;
    total_loss: number | null;
    storage_started_on: string | null;
    storage_billing_end_on: string | null;
    storage_rate_pence: number | null;
    storage_authorisation_review: string | null;
  }>(
    `SELECT id, total_loss, storage_started_on, storage_billing_end_on, storage_rate_pence, storage_authorisation_review
     FROM claims WHERE id IN (${marks})`,
    claimIds,
  );
  const events = all<{
    id: string;
    claim_id: string;
    event_type: string;
    occurred_at: string;
    details: string | null;
  }>(
    `SELECT id, claim_id, event_type, occurred_at, details
     FROM claim_events
     WHERE claim_id IN (${marks})
       AND event_type IN ('repairs_authorised', 'repairs_authorised_cleared', 'repairs_started', 'storage_end_date_confirmed')
     ORDER BY occurred_at ASC, id ASC`,
    claimIds,
  );
  const defaultRate = getStorageDailyRatePence();
  for (const claim of claims) {
    const mine = events.filter((event) => event.claim_id === claim.id);
    const authorisation = repairAuthorisationState(
      mine.filter((event) => event.event_type === "repairs_authorised" || event.event_type === "repairs_authorised_cleared"),
      (occurredAt) => calendarDay(occurredAt),
    );
    const started = mine.find((event) => event.event_type === "repairs_started");
    const kept = [...mine]
      .reverse()
      .find(
        (event) =>
          event.event_type === "storage_end_date_confirmed" && String(event.details || "").startsWith("Kept the storage end"),
      );
    const keptDay = String(kept?.details || "").match(/suggested (\d{4}-\d{2}-\d{2})/)?.[1] || null;
    const decision = storageAuthorisationEndDecision({
      totalLoss: Number(claim.total_loss) === 1,
      totalLossReview: claim.storage_authorisation_review === "total_loss",
      authorisationDay: authorisation.day,
      repairsStartedDay: calendarDay(started?.occurred_at),
      withdrawn: authorisation.withdrawn,
      existingEndDay: calendarDay(claim.storage_billing_end_on),
      keptSuggestionDay: keptDay,
    });
    const proposed = decision.kind === "suggest" ? decision.date : null;
    const storedRate = claim.storage_rate_pence;
    const rate =
      storedRate != null && Number.isInteger(Number(storedRate)) ? Number(storedRate) : defaultRate;
    const charge = storageCharge({
      startDay: calendarDay(claim.storage_started_on),
      confirmedEndDay: calendarDay(claim.storage_billing_end_on),
      proposedEndDay: proposed,
      today,
      ratePence: rate,
    });
    let storageProposedPast: string | null = null;
    let rateMissing = false;
    let daily = 0;
    if (charge.status === "calculated") {
      if (charge.basis === "proposed" && charge.countedTo < today) storageProposedPast = charge.countedTo;
      else if (countedThroughToday(charge.countedTo, today)) {
        if (charge.ratePence > 0) daily = charge.ratePence;
        else rateMissing = true;
      }
    }
    out.set(String(claim.id), {
      open: daily > 0,
      dailyPence: daily,
      storageProposedPast,
      rateMissing,
    });
  }
  return out;
}

export function listFleetConflicts(handlerId?: string | null): FleetConflict[] {
  const rows = all<{
    claim_id: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
    registration: string | null;
    fleet_status: string | null;
  }>(
    `SELECT c.id AS claim_id, c.file_reference, p.full_name AS client_name, s.name AS handler_name,
            v.registration, fv.status AS fleet_status
     FROM claims c
     JOIN hire_episodes he ON he.claim_id = c.id AND he.id = (
       SELECT he2.id FROM hire_episodes he2 WHERE he2.claim_id = c.id ORDER BY he2.started_at DESC LIMIT 1
     )
     JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id AND fv.removed_at IS NULL
     JOIN vehicles v ON v.id = fv.vehicle_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE c.hire_status IN ('active', 'approaching_off_hire')
       AND fv.status != 'on_hire'
       ${handlerId ? "AND c.handler_id = ?" : ""}
     ORDER BY c.file_reference`,
    handlerId ? [handlerId] : [],
  );
  return rows.map((row) => {
    const registration = formatVehicleRegistration(String(row.registration || "unregistered"));
    const status = String(row.fleet_status || "unknown");
    const fileReference = String(row.file_reference);
    return {
      claimId: String(row.claim_id),
      fileReference,
      clientName: String(row.client_name || "Unknown"),
      handlerName: String(row.handler_name || "Unassigned"),
      registration,
      status,
      text: fleetConflictText(registration, status, fileReference),
    };
  });
}

export function fleetConflictForClaim(claimId: string): FleetConflict | null {
  return listFleetConflicts().find((row) => row.claimId === claimId) ?? null;
}

export function litigationDeskItems(handlerId?: string | null): DeskWorkItem[] {
  const rows = all<{
    id: string;
    claim_id: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
    deadline_on: string | null;
    deadline_source: string | null;
  }>(
    `SELECT l.id, l.claim_id, c.file_reference, p.full_name AS client_name, s.name AS handler_name,
            l.deadline_on, l.deadline_source
     FROM litigation l
     JOIN claims c ON c.id = l.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE l.deadline_on IS NOT NULL AND trim(l.deadline_on) != ''
       AND l.deadline_source IS NOT NULL AND trim(l.deadline_source) != ''
       ${handlerId ? "AND c.handler_id = ?" : ""}`,
    handlerId ? [handlerId] : [],
  );
  return rows.map((row) => {
    const when = dueWording(row.deadline_on);
    return blankDeskItem({
      id: `litigation-${row.id}`,
      claimId: String(row.claim_id),
      fileReference: String(row.file_reference),
      clientName: String(row.client_name || "Unknown"),
      handlerName: String(row.handler_name || "Unassigned"),
      item: "Litigation deadline",
      wording: when.text,
      tone: when.tone,
      sortDays: when.sortDays,
      tier: 1,
      recordStep: true,
    });
  });
}

export function settlementApprovalItems(handlerId?: string | null): DeskWorkItem[] {
  const rows = all<{
    id: string;
    claim_id: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
    head_of_loss: string;
    recorded_at: string;
  }>(
    `SELECT d.id, d.claim_id, c.file_reference, p.full_name AS client_name, s.name AS handler_name,
            d.head_of_loss, d.recorded_at
     FROM charge_decisions d
     JOIN claims c ON c.id = d.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE d.decision = 'proposed'
       AND d.recorded_at = (
         SELECT MAX(d2.recorded_at) FROM charge_decisions d2
         WHERE d2.claim_id = d.claim_id AND d2.head_of_loss = d.head_of_loss
       )
       ${handlerId ? "AND c.handler_id = ?" : ""}`,
    handlerId ? [handlerId] : [],
  );
  return rows.map((row) => {
    const when = dueWording(row.recorded_at);
    const head = String(row.head_of_loss).replaceAll("_", " ");
    return blankDeskItem({
      id: `approval-${row.claim_id}-${row.head_of_loss}`,
      claimId: String(row.claim_id),
      fileReference: String(row.file_reference),
      clientName: String(row.client_name || "Unknown"),
      handlerName: String(row.handler_name || "Unassigned"),
      item: `Settlement approval waiting — ${head}`,
      wording: when.tone === "unknown" ? "Waiting for approval" : when.text,
      tone: when.tone === "unknown" ? "today" : when.tone,
      sortDays: when.tone === "unknown" ? 0 : when.sortDays,
      tier: 1,
      prepareChase: false,
      recordStep: true,
    });
  });
}

export function noNextActionItems(handlerId?: string | null): DeskWorkItem[] {
  const rows = all<{
    id: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
  }>(
    `SELECT c.id, c.file_reference, p.full_name AS client_name, s.name AS handler_name
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE (c.next_action IS NULL OR trim(c.next_action) = '')
       AND (c.next_action_due IS NULL OR trim(c.next_action_due) = '')
       AND NOT EXISTS (
         SELECT 1 FROM claim_events closed
         WHERE closed.claim_id = c.id AND closed.event_type = 'case_closed'
       )
       ${handlerId ? "AND c.handler_id = ?" : ""}
     ORDER BY c.file_reference`,
    handlerId ? [handlerId] : [],
  );
  return rows.map((row) =>
    blankDeskItem({
      id: `next-${row.id}`,
      claimId: String(row.id),
      fileReference: String(row.file_reference),
      clientName: String(row.client_name || "Unknown"),
      handlerName: String(row.handler_name || "Unassigned"),
      item: "No next action set",
      wording: "No due date",
      tone: "today",
      sortDays: 0,
      tier: 1,
      recordStep: true,
    }),
  );
}

export function fleetConflictItems(rows: FleetConflict[]): DeskWorkItem[] {
  return rows.map((row) =>
    blankDeskItem({
      id: `fleet-${row.claimId}`,
      claimId: row.claimId,
      fileReference: row.fileReference,
      clientName: row.clientName,
      handlerName: row.handlerName,
      item: row.text,
      wording: "Review the fleet record",
      tone: "today",
      sortDays: 0,
      tier: 1,
      recordStep: true,
    }),
  );
}

function activeWait(itemKey: string): WaitRow | undefined {
  return get<WaitRow>(
    `SELECT w.*, s.name AS actor_name
     FROM work_waits w
     LEFT JOIN staff s ON s.id = w.actor_id
     WHERE w.item_key = ? AND w.undone_at IS NULL
     ORDER BY w.created_at DESC
     LIMIT 1`,
    [itemKey],
  );
}

export function waitVersions(): Map<string, string> {
  const rows = all<{ id: string; item_key: string }>(
    `SELECT id, item_key FROM work_waits WHERE undone_at IS NULL ORDER BY created_at DESC`,
  );
  const versions = new Map<string, string>();
  for (const row of rows) {
    if (!versions.has(String(row.item_key))) versions.set(String(row.item_key), String(row.id));
  }
  return versions;
}

export function hiddenWaitItemIds(today = londonTodayIso()): Set<string> {
  const rows = all<{ item_key: string; wait_until: string }>(
    `SELECT item_key, wait_until FROM work_waits
     WHERE undone_at IS NULL AND wait_until > ?`,
    [today],
  );
  return new Set(rows.map((row) => String(row.item_key)));
}

function pauseIfTracking(claimId: string, kind: ChaseKind, reason: string): boolean {
  const row = chaseRow(claimId, kind);
  if (!row || row.status === "cancelled" || row.status === "paused" || Number(row.paused) === 1) return false;
  pauseChase(kind, claimId, reason);
  return true;
}

export function releaseDueWaits(today = londonTodayIso()) {
  const rows = all<WaitRow>(
    `SELECT w.*, s.name AS actor_name
     FROM work_waits w
     LEFT JOIN staff s ON s.id = w.actor_id
     WHERE w.undone_at IS NULL AND w.chase_paused = 1 AND w.resumed_at IS NULL AND w.wait_until <= ?`,
    [today],
  );
  for (const row of rows) {
    if (row.chase_kind && isChaseKind(row.chase_kind)) {
      const chase = chaseRow(row.claim_id, row.chase_kind);
      if (chase && chase.status !== "cancelled") resumeChase(row.chase_kind, row.claim_id);
    }
    run(`UPDATE work_waits SET resumed_at = ? WHERE id = ?`, [nowUtcIso(), row.id]);
  }
}

export function waitVersionFor(itemKey: string): string {
  return activeWait(itemKey)?.id || "";
}

export function setWorkWait(input: {
  claimId: string;
  itemKey: string;
  waitUntil: string;
  reason: string;
  actorId: string;
  role: string | null | undefined;
  chaseKind?: string | null;
  expectedVersion: string;
  submitKey: string;
  today?: string;
}): { id: string; waitUntil: string } {
  const today = input.today || londonTodayIso();
  const reason = input.reason.trim();
  if (!reason) throw new Error("A wait needs a reason.");
  const extended = accountCanExtendedWait(input.actorId, input.role);
  const blocked = waitLimitMessage(input.waitUntil, today, extended);
  if (blocked) throw new Error(blocked);
  const replay = replaySubmit<{ id: string; waitUntil: string }>(input.submitKey);
  if (replay) return replay;
  let saved: { id: string; waitUntil: string } | null = null;
  withImmediateTransaction(() => {
    const again = replaySubmit<{ id: string; waitUntil: string }>(input.submitKey);
    if (again) {
      saved = again;
      return;
    }
    const current = activeWait(input.itemKey);
    const currentId = current?.id || "";
    if (currentId !== input.expectedVersion) {
      const actor = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [current?.actor_id || ""]);
      throw new VersionConflictError(
        actor?.name || "Someone",
        current?.created_at || nowUtcIso(),
        [{ name: "wait", label: "Wait until", saved: current?.wait_until || "", yours: input.waitUntil }],
        { waitUntil: input.waitUntil, reason },
        input.expectedVersion,
        "desk-wait",
        input.itemKey,
      );
    }
    const id = newId("wait");
    const kind = input.chaseKind && isChaseKind(input.chaseKind) ? input.chaseKind : null;
    const paused = kind ? (pauseIfTracking(input.claimId, kind, `Waiting until ${formatUkDate(input.waitUntil)}. ${reason}`) ? 1 : 0) : 0;
    run(
      `INSERT INTO work_waits(id, claim_id, item_key, wait_until, reason, actor_id, created_at, chase_kind, chase_paused)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.claimId, input.itemKey, input.waitUntil, reason, input.actorId, nowUtcIso(), kind, paused],
    );
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "work_wait_set",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Waiting until ${formatUkDate(input.waitUntil)}. ${reason}`,
      source: "staff",
      channel: "file",
    });
    saved = { id, waitUntil: input.waitUntil };
    storeSubmit(input.submitKey, saved);
  });
  return saved || replaySubmit<{ id: string; waitUntil: string }>(input.submitKey) || { id: "", waitUntil: input.waitUntil };
}

export function undoWorkWait(input: { waitId: string; actorId: string; nowMs?: number }): { restored: boolean } {
  const row = get<WaitRow>(
    `SELECT w.*, s.name AS actor_name FROM work_waits w LEFT JOIN staff s ON s.id = w.actor_id WHERE w.id = ?`,
    [input.waitId],
  );
  if (!row) throw new Error("That wait is not on the file.");
  if (row.undone_at) return { restored: true };
  if (!undoStillOpen(row.created_at, input.nowMs ?? Date.now())) {
    throw new Error("Undo is only available for 10 seconds.");
  }
  if (Number(row.chase_paused) === 1 && !row.resumed_at && row.chase_kind && isChaseKind(row.chase_kind)) {
    const chase = chaseRow(row.claim_id, row.chase_kind);
    if (chase && chase.status !== "cancelled") resumeChase(row.chase_kind, row.claim_id);
  }
  run(`UPDATE work_waits SET undone_at = ?, resumed_at = COALESCE(resumed_at, ?) WHERE id = ?`, [
    nowUtcIso(),
    nowUtcIso(),
    row.id,
  ]);
  recordClaimEvent({
    claimId: row.claim_id,
    eventType: "work_wait_cleared",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: "The wait was undone. The earlier wait entry is still on the file.",
    source: "staff",
    channel: "file",
  });
  return { restored: true };
}

export function logDeskCall(input: {
  claimId: string;
  itemKey: string;
  outcome: CallOutcome;
  note: string;
  promiseOn: string;
  actorId: string;
  role: string | null | undefined;
  chaseKind?: string | null;
  expectedVersion: string;
  submitKey: string;
  today?: string;
}): { event: true; waitUntil: string | null; waitId: string | null } {
  const label = callOutcomeLabel(input.outcome);
  if (!label) throw new Error("Choose what happened on the call.");
  const note = input.note.trim();
  const today = input.today || londonTodayIso();
  let waitUntil: string | null = null;
  if (input.outcome === "promised") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.promiseOn)) throw new Error("Enter the date they promised.");
    waitUntil = dayAfter(input.promiseOn);
    const extended = accountCanExtendedWait(input.actorId, input.role);
    const blocked = waitLimitMessage(waitUntil, today, extended);
    if (blocked) throw new Error(blocked);
  }
  const replay = replaySubmit<{ event: true; waitUntil: string | null; waitId: string | null }>(input.submitKey);
  if (replay) return replay;
  let waitId: string | null = null;
  if (waitUntil) {
    const waited = setWorkWait({
      claimId: input.claimId,
      itemKey: input.itemKey,
      waitUntil,
      reason: `Promised payment or response by ${formatUkDate(input.promiseOn)}.`,
      actorId: input.actorId,
      role: input.role,
      chaseKind: input.chaseKind,
      expectedVersion: input.expectedVersion,
      submitKey: `${input.submitKey}-wait`,
      today,
    });
    waitId = waited.id;
  }
  const details = [label, input.promiseOn ? `by ${formatUkDate(input.promiseOn)}` : "", note].filter(Boolean).join(". ");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "call_logged",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details,
    source: "staff",
    channel: "phone",
  });
  const result = { event: true as const, waitUntil, waitId };
  storeSubmit(input.submitKey, result);
  return result;
}

export function prepareDeskChaser(input: { claimId: string; actorId: string; kind: string }) {
  if (!isChaseKind(input.kind)) throw new Error("That item does not have a chaser email.");
  return prepareOutstandingChase({ claimId: input.claimId, actorId: input.actorId, kind: input.kind });
}

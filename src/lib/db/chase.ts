import type { DatabaseSync } from "node:sqlite";
import { addCalendarDaysIso, daysBetweenLondon, nowUtcIso } from "../dates";
import {
  CHASE_KIND_DEFINITIONS,
  CHASE_KIND_ORDER,
  CHASE_KINDS,
  chaseClockDecision,
  chaseDefinition,
  chaseKindForRuleKey,
  effectiveChaseIntervalDays,
  laterIso,
  laterIsoAll,
  NO_INSURER_CONTACT_MESSAGE,
  parseChaseIntervalDays,
  type ChaseHandlerState,
  type ChaseIntervalSource,
  type ChaseKind,
} from "../domain/chase";
import { SEEDED_ENGINEER } from "./engineers";
import { all, get, newId, run } from "./connection";

export type ChaseRow = {
  id: string;
  status: string;
  paused: number;
  interval_days: number;
  reason: string | null;
  interval_override_days: number | null;
  interval_override_reason: string | null;
};

export type ChaseView = {
  kind: ChaseKind;
  claimId: string;
  fileReference?: string;
  clientName?: string | null;
  handlerName?: string | null;
  title: string;
  dueLabel: string;
  active: boolean;
  due: boolean;
  outcomeOnFile: boolean;
  handlerState: ChaseHandlerState;
  daysOutstanding: number | null;
  clockAt: string | null;
  dueAt: string | null;
  reason: string;
  label: string | null;
  contactName: string;
  contactEmail: string;
  contactMissing: boolean;
  contactMissingMessage: string | null;
  frozenIntervalDays: number;
  globalIntervalDays: number;
  overrideDays: number | null;
  overrideReason: string | null;
  intervalDays: number;
  intervalSource: ChaseIntervalSource;
};

function handlerStateFromRow(row: { status: string; paused: number } | undefined): ChaseHandlerState {
  if (!row) return "tracking";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "paused" || Number(row.paused) === 1) return "paused";
  return "tracking";
}

function ensureSetting(db: DatabaseSync, key: string, value: string) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(key, value);
  }
}

export function ensureChaseSettings(db: DatabaseSync) {
  for (const kind of CHASE_KINDS) {
    const def = CHASE_KIND_DEFINITIONS[kind];
    ensureSetting(db, def.settingKey, String(def.defaultIntervalDays));
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_claim_rule
    ON automations(claim_id, rule_key);
  `);
}

export function getChaseIntervalDays(kind: ChaseKind): number {
  const def = chaseDefinition(kind);
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [def.settingKey]);
  return parseChaseIntervalDays(row?.value, def.defaultIntervalDays);
}

export function setChaseIntervalDays(kind: ChaseKind, value: string | number) {
  const def = chaseDefinition(kind);
  const days = parseChaseIntervalDays(value, 0);
  if (days < 1) throw new Error("Enter the chase interval as a whole number of days, at least 1.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [def.settingKey]);
  if (existing) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [String(days), def.settingKey]);
  } else {
    run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [def.settingKey, String(days)]);
  }
}

export function latestIsoForEvent(claimId: string, eventType: string): string | null {
  const row = get<{ occurred_at: string }>(
    `SELECT occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1`,
    [claimId, eventType],
  );
  return row?.occurred_at ? String(row.occurred_at) : null;
}

function latestMarkedSentAt(claimId: string, templateKey: string): string | null {
  const correspondence = get<{ created_at: string }>(
    `SELECT created_at FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = 'handler_marked_sent'
     ORDER BY created_at DESC LIMIT 1`,
    [claimId, templateKey],
  );
  return correspondence?.created_at ? String(correspondence.created_at) : null;
}

export function chaseRow(claimId: string, kind: ChaseKind): ChaseRow | undefined {
  const def = chaseDefinition(kind);
  return get<ChaseRow>(
    `SELECT id, status, paused, interval_days, reason, interval_override_days, interval_override_reason
     FROM automations WHERE claim_id = ? AND rule_key = ?`,
    [claimId, def.ruleKey],
  );
}

function startedAtForKind(claimId: string, kind: ChaseKind): string | null {
  const def = chaseDefinition(kind);
  const fromEvents = laterIsoAll(def.startEventTypes.map((eventType) => latestIsoForEvent(claimId, eventType)));
  const fromTemplates = laterIsoAll(def.startTemplateKeys.map((templateKey) => latestMarkedSentAt(claimId, templateKey)));
  return laterIso(fromEvents, fromTemplates);
}

function lastChaseSentAtForKind(claimId: string, kind: ChaseKind): string | null {
  const def = chaseDefinition(kind);
  const sentEvents = [def.chaseSentEventType, ...def.extraChaseSentEventTypes];
  return laterIso(latestMarkedSentAt(claimId, def.templateKey), laterIsoAll(sentEvents.map((eventType) => latestIsoForEvent(claimId, eventType))));
}

function outcomeAtForKind(claimId: string, kind: ChaseKind): string | null {
  const def = chaseDefinition(kind);
  return laterIsoAll(def.outcomeReceivedEventTypes.map((eventType) => latestIsoForEvent(claimId, eventType)));
}

function engineerContact(claimId: string): { name: string; email: string } {
  const row = get<{ name: string | null; email: string | null }>(
    `SELECT e.name, e.email FROM claims c LEFT JOIN engineers e ON e.id = c.engineer_id WHERE c.id = ?`,
    [claimId],
  );
  const name = String(row?.name || "").trim();
  const email = String(row?.email || "").trim();
  if (name && email) return { name, email };
  return { name: SEEDED_ENGINEER.name, email: SEEDED_ENGINEER.email };
}

function insurerContact(claimId: string): { name: string; email: string } {
  const tp = get<{ insurer_name: string | null; insurer_email: string | null; handler_name: string | null; handler_email: string | null }>(
    `SELECT insurer_name, insurer_email, handler_name, handler_email
     FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence ASC LIMIT 1`,
    [claimId],
  );
  const email = String(tp?.insurer_email || tp?.handler_email || "").trim();
  const name = String(tp?.handler_name || tp?.insurer_name || "").trim();
  return { name, email };
}

function contactForKind(claimId: string, kind: ChaseKind): {
  name: string;
  email: string;
  missing: boolean;
  missingMessage: string | null;
} {
  const def = chaseDefinition(kind);
  if (def.recipient === "engineer") {
    const engineer = engineerContact(claimId);
    const missing = !engineer.email;
    return {
      name: engineer.name,
      email: engineer.email,
      missing,
      missingMessage: missing ? "This engineer has no email address. Add one under Settings → Engineers." : null,
    };
  }
  const insurer = insurerContact(claimId);
  const missing = !insurer.email;
  return {
    name: insurer.name || "Insurer",
    email: insurer.email,
    missing,
    missingMessage: missing ? NO_INSURER_CONTACT_MESSAGE : null,
  };
}

export function chaseForClaim(kind: ChaseKind, claimId: string, asAt: string = nowUtcIso()): ChaseView | null {
  const row = chaseRow(claimId, kind);
  if (!row) return null;
  const def = chaseDefinition(kind);
  const startedAt = startedAtForKind(claimId, kind);
  const handlerState = handlerStateFromRow(row);
  const globalDays = getChaseIntervalDays(kind);
  const frozenIntervalDays = parseChaseIntervalDays(row.interval_days, globalDays);
  const overrideDays = parseChaseIntervalDays(row.interval_override_days, 0) >= 1 ? parseChaseIntervalDays(row.interval_override_days) : null;
  const effective = effectiveChaseIntervalDays({
    overrideDays,
    globalDays,
    handlerState,
    frozenDays: frozenIntervalDays,
  });
  const decision = chaseClockDecision({
    startedAt,
    lastChaseSentAt: lastChaseSentAtForKind(claimId, kind),
    outcomeAt: outcomeAtForKind(claimId, kind),
    outcomeClearedAt: latestIsoForEvent(claimId, def.outcomeClearedEventType),
    handlerState,
    intervalDays: effective.days,
    asAt,
    dueLabel: def.dueLabel,
    notStartedReason: def.notStartedReason,
    outcomeOnFileReason: def.outcomeOnFileReason,
  });
  const contact = contactForKind(claimId, kind);
  return {
    kind,
    claimId,
    title: def.title,
    dueLabel: def.dueLabel,
    ...decision,
    contactName: contact.name,
    contactEmail: contact.email,
    contactMissing: contact.missing,
    contactMissingMessage: contact.missingMessage,
    frozenIntervalDays,
    globalIntervalDays: globalDays,
    overrideDays,
    overrideReason: row.interval_override_reason ? String(row.interval_override_reason) : null,
    intervalDays: effective.days,
    intervalSource: effective.source,
  };
}

export function listChasesForClaim(claimId: string, asAt: string = nowUtcIso()): ChaseView[] {
  return CHASE_KIND_ORDER.map((kind) => chaseForClaim(kind, claimId, asAt)).filter((row): row is ChaseView => Boolean(row));
}

export function listDueChases(asAt: string = nowUtcIso()): ChaseView[] {
  const rows = all<{
    claim_id: string;
    rule_key: string;
    file_reference: string;
    client_name: string | null;
    handler_name: string | null;
  }>(
    `SELECT a.claim_id, a.rule_key, c.file_reference, p.full_name AS client_name, s.name AS handler_name
     FROM automations a
     JOIN claims c ON c.id = a.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE a.rule_key IN (${CHASE_KINDS.map(() => "?").join(", ")})`,
    CHASE_KINDS.map((kind) => chaseDefinition(kind).ruleKey),
  );
  const due: ChaseView[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = chaseKindForRuleKey(row.rule_key);
    if (!kind) continue;
    const key = `${row.claim_id}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const view = chaseForClaim(kind, row.claim_id, asAt);
    if (!view?.due) continue;
    due.push({
      ...view,
      fileReference: row.file_reference,
      clientName: row.client_name,
      handlerName: row.handler_name,
    });
  }
  due.sort((a, b) => {
    const kindOrder = CHASE_KIND_ORDER.indexOf(a.kind) - CHASE_KIND_ORDER.indexOf(b.kind);
    if (kindOrder !== 0) return kindOrder;
    return String(a.fileReference || a.claimId).localeCompare(String(b.fileReference || b.claimId));
  });
  return due;
}

export function listDueChasesByKind(asAt: string = nowUtcIso()): Record<ChaseKind, ChaseView[]> {
  const grouped: Record<ChaseKind, ChaseView[]> = {
    engineer_report: [],
    liability_response: [],
    repair_authorisation: [],
  };
  for (const row of listDueChases(asAt)) {
    grouped[row.kind].push(row);
  }
  return grouped;
}

function effectiveDaysForWrite(kind: ChaseKind, existing: ChaseRow | undefined): number {
  const globalDays = getChaseIntervalDays(kind);
  const override = parseChaseIntervalDays(existing?.interval_override_days, 0);
  return override >= 1 ? override : globalDays;
}

export function startChase(kind: ChaseKind, claimId: string, clockAt: string) {
  const def = chaseDefinition(kind);
  const existing = chaseRow(claimId, kind);
  const interval = effectiveDaysForWrite(kind, existing);
  const nextRun = addCalendarDaysIso(clockAt, interval);
  if (existing) {
    run(
      `UPDATE automations SET next_run_at = ?, interval_days = ?, interval_unit = 'calendar_days', paused = 0,
              last_outcome = 'request_marked_sent', reason = ?, status = 'tracking' WHERE id = ?`,
      [nextRun, interval, def.waitingReason, existing.id],
    );
    return existing.id;
  }
  const id = newId("auto");
  run(
    `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, last_outcome, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'calendar_days', 0, 'request_marked_sent', ?, 'tracking')`,
    [id, claimId, def.ruleKey, def.track, nextRun, interval, def.waitingReason],
  );
  return id;
}

export function restartChaseClock(kind: ChaseKind, claimId: string, clockAt: string) {
  const existing = chaseRow(claimId, kind);
  if (!existing) {
    startChase(kind, claimId, clockAt);
    return;
  }
  if (existing.status === "cancelled" || existing.status === "paused" || Number(existing.paused) === 1) {
    return;
  }
  const interval = effectiveDaysForWrite(kind, existing);
  run(
    `UPDATE automations SET next_run_at = ?, interval_days = ?, last_outcome = 'chase_marked_sent', reason = ? WHERE id = ?`,
    [addCalendarDaysIso(clockAt, interval), interval, "Chaser marked as sent. Interval restarted. Reminder only — not auto-sent.", existing.id],
  );
}

function requireChaseRow(kind: ChaseKind, claimId: string) {
  const row = chaseRow(claimId, kind);
  if (!row) {
    throw new Error(`There is no ${chaseDefinition(kind).title.toLowerCase()} on this file yet.`);
  }
  return row;
}

export function pauseChase(kind: ChaseKind, claimId: string) {
  const row = requireChaseRow(kind, claimId);
  if (row.status === "cancelled") throw new Error("This chase has been cancelled.");
  run(
    `UPDATE automations SET paused = 1, status = 'paused', last_outcome = 'paused', reason = ? WHERE id = ?`,
    ["Handler pause — do not show as due. Reminder only — not auto-sent.", row.id],
  );
}

export function resumeChase(kind: ChaseKind, claimId: string) {
  const row = requireChaseRow(kind, claimId);
  if (row.status === "cancelled") {
    throw new Error("This chase has been cancelled. Record the outstanding request again to start a new chase.");
  }
  const interval = effectiveDaysForWrite(kind, row);
  const clock = chaseClockAt(claimId, kind);
  const override = parseChaseIntervalDays(row.interval_override_days, 0) >= 1;
  run(
    `UPDATE automations SET paused = 0, status = 'tracking', interval_days = ?, next_run_at = ?, last_outcome = 'resumed', reason = ? WHERE id = ?`,
    [
      interval,
      clock ? addCalendarDaysIso(clock, interval) : null,
      override
        ? "Chase resumed. Interval follows this file's override, not the global Settings value."
        : "Chase resumed. Interval follows the current Settings value.",
      row.id,
    ],
  );
}

export function cancelChase(kind: ChaseKind, claimId: string) {
  const row = requireChaseRow(kind, claimId);
  run(
    `UPDATE automations SET paused = 1, status = 'cancelled', last_outcome = 'cancelled', reason = ? WHERE id = ?`,
    ["Handler cancelled this chase. It will not show as due unless the outstanding request is recorded again.", row.id],
  );
}

function chaseClockAt(claimId: string, kind: ChaseKind): string | null {
  const started = startedAtForKind(claimId, kind);
  if (!started) return null;
  const chased = lastChaseSentAtForKind(claimId, kind);
  if (chased && chased >= started) return chased;
  return started;
}

export function setChaseIntervalOverride(kind: ChaseKind, claimId: string, daysRaw: string | number, reasonRaw: string) {
  const row = requireChaseRow(kind, claimId);
  const days = parseChaseIntervalDays(daysRaw, 0);
  if (days < 1) throw new Error("Enter this file's chase interval as a whole number of days, at least 1.");
  const reason = String(reasonRaw || "").trim();
  if (!reason) throw new Error("Record why this file uses a different interval (for example “agreed with insurer”).");
  const clock = chaseClockAt(claimId, kind);
  run(
    `UPDATE automations SET interval_override_days = ?, interval_override_reason = ?, interval_days = ?, next_run_at = ? WHERE id = ?`,
    [days, reason, days, clock ? addCalendarDaysIso(clock, days) : null, row.id],
  );
}

export function clearChaseIntervalOverride(kind: ChaseKind, claimId: string) {
  const row = requireChaseRow(kind, claimId);
  const globalDays = getChaseIntervalDays(kind);
  const clock = chaseClockAt(claimId, kind);
  const tracking = row.status !== "cancelled" && row.status !== "paused" && Number(row.paused) !== 1;
  const interval = tracking ? globalDays : parseChaseIntervalDays(row.interval_days, globalDays);
  run(
    `UPDATE automations SET interval_override_days = NULL, interval_override_reason = NULL, interval_days = ?, next_run_at = ? WHERE id = ?`,
    [interval, clock ? addCalendarDaysIso(clock, interval) : null, row.id],
  );
}

export function countChaseRows(kind: ChaseKind, claimId: string): number {
  const def = chaseDefinition(kind);
  const row = get<{ c: number }>(`SELECT COUNT(*) AS c FROM automations WHERE claim_id = ? AND rule_key = ?`, [claimId, def.ruleKey]);
  return Number(row?.c || 0);
}

export function findPreparedChase(kind: ChaseKind, claimId: string) {
  const def = chaseDefinition(kind);
  return get<{
    id: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    sent_status: string | null;
    created_at: string;
  }>(
    `SELECT id, subject, to_address, body, sent_status, created_at
     FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = 'prepared_not_sent'
     ORDER BY created_at DESC
     LIMIT 1`,
    [claimId, def.templateKey],
  );
}

function insertDemoEvent(
  db: DatabaseSync,
  id: string,
  claimId: string,
  eventType: string,
  title: string,
  details: string,
  occurredAt: string,
  actorId: string,
  channel: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO claim_events(
      id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff')`,
  ).run(id, claimId, eventType, title, details, occurredAt, nowUtcIso(), actorId, channel);
}

function insertDemoChaseRow(db: DatabaseSync, id: string, claimId: string, kind: ChaseKind, clockAt: string) {
  const def = chaseDefinition(kind);
  const existing = db
    .prepare(`SELECT id FROM automations WHERE claim_id = ? AND rule_key = ?`)
    .get(claimId, def.ruleKey) as { id: string } | undefined;
  if (existing) return;
  const interval = def.defaultIntervalDays;
  db.prepare(
    `INSERT INTO automations(id, claim_id, rule_key, track, next_run_at, interval_days, interval_unit, paused, last_outcome, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'calendar_days', 0, 'request_marked_sent', ?, 'tracking')`,
  ).run(id, claimId, def.ruleKey, def.track, addCalendarDaysIso(clockAt, interval), interval, def.waitingReason);
}

/** Live database: put the demonstration TEST files on the chase reminders without reseeding. */
export function ensureDemoChases(db: DatabaseSync) {
  const c5 = db.prepare(`SELECT id, engineer_id FROM claims WHERE id = 'c5'`).get() as
    | { id: string; engineer_id: string | null }
    | undefined;
  if (c5) {
    const andy = db.prepare(`SELECT id FROM engineers WHERE id = ?`).get(SEEDED_ENGINEER.id) as { id: string } | undefined;
    if (andy && !c5.engineer_id) {
      db.prepare(`UPDATE claims SET engineer_id = ? WHERE id = 'c5'`).run(SEEDED_ENGINEER.id);
    }
    const instructed = db
      .prepare(
        `SELECT occurred_at FROM claim_events WHERE claim_id = 'c5' AND event_type = 'engineer_instructed' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get() as { occurred_at: string } | undefined;
    insertDemoChaseRow(db, "auto-c5-eng-chase", "c5", "engineer_report", instructed?.occurred_at || nowUtcIso());

    const letterAt = addCalendarDaysIso(nowUtcIso(), -5);
    insertDemoEvent(
      db,
      "ev-c5-letter",
      "c5",
      "initial_letter_tp_insurer",
      "Initial letter to third-party insurer",
      "Notification to Aviva. Simulated send.",
      letterAt,
      "staff-sian",
      "email",
    );
    const liveLetter = db
      .prepare(
        `SELECT occurred_at FROM claim_events WHERE claim_id = 'c5' AND event_type = 'initial_letter_tp_insurer' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get() as { occurred_at: string } | undefined;
    insertDemoChaseRow(db, "auto-c5-liab-chase", "c5", "liability_response", liveLetter?.occurred_at || letterAt);
  }

  const c3 = db.prepare(`SELECT id FROM claims WHERE id = 'c3'`).get() as { id: string } | undefined;
  if (c3) {
    const existingLetter = db
      .prepare(
        `SELECT id, occurred_at FROM claim_events WHERE claim_id = 'c3' AND event_type = 'initial_letter_tp_insurer'
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get() as { id: string; occurred_at: string } | undefined;
    if (existingLetter) {
      const asAt = nowUtcIso();
      if (daysBetweenLondon(existingLetter.occurred_at, asAt) < 3) {
        const backdated = addCalendarDaysIso(asAt, -5);
        db.prepare(`UPDATE claim_events SET occurred_at = ? WHERE id = ?`).run(backdated, existingLetter.id);
        insertDemoChaseRow(db, "auto-c3-liab-chase", "c3", "liability_response", backdated);
      } else {
        insertDemoChaseRow(db, "auto-c3-liab-chase", "c3", "liability_response", existingLetter.occurred_at);
      }
    }
  }

  const c6 = db.prepare(`SELECT id FROM claims WHERE id = 'c6'`).get() as { id: string } | undefined;
  if (c6) {
    const requestedAt = addCalendarDaysIso(nowUtcIso(), -4);
    insertDemoEvent(
      db,
      "ev-c6-repair-req",
      "c6",
      "repair_authorisation_requested",
      "Repair authorisation / payment requested",
      "Estimate sent to Ageas. Simulated send.",
      requestedAt,
      "staff-tom",
      "email",
    );
    const liveRequest = db
      .prepare(
        `SELECT occurred_at FROM claim_events WHERE claim_id = 'c6' AND event_type = 'repair_authorisation_requested' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get() as { occurred_at: string } | undefined;
    insertDemoChaseRow(db, "auto-c6-repair-chase", "c6", "repair_authorisation", liveRequest?.occurred_at || requestedAt);
  }
}

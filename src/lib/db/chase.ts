import type { DatabaseSync } from "node:sqlite";
import {
  AGREEMENT_MAX_DAYS_DEFAULT,
  AGREEMENT_RENEWAL_APPROACHING_DAY_DEFAULT,
  SETTING_AGREEMENT_MAX_DAYS,
  SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY,
} from "../constants";
import { addCalendarDaysIso, daysBetweenLondon, nowUtcIso } from "../dates";
import {
  CHASE_KIND_DEFINITIONS,
  CHASE_KIND_ORDER,
  CHASE_KINDS,
  chaseClockDecision,
  chaseDefinition,
  chaseKindForRuleKey,
  effectiveChaseIntervalDays,
  hireAgreementRenewalDecision,
  laterIso,
  laterIsoAll,
  NO_INSURER_CONTACT_MESSAGE,
  parseChaseIntervalDays,
  type ChaseHandlerState,
  type ChaseIntervalSource,
  type ChaseKind,
  type ChaseSeverity,
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
  severity: ChaseSeverity | null;
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
  agreementDay?: number | null;
  agreementMaxDays?: number | null;
  agreementApproachingDay?: number | null;
  canClearHireRenewal?: boolean;
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
  ensureSetting(db, SETTING_AGREEMENT_MAX_DAYS, String(AGREEMENT_MAX_DAYS_DEFAULT));
  ensureSetting(db, SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY, String(AGREEMENT_RENEWAL_APPROACHING_DAY_DEFAULT));
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

export function getAgreementMaxDays(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_AGREEMENT_MAX_DAYS]);
  return parseChaseIntervalDays(row?.value, AGREEMENT_MAX_DAYS_DEFAULT);
}

export function setAgreementMaxDays(value: string | number) {
  const days = parseChaseIntervalDays(value, 0);
  if (days < 1) throw new Error("Enter the agreement maximum as a whole number of days, at least 1.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [SETTING_AGREEMENT_MAX_DAYS]);
  if (existing) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [String(days), SETTING_AGREEMENT_MAX_DAYS]);
  } else {
    run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_AGREEMENT_MAX_DAYS, String(days)]);
  }
}

export function getAgreementApproachingDay(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY]);
  return parseChaseIntervalDays(row?.value, AGREEMENT_RENEWAL_APPROACHING_DAY_DEFAULT);
}

export function setAgreementApproachingDay(value: string | number) {
  const days = parseChaseIntervalDays(value, 0);
  if (days < 1) throw new Error("Enter the approaching warning as a whole number of days, at least 1.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY]);
  if (existing) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [String(days), SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY]);
  } else {
    run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY, String(days)]);
  }
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

export function chaseRow(claimId: string, kind: ChaseKind): ChaseRow | undefined {
  const def = chaseDefinition(kind);
  return get<ChaseRow>(
    `SELECT id, status, paused, interval_days, reason, interval_override_days, interval_override_reason
     FROM automations WHERE claim_id = ? AND rule_key = ?`,
    [claimId, def.ruleKey],
  );
}

function chaseEventTypes(): string[] {
  const types = new Set<string>();
  for (const kind of CHASE_KINDS) {
    const def = CHASE_KIND_DEFINITIONS[kind];
    for (const eventType of def.startEventTypes) types.add(eventType);
    types.add(def.chaseSentEventType);
    for (const eventType of def.extraChaseSentEventTypes) types.add(eventType);
    for (const eventType of def.outcomeReceivedEventTypes) types.add(eventType);
    types.add(def.outcomeClearedEventType);
  }
  return [...types];
}

function chaseTemplateKeys(): string[] {
  const keys = new Set<string>();
  for (const kind of CHASE_KINDS) {
    const def = CHASE_KIND_DEFINITIONS[kind];
    for (const templateKey of def.startTemplateKeys) keys.add(templateKey);
    keys.add(def.templateKey);
  }
  return [...keys];
}

function factKey(claimId: string, name: string) {
  return `${claimId}\t${name}`;
}

type HireClaimFacts = {
  episodeId: string | null;
  collectionAt: string | null;
  billingEndAt: string | null;
  hireStatus: string | null;
  reservationKind: string | null;
  signedStartOn: string | null;
  latestSignedSequence: number;
  agreementMaxDays: number | null;
  agreementAlertDay: number | null;
  agreementCount: number;
};

type ChaseFacts = {
  latestEvent: Map<string, string>;
  latestMarkedSent: Map<string, string>;
  intervals: Record<ChaseKind, number>;
  agreementMaxDays: number;
  agreementApproachingDay: number;
  contacts: Map<string, { engineerName: string; engineerEmail: string; insurerName: string; insurerEmail: string }>;
  hire: Map<string, HireClaimFacts>;
};

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function loadAgreementLimits(): { maxDays: number; approachingDay: number } {
  const rows = all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (?, ?)`,
    [SETTING_AGREEMENT_MAX_DAYS, SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY],
  );
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    maxDays: parseChaseIntervalDays(byKey[SETTING_AGREEMENT_MAX_DAYS], AGREEMENT_MAX_DAYS_DEFAULT),
    approachingDay: parseChaseIntervalDays(
      byKey[SETTING_AGREEMENT_RENEWAL_APPROACHING_DAY],
      AGREEMENT_RENEWAL_APPROACHING_DAY_DEFAULT,
    ),
  };
}

/** Load every chase clock fact for the given files in a handful of queries, not one per claim/type. */
function loadChaseIntervals(): Record<ChaseKind, number> {
  const keys = CHASE_KINDS.map((kind) => chaseDefinition(kind).settingKey);
  const rows = all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${placeholders(keys.length)})`,
    keys,
  );
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const intervals = {} as Record<ChaseKind, number>;
  for (const kind of CHASE_KINDS) {
    const def = chaseDefinition(kind);
    intervals[kind] = parseChaseIntervalDays(byKey[def.settingKey], def.defaultIntervalDays);
  }
  return intervals;
}

function hireEnded(facts: HireClaimFacts, asAt: string): boolean {
  if (String(facts.hireStatus || "") === "ended") return true;
  if (facts.collectionAt) return true;
  if (facts.billingEndAt && String(facts.billingEndAt) <= asAt) return true;
  return false;
}

function hireChaseApplies(facts: HireClaimFacts): boolean {
  if (!facts.episodeId) return false;
  const kind = String(facts.reservationKind || "");
  if ((kind === "courtesy" || kind === "staff") && facts.agreementCount === 0) return false;
  return true;
}

function loadHireFacts(claimIds: string[]): Map<string, HireClaimFacts> {
  const hire = new Map<string, HireClaimFacts>();
  if (claimIds.length === 0) return hire;
  const episodes = all<{
    claim_id: string;
    episode_id: string;
    collection_at: string | null;
    billing_end_at: string | null;
    hire_status: string | null;
    reservation_kind: string | null;
  }>(
    `SELECT he.claim_id, he.id AS episode_id, he.collection_at, he.billing_end_at, c.hire_status,
            (
              SELECT r.kind FROM reservations r
              WHERE r.claim_id = he.claim_id AND r.fleet_vehicle_id = he.fleet_vehicle_id
                AND r.status IN ('reserved','active')
              ORDER BY r.start_at DESC LIMIT 1
            ) AS reservation_kind
     FROM hire_episodes he
     JOIN claims c ON c.id = he.claim_id
     WHERE he.claim_id IN (${placeholders(claimIds.length)})
     ORDER BY he.started_at DESC`,
    claimIds,
  );
  for (const row of episodes) {
    if (hire.has(row.claim_id)) continue;
    hire.set(row.claim_id, {
      episodeId: String(row.episode_id),
      collectionAt: row.collection_at ? String(row.collection_at) : null,
      billingEndAt: row.billing_end_at ? String(row.billing_end_at) : null,
      hireStatus: row.hire_status ? String(row.hire_status) : null,
      reservationKind: row.reservation_kind ? String(row.reservation_kind) : null,
      signedStartOn: null,
      latestSignedSequence: 0,
      agreementMaxDays: null,
      agreementAlertDay: null,
      agreementCount: 0,
    });
  }
  const episodeIds = [...hire.values()].map((row) => row.episodeId).filter((id): id is string => Boolean(id));
  if (episodeIds.length === 0) return hire;
  const agreements = all<{
    hire_episode_id: string;
    start_on: string | null;
    max_days: number | null;
    renewal_alert_day: number | null;
    signed: number;
    sequence: number;
  }>(
    `SELECT hire_episode_id, start_on, max_days, renewal_alert_day, signed, sequence
     FROM agreements
     WHERE hire_episode_id IN (${placeholders(episodeIds.length)})
     ORDER BY sequence DESC`,
    episodeIds,
  );
  const byEpisode = new Map<string, HireClaimFacts>();
  for (const facts of hire.values()) {
    if (facts.episodeId) byEpisode.set(facts.episodeId, facts);
  }
  for (const row of agreements) {
    const facts = byEpisode.get(String(row.hire_episode_id));
    if (!facts) continue;
    facts.agreementCount += 1;
    if (Number(row.signed) === 1 && !facts.signedStartOn) {
      const start = String(row.start_on || "").trim();
      facts.signedStartOn = start || null;
      facts.latestSignedSequence = Number(row.sequence);
      facts.agreementMaxDays = row.max_days == null ? null : Number(row.max_days);
      facts.agreementAlertDay = row.renewal_alert_day == null ? null : Number(row.renewal_alert_day);
    }
  }
  return hire;
}

function loadChaseFacts(claimIds: string[]): ChaseFacts {
  const limits = loadAgreementLimits();
  const empty: ChaseFacts = {
    latestEvent: new Map(),
    latestMarkedSent: new Map(),
    intervals: loadChaseIntervals(),
    agreementMaxDays: limits.maxDays,
    agreementApproachingDay: limits.approachingDay,
    contacts: new Map(),
    hire: new Map(),
  };
  if (claimIds.length === 0) return empty;

  const eventTypes = chaseEventTypes();
  const events = all<{ claim_id: string; event_type: string; occurred_at: string }>(
    `SELECT claim_id, event_type, occurred_at FROM claim_events
     WHERE claim_id IN (${placeholders(claimIds.length)}) AND event_type IN (${placeholders(eventTypes.length)})
     ORDER BY occurred_at DESC, recorded_at DESC`,
    [...claimIds, ...eventTypes],
  );
  for (const row of events) {
    const key = factKey(row.claim_id, row.event_type);
    if (!empty.latestEvent.has(key)) empty.latestEvent.set(key, String(row.occurred_at));
  }

  const templateKeys = chaseTemplateKeys();
  const sent = all<{ claim_id: string; template_key: string; created_at: string }>(
    `SELECT claim_id, template_key, created_at FROM correspondence
     WHERE claim_id IN (${placeholders(claimIds.length)})
       AND sent_status = 'handler_marked_sent'
       AND template_key IN (${placeholders(templateKeys.length)})
     ORDER BY created_at DESC`,
    [...claimIds, ...templateKeys],
  );
  for (const row of sent) {
    const key = factKey(row.claim_id, row.template_key);
    if (!empty.latestMarkedSent.has(key)) empty.latestMarkedSent.set(key, String(row.created_at));
  }

  const contacts = all<{
    claim_id: string;
    engineer_name: string | null;
    engineer_email: string | null;
    insurer_name: string | null;
    insurer_email: string | null;
    handler_name: string | null;
    handler_email: string | null;
  }>(
    `SELECT c.id AS claim_id, e.name AS engineer_name, e.email AS engineer_email,
            tp.insurer_name, tp.insurer_email, tp.handler_name, tp.handler_email
     FROM claims c
     LEFT JOIN engineers e ON e.id = c.engineer_id
     LEFT JOIN claim_third_parties tp ON tp.claim_id = c.id AND tp.id = (
       SELECT id FROM claim_third_parties WHERE claim_id = c.id ORDER BY sequence ASC LIMIT 1
     )
     WHERE c.id IN (${placeholders(claimIds.length)})`,
    claimIds,
  );
  for (const row of contacts) {
    empty.contacts.set(row.claim_id, {
      engineerName: String(row.engineer_name || "").trim(),
      engineerEmail: String(row.engineer_email || "").trim(),
      insurerName: String(row.handler_name || row.insurer_name || "").trim(),
      insurerEmail: String(row.insurer_email || row.handler_email || "").trim(),
    });
  }
  empty.hire = loadHireFacts(claimIds);
  return empty;
}

function latestFact(map: Map<string, string>, claimId: string, name: string): string | null {
  return map.get(factKey(claimId, name)) || null;
}

function startedAtFromFacts(facts: ChaseFacts, claimId: string, kind: ChaseKind): string | null {
  const def = chaseDefinition(kind);
  const fromEvents = laterIsoAll(def.startEventTypes.map((eventType) => latestFact(facts.latestEvent, claimId, eventType)));
  const fromTemplates = laterIsoAll(def.startTemplateKeys.map((templateKey) => latestFact(facts.latestMarkedSent, claimId, templateKey)));
  return laterIso(fromEvents, fromTemplates);
}

function lastChaseSentFromFacts(facts: ChaseFacts, claimId: string, kind: ChaseKind): string | null {
  const def = chaseDefinition(kind);
  const sentEvents = [def.chaseSentEventType, ...def.extraChaseSentEventTypes];
  return laterIso(
    latestFact(facts.latestMarkedSent, claimId, def.templateKey),
    laterIsoAll(sentEvents.map((eventType) => latestFact(facts.latestEvent, claimId, eventType))),
  );
}

function contactFromFacts(facts: ChaseFacts, claimId: string, kind: ChaseKind): {
  name: string;
  email: string;
  missing: boolean;
  missingMessage: string | null;
} {
  const def = chaseDefinition(kind);
  const row = facts.contacts.get(claimId);
  if (def.recipient === "none") {
    return { name: "Hire agreement", email: "", missing: false, missingMessage: null };
  }
  if (def.recipient === "engineer") {
    const name = row?.engineerName || SEEDED_ENGINEER.name;
    const email = row?.engineerEmail || SEEDED_ENGINEER.email;
    const missing = !email;
    return {
      name,
      email,
      missing,
      missingMessage: missing ? "This engineer has no email address. Add one under Settings → Engineers." : null,
    };
  }
  const name = row?.insurerName || "Insurer";
  const email = row?.insurerEmail || "";
  const missing = !email;
  return {
    name,
    email,
    missing,
    missingMessage: missing ? NO_INSURER_CONTACT_MESSAGE : null,
  };
}

function evaluateChase(kind: ChaseKind, claimId: string, row: ChaseRow, facts: ChaseFacts, asAt: string): ChaseView {
  const def = chaseDefinition(kind);
  const handlerState = handlerStateFromRow(row);
  const globalDays = facts.intervals[kind];
  const frozenIntervalDays = parseChaseIntervalDays(row.interval_days, globalDays);
  const overrideDays = parseChaseIntervalDays(row.interval_override_days, 0) >= 1 ? parseChaseIntervalDays(row.interval_override_days) : null;
  const effective = effectiveChaseIntervalDays({
    overrideDays,
    globalDays,
    handlerState,
    frozenDays: frozenIntervalDays,
  });
  const hire = facts.hire.get(claimId);
  const decision =
    def.clockMode === "agreement_day"
      ? hireAgreementRenewalDecision({
          applies: hire ? hireChaseApplies(hire) : false,
          hireEnded: hire ? hireEnded(hire, asAt) : false,
          startOn: hire?.signedStartOn || null,
          asAt,
          approachingDay: facts.agreementApproachingDay,
          alertDay: effective.days,
          maxDays: hire?.agreementMaxDays || facts.agreementMaxDays,
          handlerState,
          approachingLabel: def.approachingLabel || def.dueLabel,
          dueLabel: def.dueLabel,
          overdueLabel: def.overdueLabel || def.dueLabel,
        })
      : chaseClockDecision({
          startedAt: startedAtFromFacts(facts, claimId, kind),
          lastChaseSentAt: def.ignoreLastChaseSent ? null : lastChaseSentFromFacts(facts, claimId, kind),
          outcomeAt: laterIsoAll(def.outcomeReceivedEventTypes.map((eventType) => latestFact(facts.latestEvent, claimId, eventType))),
          outcomeClearedAt: latestFact(facts.latestEvent, claimId, def.outcomeClearedEventType),
          handlerState,
          intervalDays: effective.days,
          asAt,
          dueLabel: def.dueLabel,
          notStartedReason: def.notStartedReason,
          outcomeOnFileReason: def.outcomeOnFileReason,
        });
  const contact = contactFromFacts(facts, claimId, kind);
  return {
    kind,
    claimId,
    title: def.title,
    dueLabel: decision.label || def.dueLabel,
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
    agreementDay: def.clockMode === "agreement_day" ? decision.daysOutstanding : null,
    agreementMaxDays: def.clockMode === "agreement_day" ? hire?.agreementMaxDays || facts.agreementMaxDays : null,
    agreementApproachingDay: def.clockMode === "agreement_day" ? facts.agreementApproachingDay : null,
    canClearHireRenewal: def.clockMode === "agreement_day" && Number(hire?.latestSignedSequence || 0) > 1,
  };
}

export function chaseForClaim(kind: ChaseKind, claimId: string, asAt: string = nowUtcIso()): ChaseView | null {
  const row = chaseRow(claimId, kind);
  if (!row) return null;
  return evaluateChase(kind, claimId, row, loadChaseFacts([claimId]), asAt);
}

export function listChasesForClaim(claimId: string, asAt: string = nowUtcIso()): ChaseView[] {
  const facts = loadChaseFacts([claimId]);
  const rows = all<ChaseRow & { rule_key: string }>(
    `SELECT id, status, paused, interval_days, reason, interval_override_days, interval_override_reason, rule_key
     FROM automations WHERE claim_id = ? AND rule_key IN (${placeholders(CHASE_KINDS.length)})`,
    [claimId, ...CHASE_KINDS.map((kind) => chaseDefinition(kind).ruleKey)],
  );
  const byKind = new Map(rows.map((row) => [chaseKindForRuleKey(row.rule_key), row]));
  return CHASE_KIND_ORDER.map((kind) => {
    const row = byKind.get(kind);
    if (!row) return null;
    return evaluateChase(kind, claimId, row, facts, asAt);
  }).filter((row): row is ChaseView => Boolean(row));
}

type ListedChaseRow = ChaseRow & {
  claim_id: string;
  rule_key: string;
  file_reference: string;
  client_name: string | null;
  handler_name: string | null;
};

export function listDueChases(asAt: string = nowUtcIso()): ChaseView[] {
  const rows = all<ListedChaseRow>(
    `SELECT a.id, a.claim_id, a.rule_key, a.status, a.paused, a.interval_days, a.reason,
            a.interval_override_days, a.interval_override_reason,
            c.file_reference, p.full_name AS client_name, s.name AS handler_name
     FROM automations a
     JOIN claims c ON c.id = a.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE a.rule_key IN (${placeholders(CHASE_KINDS.length)})`,
    CHASE_KINDS.map((kind) => chaseDefinition(kind).ruleKey),
  );
  const claimIds = [...new Set(rows.map((row) => row.claim_id))];
  const facts = loadChaseFacts(claimIds);
  const due: ChaseView[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = chaseKindForRuleKey(row.rule_key);
    if (!kind) continue;
    const key = `${row.claim_id}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const view = evaluateChase(kind, row.claim_id, row, facts, asAt);
    if (!view.due) continue;
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
    const severityRank = (value: ChaseSeverity | null) =>
      value === "red_overdue" ? 0 : value === "red" ? 1 : value === "amber" ? 2 : 3;
    const severityOrder = severityRank(a.severity) - severityRank(b.severity);
    if (severityOrder !== 0) return severityOrder;
    return String(a.fileReference || a.claimId).localeCompare(String(b.fileReference || b.claimId));
  });
  return due;
}

export function listDueChasesByKind(asAt: string = nowUtcIso()): Record<ChaseKind, ChaseView[]> {
  const grouped = {} as Record<ChaseKind, ChaseView[]>;
  for (const kind of CHASE_KINDS) grouped[kind] = [];
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
  const facts = loadChaseFacts([claimId]);
  const started = startedAtFromFacts(facts, claimId, kind);
  if (!started) return null;
  const chased = lastChaseSentFromFacts(facts, claimId, kind);
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

  ensureHireAgreementRenewalChases(db);
}

function ensureHireAgreementRenewalChases(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT he.claim_id, he.id AS episode_id, he.started_at, he.collection_at, he.billing_end_at, c.hire_status,
              (
                SELECT r.kind FROM reservations r
                WHERE r.claim_id = he.claim_id AND r.fleet_vehicle_id = he.fleet_vehicle_id
                  AND r.status IN ('reserved','active')
                ORDER BY r.start_at DESC LIMIT 1
              ) AS reservation_kind,
              (SELECT COUNT(*) FROM agreements a WHERE a.hire_episode_id = he.id) AS agreement_count
       FROM hire_episodes he
       JOIN claims c ON c.id = he.claim_id`,
    )
    .all() as Array<{
    claim_id: string;
    episode_id: string;
    started_at: string | null;
    collection_at: string | null;
    billing_end_at: string | null;
    hire_status: string | null;
    reservation_kind: string | null;
    agreement_count: number;
  }>;
  const asAt = nowUtcIso();
  for (const row of rows) {
    if (String(row.hire_status || "") === "ended") continue;
    if (row.collection_at) continue;
    if (row.billing_end_at && String(row.billing_end_at) <= asAt) continue;
    const kind = String(row.reservation_kind || "");
    if ((kind === "courtesy" || kind === "staff") && Number(row.agreement_count) === 0) continue;
    insertDemoChaseRow(
      db,
      `auto-${row.claim_id}-hire-renewal`,
      row.claim_id,
      "hire_agreement_renewal",
      row.started_at || asAt,
    );
  }
}

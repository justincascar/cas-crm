import { formatUkDateTime, nowUtcIso } from "../dates";
import { get, getDb, newId } from "./connection";

/** Hidden field on every staff edit form. The value is the version loaded with the page. */
export const RECORD_VERSION = "recordVersion";

export const LOADED_JSON = "loadedJson";

export type ChangedField = {
  name: string;
  label: string;
  saved: string;
  yours: string;
};

export type SaveClashView = {
  id: string;
  message: string;
  actorName: string;
  changedAt: string;
  changedFields: ChangedField[];
  submitted: Record<string, string>;
  expectedVersion: string;
  scope: string;
  recordKey: string;
  unsaved: ChangedField[];
};

const JOB_NAMES: Record<string, string> = {
  "job:payment-chase": "Payment chase",
  "job:storage-proposal": "Storage end proposal",
  "job:engineer-chase": "Engineer chase",
  "job:liability-chase": "Liability chase",
  "job:repair-authorisation-chase": "Repair authorisation chase",
  "job:hire-agreement-renewal": "Hire agreement renewal",
};

export function jobActorId(
  job:
    | "payment-chase"
    | "storage-proposal"
    | "engineer-chase"
    | "liability-chase"
    | "repair-authorisation-chase"
    | "hire-agreement-renewal",
): string {
  return `job:${job}`;
}

export class VersionConflictError extends Error {
  readonly code = "version_conflict";

  constructor(
    readonly actorName: string,
    readonly changedAt: string,
    readonly changedFields: ChangedField[],
    readonly submitted: Record<string, string>,
  readonly expectedVersion: string,
  readonly scope: string,
  readonly recordKey: string,
  readonly unsaved: ChangedField[] = [],
  message?: string,
) {
    super(message || conflictSentence(actorName, changedAt));
    this.name = "VersionConflictError";
  }
}

export function conflictSentence(actorName: string, changedAtIso: string): string {
  return `${actorName} changed this on ${formatUkDateTime(changedAtIso)} after you opened it. Your changes have not been saved.`;
}

export function formVersion(form: FormData): string {
  const raw = form.get(RECORD_VERSION);
  return raw == null ? "" : String(raw);
}

/** A shared-field token. Omitted when the form did not send one, so internal callers are not refused. */
export function postedVersion(form: FormData, name: string): string | undefined {
  if (!form.has(name)) return undefined;
  const raw = form.get(name);
  return raw == null ? "" : String(raw);
}

export function formLoaded(form: FormData): Record<string, string> | undefined {
  const raw = String(form.get(LOADED_JSON) || "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value == null) out[key] = "";
      else out[key] = String(value);
    }
    return out;
  } catch {
    return undefined;
  }
}

export function actorName(actorId: string | null | undefined): string {
  const id = String(actorId || "").trim();
  if (!id) return "Someone";
  if (JOB_NAMES[id]) return JOB_NAMES[id];
  const staff = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [id]);
  const name = String(staff?.name || "").trim();
  return name || "Someone";
}

export function sectionVersion(scope: string, recordKey: string): string {
  const row = get<{ updated_at: string }>(
    `SELECT updated_at FROM record_versions WHERE scope = ? AND record_key = ?`,
    [scope, recordKey],
  );
  return row?.updated_at || "";
}

export function screenVersion(claimId: string, screenKey: string): string {
  const row = get<{ updated_at: string }>(
    `SELECT updated_at FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`,
    [claimId, screenKey],
  );
  return row?.updated_at || "";
}

type VersionRow = { updated_at: string; updated_by: string; fields_json: string };

function readSection(scope: string, recordKey: string): VersionRow | undefined {
  return get<VersionRow>(
    `SELECT updated_at, updated_by, fields_json FROM record_versions WHERE scope = ? AND record_key = ?`,
    [scope, recordKey],
  );
}

export function withImmediateTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* the statement that failed may already have ended the transaction */
    }
    throw error;
  }
}

/** A second write in the same millisecond must not reuse the version it is replacing. */
export function nextVersionStamp(previous: string | null | undefined): string {
  const now = nowUtcIso();
  const prior = String(previous || "");
  if (!prior || now > prior) return now;
  const bumped = new Date(Date.parse(prior) + 1);
  if (!Number.isNaN(bumped.getTime())) {
    const iso = bumped.toISOString();
    if (iso > prior) return iso;
  }
  return `${prior}+`;
}

function runChanges(sql: string, params: unknown[]): number {
  const result = getDb().prepare(sql).run(...(params as never[])) as { changes?: number };
  return Number(result?.changes ?? 0);
}

function labelFor(name: string, labels?: Record<string, string>): string {
  if (labels?.[name]) return labels[name];
  const spaced = name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function showValue(value: string): string {
  const text = value.trim();
  return text || "blank";
}

function parseFields(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value == null) out[key] = "";
      else if (typeof value === "object") out[key] = JSON.stringify(value);
      else out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function changedFieldList(input: {
  loaded?: Record<string, string>;
  current: Record<string, string>;
  submitted: Record<string, string>;
  labels?: Record<string, string>;
}): ChangedField[] {
  const loaded = input.loaded;
  const names = new Set<string>([
    ...Object.keys(input.current),
    ...Object.keys(input.submitted),
    ...(loaded ? Object.keys(loaded) : []),
  ]);
  const fields: ChangedField[] = [];
  for (const name of names) {
    if (name === RECORD_VERSION || name === LOADED_JSON) continue;
    const current = input.current[name] || "";
    const submitted = input.submitted[name] || "";
    const opened = loaded ? loaded[name] || "" : undefined;
    const theyChanged = opened === undefined ? current !== submitted : opened !== current;
    if (!theyChanged) continue;
    fields.push({
      name,
      label: labelFor(name, input.labels),
      saved: showValue(current),
      yours: showValue(opened === undefined ? submitted : submitted),
    });
  }
  return fields;
}

export function unsavedEntries(input: {
  loaded?: Record<string, string>;
  submitted: Record<string, string>;
  labels?: Record<string, string>;
}): ChangedField[] {
  const entries: ChangedField[] = [];
  for (const [name, value] of Object.entries(input.submitted)) {
    if (name === RECORD_VERSION || name === LOADED_JSON) continue;
    const opened = input.loaded ? input.loaded[name] || "" : undefined;
    if (opened !== undefined && opened === (value || "")) continue;
    if (opened === undefined && !(value || "").trim()) continue;
    entries.push({
      name,
      label: labelFor(name, input.labels),
      saved: "",
      yours: showValue(value || ""),
    });
  }
  return entries;
}

function unmatched(input: {
  expected: string;
  submitted: Record<string, string>;
  scope: string;
  recordKey: string;
}): VersionConflictError {
  return new VersionConflictError(
    "Someone",
    nowUtcIso(),
    [],
    input.submitted,
    input.expected,
    input.scope,
    input.recordKey,
    unsavedEntries({ submitted: input.submitted }),
    "This save did not match the version on the file. Your changes have not been saved.",
  );
}

function conflictFrom(input: {
  actorId: string;
  changedAt: string;
  current: Record<string, string>;
  submitted: Record<string, string>;
  loaded?: Record<string, string>;
  labels?: Record<string, string>;
  expected: string;
  scope: string;
  recordKey: string;
}): VersionConflictError {
  const name = actorName(input.actorId);
  return new VersionConflictError(
    name,
    input.changedAt,
    changedFieldList({
      loaded: input.loaded,
      current: input.current,
      submitted: input.submitted,
      labels: input.labels,
    }),
    input.submitted,
    input.expected,
    input.scope,
    input.recordKey,
    unsavedEntries({ loaded: input.loaded, submitted: input.submitted, labels: input.labels }),
    conflictSentence(name, input.changedAt),
  );
}

/**
 * Every saved section is written to the audit log: who, when, which record, and each field that changed with its old
 * and new value (J12). Nothing is written when nothing changed.
 */
function auditSave(
  input: { scope: string; recordKey: string; actorId: string; fields: Record<string, string>; labels?: Record<string, string> },
  before: Record<string, string>,
  at: string,
) {
  const changes = Object.keys(input.fields)
    .filter((name) => String(before[name] ?? "") !== String(input.fields[name] ?? ""))
    .map((name) => {
      const label = input.labels?.[name] || name;
      const was = String(before[name] ?? "").trim() || "blank";
      const now = String(input.fields[name] ?? "").trim() || "blank";
      return `${label}: ${was.slice(0, 120)} → ${now.slice(0, 120)}`;
    });
  if (changes.length === 0) return;
  getDb()
    .prepare(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'save', ?, ?, ?)`)
    .run(newId("audit"), at, input.actorId, input.scope, input.recordKey, changes.join("; "));
}

/**
 * Staff forms pass the version they loaded, including "" when the section had not been saved.
 * A missing or different version does not overwrite. Call this inside withImmediateTransaction.
 */
export function claimSectionForSave(input: {
  scope: string;
  recordKey: string;
  expected: string;
  actorId: string;
  submitted: Record<string, string>;
  loaded?: Record<string, string>;
  labels?: Record<string, string>;
  fields: Record<string, string>;
}): void {
  const row = readSection(input.scope, input.recordKey);
  const now = nextVersionStamp(row?.updated_at);
  const json = JSON.stringify(input.fields);
  if (!row) {
    if (input.expected !== "") throw unmatched(input);
    const inserted = runChanges(
      `INSERT INTO record_versions(scope, record_key, updated_at, updated_by, fields_json) VALUES (?, ?, ?, ?, ?)`,
      [input.scope, input.recordKey, now, input.actorId, json],
    );
    if (inserted !== 1) throw unmatched(input);
    auditSave(input, {}, now);
    return;
  }
  if (row.updated_at !== input.expected) {
    throw conflictFrom({
      ...input,
      actorId: row.updated_by,
      changedAt: row.updated_at,
      current: parseFields(row.fields_json),
    });
  }
  const updated = runChanges(
    `UPDATE record_versions SET updated_at = ?, updated_by = ?, fields_json = ? WHERE scope = ? AND record_key = ? AND updated_at = ?`,
    [now, input.actorId, json, input.scope, input.recordKey, input.expected],
  );
  if (updated === 1) auditSave(input, parseFields(row.fields_json), now);
  if (updated !== 1) {
    const latest = readSection(input.scope, input.recordKey);
    throw conflictFrom({
      ...input,
      actorId: latest?.updated_by || row.updated_by,
      changedAt: latest?.updated_at || row.updated_at,
      current: parseFields(latest?.fields_json || row.fields_json),
    });
  }
}

export function withSectionSave<T>(input: {
  scope: string;
  recordKey: string;
  expected: string;
  actorId: string;
  submitted: Record<string, string>;
  loaded?: Record<string, string>;
  labels?: Record<string, string>;
  fields: Record<string, string>;
  write: () => T;
}): T {
  return withImmediateTransaction(() => {
    const result = input.write();
    claimSectionForSave(input);
    return result;
  });
}

type ScreenRow = { data_json: string; updated_at: string; updated_by: string | null };

export function readScreenRow(claimId: string, screenKey: string): ScreenRow | undefined {
  return get<ScreenRow>(
    `SELECT data_json, updated_at, updated_by FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`,
    [claimId, screenKey],
  );
}

/** Replace the screen JSON only when expected matches the row loaded with the page. */
export function writeScreenIfCurrent(input: {
  claimId: string;
  screenKey: string;
  expected: string;
  actorId: string;
  stored: Record<string, string>;
  loaded?: Record<string, string>;
  labels?: Record<string, string>;
}): { now: string; previous: Record<string, string> } {
  const scope = "screen";
  const recordKey = `${input.claimId}:${input.screenKey}`;
  const row = readScreenRow(input.claimId, input.screenKey);
  const now = nextVersionStamp(row?.updated_at);
  const previous = row ? parseFields(row.data_json) : {};
  const next = { ...previous, ...input.stored };
  const json = JSON.stringify(next);
  if (!row) {
    if (input.expected !== "") {
      throw unmatched({ expected: input.expected, submitted: input.stored, scope, recordKey });
    }
    const inserted = runChanges(
      `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [input.claimId, input.screenKey, json, now, input.actorId],
    );
    if (inserted !== 1) throw unmatched({ expected: input.expected, submitted: input.stored, scope, recordKey });
    auditSave({ scope: `screen:${input.screenKey}`, recordKey: input.claimId, actorId: input.actorId, fields: input.stored, labels: input.labels }, previous, now);
    return { now, previous };
  }
  if ((row.updated_at || "") !== input.expected) {
    throw conflictFrom({
      actorId: row.updated_by || "",
      changedAt: row.updated_at,
      current: previous,
      submitted: input.stored,
      loaded: input.loaded,
      labels: input.labels,
      expected: input.expected,
      scope,
      recordKey,
    });
  }
  const updated = runChanges(
    `UPDATE claim_screen_data SET data_json = ?, updated_at = ?, updated_by = ? WHERE claim_id = ? AND screen_key = ? AND updated_at = ?`,
    [json, now, input.actorId, input.claimId, input.screenKey, input.expected],
  );
  if (updated !== 1) {
    const latest = readScreenRow(input.claimId, input.screenKey);
    throw conflictFrom({
      actorId: latest?.updated_by || row.updated_by || "",
      changedAt: latest?.updated_at || row.updated_at,
      current: parseFields(latest?.data_json || row.data_json),
      submitted: input.stored,
      loaded: input.loaded,
      labels: input.labels,
      expected: input.expected,
      scope,
      recordKey,
    });
  }
  auditSave({ scope: `screen:${input.screenKey}`, recordKey: input.claimId, actorId: input.actorId, fields: input.stored, labels: input.labels }, previous, now);
  return { now, previous };
}

/**
 * A background job re-reads the screen and writes only its own keys.
 * Other keys on that screen are left as they are. The screen version moves on,
 * so a staff save of the same screen is refused and names this job.
 */
export function applyJobScreenFields(input: {
  claimId: string;
  screenKey: string;
  actorId: string;
  fields: Record<string, string>;
}): void {
  withImmediateTransaction(() => {
    const row = readScreenRow(input.claimId, input.screenKey);
    const current = row ? parseFields(row.data_json) : {};
    const next = { ...current };
    for (const [key, value] of Object.entries(input.fields)) next[key] = value;
    const now = nextVersionStamp(row?.updated_at);
    const json = JSON.stringify(next);
    if (!row) {
      runChanges(
        `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
        [input.claimId, input.screenKey, json, now, input.actorId],
      );
      return;
    }
    runChanges(
      `UPDATE claim_screen_data SET data_json = ?, updated_at = ?, updated_by = ? WHERE claim_id = ? AND screen_key = ?`,
      [json, now, input.actorId, input.claimId, input.screenKey],
    );
  });
}

/** Proposal fields only. Does not confirm a storage end and does not write the storage screen. */
export function storeStorageEndProposal(input: { claimId: string; proposedOn: string; basis: string }): void {
  withImmediateTransaction(() => {
    claimSectionForSave({
      scope: "storage-proposal",
      recordKey: input.claimId,
      expected: sectionVersion("storage-proposal", input.claimId),
      actorId: jobActorId("storage-proposal"),
      submitted: { proposedOn: input.proposedOn, basis: input.basis },
      fields: { proposedOn: input.proposedOn, basis: input.basis },
      labels: { proposedOn: "Proposed storage end", basis: "Proposal basis" },
    });
  });
}

export function rememberClash(error: VersionConflictError): string {
  const id = newId("clash");
  const payload: SaveClashView = {
    id,
    message: error.message,
    actorName: error.actorName,
    changedAt: error.changedAt,
    changedFields: error.changedFields,
    submitted: error.submitted,
    expectedVersion: error.expectedVersion,
    scope: error.scope,
    recordKey: error.recordKey,
    unsaved: error.unsaved,
  };
  runChanges(`INSERT INTO save_clashes(id, payload_json, created_at) VALUES (?, ?, ?)`, [
    id,
    JSON.stringify(payload),
    nowUtcIso(),
  ]);
  return id;
}

export function loadClash(id: string | undefined | null): SaveClashView | null {
  const key = String(id || "").trim();
  if (!key) return null;
  const row = get<{ payload_json: string }>(`SELECT payload_json FROM save_clashes WHERE id = ?`, [key]);
  if (!row?.payload_json) return null;
  try {
    const parsed = JSON.parse(row.payload_json) as SaveClashView;
    if (!parsed || typeof parsed.message !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pathWithClash(path: string, error: VersionConflictError): string {
  const id = rememberClash(error);
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}clash=${encodeURIComponent(id)}`;
}

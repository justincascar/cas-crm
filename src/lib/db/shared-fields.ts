import {
  actorName,
  changedFieldList,
  claimSectionForSave,
  conflictSentence,
  sectionVersion,
  unsavedEntries,
  VersionConflictError,
} from "./record-version";
import { get } from "./connection";

/** Claim facts and the Accident screen both write these claim columns. */
export const SHARED_CIRCUMSTANCES = "shared-circumstances";
/** Claim facts and the Client insurer screen both write these claim columns. */
export const SHARED_OWN_INSURER = "shared-own-insurer";
/** Claim facts and the liability chase outcome both write this claim column. */
export const SHARED_INSURER_POSITION = "shared-insurer-position";
/** Client details and the hire pack both write these columns on the client. */
export const SHARED_CLIENT_PERSON = "shared-client-person";
/** Vehicle details and the hire pack both write the client's GTA group. */
export const SHARED_CLIENT_GTA = "shared-client-gta";
/** Vehicle details and Third party 1 both write the first third-party vehicle. */
export const SHARED_TP_VEHICLE = "shared-tp-vehicle";
/** Storage details and the storage-start check both write the storage start. */
export const SHARED_STORAGE_START = "shared-storage-start";
/** Storage details and the storage-end checks both write the chargeable storage end. */
export const SHARED_STORAGE_END = "shared-storage-end";
/** The Recovery screen and the storage-start check both write the recovery date. */
export const SHARED_RECOVERY_AT = "shared-recovery-at";
/** The hire-end check and the total-loss off-hire check both write the hire end. */
export const SHARED_HIRE_END = "shared-hire-end";

export const CIRCUMSTANCE_FIELDS = ["circumstances", "accident_location"] as const;
export const OWN_INSURER_FIELDS = [
  "own_insurer_name",
  "own_policy_ref",
  "own_claim_ref",
  "own_insurer_address",
  "own_insurer_postcode",
] as const;

const CIRCUMSTANCE_LABELS: Record<string, string> = {
  circumstances: "Circumstances",
  accident_location: "Location",
  details: "Details",
  location: "Location",
};

const OWN_INSURER_LABELS: Record<string, string> = {
  own_insurer_name: "Own insurer",
  own_policy_ref: "Policy number",
  own_claim_ref: "Claim reference",
  own_insurer_address: "Insurer address",
  own_insurer_postcode: "Insurer postcode",
  companyName: "Company name",
  policyNumber: "Policy number",
  claimReference: "Claim reference",
  address: "Address",
  postcode: "Postcode",
};

type VersionRow = { updated_at: string; updated_by: string; fields_json: string };

function readVersion(scope: string, recordKey: string): VersionRow | undefined {
  return get<VersionRow>(
    `SELECT updated_at, updated_by, fields_json FROM record_versions WHERE scope = ? AND record_key = ?`,
    [scope, recordKey],
  );
}

function textRow(sql: string, params: unknown[]): Record<string, string> {
  const row = get<Record<string, string | number | null>>(sql, params);
  const out: Record<string, string> = {};
  if (!row) return out;
  for (const [key, value] of Object.entries(row)) out[key] = value == null ? "" : String(value);
  return out;
}

export function claimColumns(claimId: string, columns: readonly string[]): Record<string, string> {
  const safe = columns.map((column) => column.replace(/[^a-z_]/g, "")).filter(Boolean);
  if (safe.length === 0) return {};
  return textRow(`SELECT ${safe.join(", ")} FROM claims WHERE id = ?`, [claimId]);
}

export function clientPersonColumns(claimId: string): Record<string, string> {
  return textRow(
    `SELECT date_of_birth, licence_number, telephone FROM people
     WHERE id = (SELECT client_person_id FROM claims WHERE id = ?)`,
    [claimId],
  );
}

export function clientGtaGroup(claimId: string): string {
  const row = textRow(
    `SELECT gta_group FROM vehicles WHERE id = (SELECT client_vehicle_id FROM claims WHERE id = ?)`,
    [claimId],
  );
  return row.gta_group || "";
}

export function tpVehicleColumns(claimId: string): Record<string, string> | null {
  const link = get<{ vehicle_id: string | null }>(
    `SELECT vehicle_id FROM claim_third_parties WHERE claim_id = ? AND sequence = 1`,
    [claimId],
  );
  if (!link?.vehicle_id) return null;
  return textRow(`SELECT registration, make, model FROM vehicles WHERE id = ?`, [link.vehicle_id]);
}

export function recoveryAt(claimId: string): string {
  const row = textRow(
    `SELECT recovered_at FROM recovery_jobs WHERE claim_id = ? ORDER BY id LIMIT 1`,
    [claimId],
  );
  return row.recovered_at || "";
}

export function hireEndAt(episodeId: string): string {
  const row = textRow(`SELECT billing_end_at FROM hire_episodes WHERE id = ?`, [episodeId]);
  return row.billing_end_at || "";
}

function differs(current: Record<string, string>, next: Record<string, string>): boolean {
  return Object.keys(next).some((key) => (current[key] || "") !== (next[key] || ""));
}

function asForm(record: Record<string, string>, formName?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[formName?.[key] || key] = value || "";
  return out;
}

/**
 * Staff forms pass expected (including "" when this information had not been saved).
 * A different version does not overwrite. Callers that are not a staff form omit expected;
 * a real change still moves the version so an open form is refused.
 * Call this inside the same transaction as the write.
 */
export function guardSharedFields(input: {
  scope: string;
  recordKey: string;
  expected?: string;
  actorId: string;
  current: Record<string, string>;
  next: Record<string, string>;
  labels: Record<string, string>;
  formName?: Record<string, string>;
  submitted?: Record<string, string>;
  loaded?: Record<string, string>;
}): void {
  const row = readVersion(input.scope, input.recordKey);
  const actual = row?.updated_at || "";
  const formCurrent = asForm(input.current, input.formName);
  const formNext = asForm(input.next, input.formName);
  const formLoaded: Record<string, string> = {};
  if (input.loaded) {
    for (const key of Object.keys(input.next)) {
      const name = input.formName?.[key] || key;
      if (Object.prototype.hasOwnProperty.call(input.loaded, name)) formLoaded[name] = input.loaded[name] || "";
      else if (Object.prototype.hasOwnProperty.call(input.loaded, key)) formLoaded[name] = input.loaded[key] || "";
    }
  }
  const labels = input.labels;
  if (input.expected !== undefined && actual !== input.expected) {
    const name = row ? actorName(row.updated_by) : "Someone";
    const when = row?.updated_at || actual;
    const submitted = input.submitted || formNext;
    throw new VersionConflictError(
      name,
      when || new Date().toISOString(),
      changedFieldList({
        loaded: input.loaded ? formLoaded : undefined,
        current: formCurrent,
        submitted: formNext,
        labels,
      }),
      submitted,
      input.expected,
      input.scope,
      input.recordKey,
      unsavedEntries({
        loaded: input.loaded,
        submitted,
        labels,
      }),
      row ? conflictSentence(name, when) : "This save did not match the version on the file. Your changes have not been saved.",
    );
  }
  if (!differs(input.current, input.next)) return;
  claimSectionForSave({
    scope: input.scope,
    recordKey: input.recordKey,
    expected: actual,
    actorId: input.actorId,
    submitted: formNext,
    labels,
    fields: input.next,
  });
}

export function circumstanceLabels(formName?: Record<string, string>): Record<string, string> {
  const labels = { ...CIRCUMSTANCE_LABELS };
  if (formName?.circumstances) labels[formName.circumstances] = formName.circumstances === "details" ? "Details" : "Circumstances";
  return labels;
}

export function ownInsurerLabels(): Record<string, string> {
  return OWN_INSURER_LABELS;
}

export const ACCIDENT_FORM_NAMES: Record<string, string> = {
  circumstances: "details",
  accident_location: "location",
};

export const INSURER_FORM_NAMES: Record<string, string> = {
  own_insurer_name: "companyName",
  own_policy_ref: "policyNumber",
  own_claim_ref: "claimReference",
  own_insurer_address: "address",
  own_insurer_postcode: "postcode",
};

export const CLIENT_PERSON_FORM_NAMES: Record<string, string> = {
  date_of_birth: "dob",
  licence_number: "licenceNumber",
  telephone: "telMain",
};

export const HIRE_PACK_PERSON_FORM_NAMES: Record<string, string> = {
  date_of_birth: "date_of_birth",
  licence_number: "licence_number",
  telephone: "mobile_tel",
};

export const TP_FORM_NAMES: Record<string, string> = {
  registration: "registration",
  make: "make",
  model: "model",
};

export const VEHICLE_TP_FORM_NAMES: Record<string, string> = {
  registration: "tpReg",
  make: "tpMake",
  model: "tpModel",
};

export function sharedVersionFields(claimId: string, screenKey: string): Record<string, string> {
  if (screenKey === "accident") return { circumstancesVersion: sectionVersion(SHARED_CIRCUMSTANCES, claimId) };
  if (screenKey === "insurer") return { ownInsurerVersion: sectionVersion(SHARED_OWN_INSURER, claimId) };
  if (screenKey === "client") return { clientPersonVersion: sectionVersion(SHARED_CLIENT_PERSON, claimId) };
  if (screenKey === "vehicle") {
    return {
      clientGtaVersion: sectionVersion(SHARED_CLIENT_GTA, claimId),
      tpVehicleVersion: sectionVersion(SHARED_TP_VEHICLE, claimId),
    };
  }
  if (screenKey === "tp1") return { tpVehicleVersion: sectionVersion(SHARED_TP_VEHICLE, claimId) };
  if (screenKey === "storage") {
    return {
      storageStartVersion: sectionVersion(SHARED_STORAGE_START, claimId),
      storageEndVersion: sectionVersion(SHARED_STORAGE_END, claimId),
    };
  }
  if (screenKey === "recovery") return { recoveryAtVersion: sectionVersion(SHARED_RECOVERY_AT, claimId) };
  return {};
}

import { jurisdictionLabel, normaliseJurisdiction } from "../domain/jurisdiction";
import { LICENCE_BOXES, licenceFormatError, licenceOrigin } from "../domain/licence-number";
import { recordClaimEvent } from "./chronology";
import { accidentDateError, nowUtcIso, londonDateIso, occurredFromForm, utcFromLondonDateTime } from "../dates";
import { closeRepairStepsForTotalLoss } from "./total-loss-switch";
import { recordRecoveryCompletedOnce, recordStorageEndedOnce } from "./claim-step-record";
import { FieldValidationError } from "../form-validation";
import { CLAIM_SCREENS, getClaimScreen } from "../claim-screens";
import { dobConfirmName, dobKindForField, dobSaveError, isDobFieldName } from "../age";
import { isPhoneBoxName, phoneFieldError } from "../phone-number";
import { formatTypedValue } from "../text";
import { get, all, getDb, newId, run } from "./connection";
import { withImmediateTransaction, writeScreenIfCurrent } from "./record-version";
import {
  ACCIDENT_FORM_NAMES,
  CIRCUMSTANCE_FIELDS,
  CLIENT_PERSON_FORM_NAMES,
  INSURER_FORM_NAMES,
  OWN_INSURER_FIELDS,
  SHARED_CIRCUMSTANCES,
  SHARED_CLIENT_GTA,
  SHARED_CLIENT_PERSON,
  SHARED_OWN_INSURER,
  SHARED_RECOVERY_AT,
  SHARED_STORAGE_END,
  SHARED_STORAGE_START,
  SHARED_TP_VEHICLE,
  TP_FORM_NAMES,
  VEHICLE_TP_FORM_NAMES,
  claimColumns,
  clientGtaGroup,
  clientPersonColumns,
  guardSharedFields,
  ownInsurerLabels,
  recoveryAt,
  tpVehicleColumns,
} from "./shared-fields";
import { normaliseGtaGroup } from "../documents/gta";
import { poundsToPence } from "./intake";
import { INDICATIVE_DEFAULTS } from "../constants";
import { normaliseRecoveryScreen, somethingElseSaveError } from "../domain/recovery-charges";
import { rememberAgentOn, rememberInsurerOn } from "./insurers";
import { displayValue } from "../screen-display";
import { updateClaimAudatexCodes, updateClaimWorkflowStatus, suggestAudatexCodesForClaim } from "./queries";
import { getStorageDateReview, getStorageEndDateReview } from "./storage-recovery-date";
import { flagStorageEndOnTotalLoss, recordManualStorageEndReason, storageEndManualMessage } from "./storage-authorisation-end";
import { normalizeLiabilityStatus, normalizeRoadworthiness } from "../domain/claim-status";

export type ScreenValues = Record<string, string>;
export { displayValue };

export function getScreenData(claimId: string, screenKey: string): ScreenValues {
  const row = get<{ data_json: string }>(
    `SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`,
    [claimId, screenKey],
  );
  if (!row?.data_json) return {};
  try {
    const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
    const out: ScreenValues = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined) out[k] = "";
      else if (typeof v === "boolean") out[k] = v ? "yes" : "";
      else out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function listScreenSummaries(claimId: string) {
  return all<{ screen_key: string; updated_at: string }>(
    `SELECT screen_key, updated_at FROM claim_screen_data WHERE claim_id = ?`,
    [claimId],
  );
}

export function valuesFromForm(formData: FormData, screenKey: string): ScreenValues {
  const def = getClaimScreen(screenKey);
  const values: ScreenValues = {};
  if (!def) return values;
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (field.type === "checkbox") {
        values[field.name] = formData.get(field.name) ? "yes" : "";
      } else if (field.type === "gbp") {
        const raw = String(formData.get(field.name) || "").trim();
        values[field.name] = raw === "" ? "" : String(poundsToPence(raw));
      } else {
        values[field.name] = formatTypedValue(field.name, String(formData.get(field.name) || ""), field.type);
      }
      if (isDobFieldName(field.name)) {
        values[dobConfirmName(field.name)] = formData.get(dobConfirmName(field.name)) ? "yes" : "";
      }
    }
  }
  for (const key of ["clientPanels", "tpPanels", "crossHire", "crossHireNotes"]) {
    if (formData.has(key)) values[key] = String(formData.get(key) || "");
  }
  for (const [key, value] of formData.entries()) {
    if (String(key).startsWith("saveAnyway_")) values[String(key)] = String(value);
  }
  if (screenKey === "recovery") return normaliseRecoveryScreen(values);
  return values;
}

export function screenSaveFieldError(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
): { field: string; message: string } | null {
  return screenSaveFieldErrors(claimId, screenKey, values)[0] ?? null;
}

/** R56: every problem on the screen at once. */
export function screenSaveFieldErrors(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
): Array<{ field: string; message: string }> {
  const single = screenSaveSingleError(claimId, screenKey, values);
  if (single) return [single];
  const def = getClaimScreen(screenKey);
  if (!def) return [];
  const problems: Array<{ field: string; message: string }> = [];
  // R62: a licence number is checked against its format when it is entered.
  for (const box of LICENCE_BOXES.filter((item) => item.screen === screenKey)) {
    const err = licenceFormatError(values[box.number], licenceOrigin(values[box.notGb], values[box.country]), values[box.country]);
    if (err) problems.push({ field: box.number, message: err });
  }
  const claim = get<{ client_role: string | null }>(`SELECT client_role FROM claims WHERE id = ?`, [claimId]);
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (isPhoneBoxName(field.name)) {
        const kept = values[`saveAnyway_${field.name}`] === "yes";
        const phoneErr = kept ? null : phoneFieldError(field.name, values[field.name]);
        if (phoneErr) problems.push({ field: field.name, message: phoneErr });
      }
      if (!isDobFieldName(field.name)) continue;
      const err = dobSaveError(
        values[field.name],
        dobKindForField(screenKey, field.name, claim?.client_role || undefined),
        values[dobConfirmName(field.name)] === "yes",
      );
      if (err) problems.push({ field: field.name, message: err });
    }
  }
  return problems;
}

/** The screen-specific checks, each about one box. */
function screenSaveSingleError(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
): { field: string; message: string } | null {
  if (screenKey === "recovery") {
    const extra = somethingElseSaveError(values);
    if (extra) return extra;
  }
  if (screenKey === "storage") {
    if ((values.endDate || "").trim() && !(values.startDate || "").trim()) {
      return { field: "startDate", message: "Start date missing. A storage end cannot be proposed or confirmed." };
    }
    const storageEnd = storageEndManualMessage(claimId, values.endDate || "", values.endDateReason || "");
    if (storageEnd) return { field: "endDateReason", message: storageEnd };
    if (Object.prototype.hasOwnProperty.call(values, "dailyRate")) {
      const claim = get<{ storage_rate_pence: number | null }>(
        `SELECT storage_rate_pence FROM claims WHERE id = ?`,
        [claimId],
      );
      const next = values.dailyRate ? Number.parseInt(values.dailyRate, 10) || null : null;
      const current = claim?.storage_rate_pence ?? null;
      if (next !== current && !(values.rateReason || "").trim()) {
        return { field: "rateReason", message: "Record a reason before changing the daily rate on this file." };
      }
    }
  }
  if (screenKey === "accident") {
    const accident = accidentDateError(values.accidentDate);
    if (accident) return { field: "accidentDate", message: accident };
  }
  return null;
}

export function screenSaveError(claimId: string, screenKey: string, values: ScreenValues): string | null {
  return screenSaveFieldError(claimId, screenKey, values)?.message ?? null;
}

function screenLabels(screenKey: string): Record<string, string> {
  const def = getClaimScreen(screenKey);
  const labels: Record<string, string> = {};
  if (!def) return labels;
  for (const section of def.sections) {
    for (const field of section.fields) labels[field.name] = field.label;
  }
  return labels;
}

/**
 * Staff saves pass expectedVersion (the updated_at loaded with the page, or "" if the screen had not been saved).
 * A missing or different version does not overwrite. Callers that are not a staff form omit it.
 */
function guardScreenOverlap(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
  actorId: string,
  shared: Record<string, string | undefined> | undefined,
  loaded?: ScreenValues,
) {
  const token = (name: string) => (shared && Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined);
  if (screenKey === "accident") {
    const current = claimColumns(claimId, CIRCUMSTANCE_FIELDS);
    guardSharedFields({
      scope: SHARED_CIRCUMSTANCES,
      recordKey: claimId,
      expected: token("circumstancesVersion"),
      actorId,
      current,
      next: {
        circumstances: values.details ? values.details : current.circumstances || "",
        accident_location: values.location ? values.location : current.accident_location || "",
      },
      labels: { circumstances: "Circumstances", accident_location: "Location", details: "Details", location: "Location" },
      formName: ACCIDENT_FORM_NAMES,
      submitted: values,
      loaded,
    });
  }
  if (screenKey === "insurer") {
    guardSharedFields({
      scope: SHARED_OWN_INSURER,
      recordKey: claimId,
      expected: token("ownInsurerVersion"),
      actorId,
      current: claimColumns(claimId, OWN_INSURER_FIELDS),
      next: {
        own_insurer_name: values.companyName || "",
        own_policy_ref: values.policyNumber || "",
        own_claim_ref: values.claimReference || "",
        own_insurer_address: values.address || "",
        own_insurer_postcode: values.postcode || "",
      },
      labels: ownInsurerLabels(),
      formName: INSURER_FORM_NAMES,
      submitted: values,
      loaded,
    });
  }
  if (screenKey === "client") {
    guardSharedFields({
      scope: SHARED_CLIENT_PERSON,
      recordKey: claimId,
      expected: token("clientPersonVersion"),
      actorId,
      current: clientPersonColumns(claimId),
      next: {
        date_of_birth: values.dob || "",
        licence_number: values.licenceNumber || "",
        telephone: values.telMain || values.telMobile || "",
      },
      labels: { date_of_birth: "Date of birth", licence_number: "Licence number", telephone: "Telephone", dob: "Date of birth", licenceNumber: "Licence number", telMain: "Telephone" },
      formName: CLIENT_PERSON_FORM_NAMES,
      submitted: values,
      loaded,
    });
  }
  if (screenKey === "vehicle") {
    guardSharedFields({
      scope: SHARED_CLIENT_GTA,
      recordKey: claimId,
      expected: token("clientGtaVersion"),
      actorId,
      current: { gta_group: clientGtaGroup(claimId) },
      next: { gta_group: values.clientGtaGroup ? normaliseGtaGroup(values.clientGtaGroup) || "" : "" },
      labels: { gta_group: "GTA group", clientGtaGroup: "GTA group" },
      formName: { gta_group: "clientGtaGroup" },
      submitted: values,
      loaded,
    });
    const tp = tpVehicleColumns(claimId);
    if (tp) {
      guardSharedFields({
        scope: SHARED_TP_VEHICLE,
        recordKey: claimId,
        expected: token("tpVehicleVersion"),
        actorId,
        current: tp,
        next: {
          registration: values.tpReg ? values.tpReg : tp.registration || "",
          make: values.tpMake ? values.tpMake : tp.make || "",
          model: values.tpModel ? values.tpModel : tp.model || "",
        },
        labels: { registration: "Registration", make: "Make", model: "Model", tpReg: "Registration", tpMake: "Make", tpModel: "Model" },
        formName: VEHICLE_TP_FORM_NAMES,
        submitted: values,
        loaded,
      });
    }
  }
  if (screenKey === "tp1") {
    const tp = tpVehicleColumns(claimId);
    if (tp) {
      guardSharedFields({
        scope: SHARED_TP_VEHICLE,
        recordKey: claimId,
        expected: token("tpVehicleVersion"),
        actorId,
        current: tp,
        next: {
          registration: values.registration ? values.registration : tp.registration || "",
          make: values.make ? values.make : tp.make || "",
          model: values.model ? values.model : tp.model || "",
        },
        labels: { registration: "Registration", make: "Make", model: "Model" },
        formName: TP_FORM_NAMES,
        submitted: values,
        loaded,
      });
    }
  }
  if (screenKey === "storage") {
    const current = claimColumns(claimId, ["storage_started_on", "storage_billing_end_on"]);
    guardSharedFields({
      scope: SHARED_STORAGE_START,
      recordKey: claimId,
      expected: token("storageStartVersion"),
      actorId,
      current: { storage_started_on: current.storage_started_on || "" },
      next: { storage_started_on: values.startDate || "" },
      labels: { storage_started_on: "Storage start", startDate: "Start date" },
      formName: { storage_started_on: "startDate" },
      submitted: values,
      loaded,
    });
    if (Object.prototype.hasOwnProperty.call(values, "endDate")) {
      guardSharedFields({
        scope: SHARED_STORAGE_END,
        recordKey: claimId,
        expected: token("storageEndVersion"),
        actorId,
        current: { storage_billing_end_on: current.storage_billing_end_on || "" },
        next: { storage_billing_end_on: values.endDate || "" },
        labels: { storage_billing_end_on: "Storage end", endDate: "Chargeable end date" },
        formName: { storage_billing_end_on: "endDate" },
        submitted: values,
        loaded,
      });
    }
  }
  if (screenKey === "recovery") {
    const current = recoveryAt(claimId);
    guardSharedFields({
      scope: SHARED_RECOVERY_AT,
      recordKey: claimId,
      expected: token("recoveryAtVersion"),
      actorId,
      current: { recovered_at: current },
      next: { recovered_at: values.recoveryDate ? values.recoveryDate : current },
      labels: { recovered_at: "Recovered", recoveryDate: "Recovery date" },
      formName: { recovered_at: "recoveryDate" },
      submitted: values,
      loaded,
    });
  }
}

/**
 * Staff saves pass expectedVersion (the updated_at loaded with the page, or "" if the screen had not been saved).
 * A missing or different version does not overwrite. Callers that are not a staff form omit it.
 */
export function saveScreenData(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
  actorId: string,
  expectedVersion?: string,
  loaded?: ScreenValues,
  shared?: Record<string, string | undefined>,
) {
  const stored = screenKey === "recovery" ? normaliseRecoveryScreen(values) : values;
  const blocked = screenSaveFieldErrors(claimId, screenKey, stored);
  if (blocked.length) throw new FieldValidationError(blocked[0]!.field, blocked[0]!.message, blocked);
  const guard = () => guardScreenOverlap(claimId, screenKey, stored, actorId, shared, loaded);
  if (expectedVersion === undefined) {
    guard();
    const now = nowUtcIso();
    run(
      `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(claim_id, screen_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [claimId, screenKey, JSON.stringify(stored), now, actorId],
    );
    applySideEffects(claimId, screenKey, stored, actorId);
    run(`UPDATE claims SET updated_at = ? WHERE id = ?`, [now, claimId]);
    return;
  }
  withImmediateTransaction(() => {
    guard();
    const written = writeScreenIfCurrent({
      claimId,
      screenKey,
      expected: expectedVersion,
      actorId,
      stored,
      loaded,
      labels: screenLabels(screenKey),
    });
    applySideEffects(claimId, screenKey, stored, actorId);
    run(`UPDATE claims SET updated_at = ? WHERE id = ?`, [written.now, claimId]);
  });
}

function applySideEffects(claimId: string, screenKey: string, values: ScreenValues, actorId: string) {
  const now = nowUtcIso();
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("saveAnyway_") || value !== "yes") continue;
    run(
      `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'phone_saved_anyway', 'claim', ?, ?)`,
      [newId("audit"), now, actorId, claimId, `Phone saved anyway: ${key.slice("saveAnyway_".length)}`],
    );
  }
  const claim = get<{
    id: string;
    client_person_id: string | null;
    client_vehicle_id: string | null;
  }>(`SELECT id, client_person_id, client_vehicle_id FROM claims WHERE id = ?`, [claimId]);
  if (!claim) return;

  if (screenKey === "general") {
    updateClaimWorkflowStatus(
      claimId,
      {
        liabilityStatus: values.typeOfClaim,
        roadworthiness: values.roadworthiness,
      },
      actorId,
    );
    if (values.jurisdiction !== undefined && values.jurisdiction !== "") {
      const next = normaliseJurisdiction(values.jurisdiction);
      const before = get<{ jurisdiction: string | null }>(`SELECT jurisdiction FROM claims WHERE id = ?`, [claimId]);
      if (normaliseJurisdiction(before?.jurisdiction) !== next) {
        run(`UPDATE claims SET jurisdiction = ? WHERE id = ?`, [next, claimId]);
        recordClaimEvent({
          claimId,
          eventType: "other",
          occurredAt: nowUtcIso(),
          actorId,
          details: `Jurisdiction set to ${jurisdictionLabel(next)} (was ${jurisdictionLabel(before?.jurisdiction)}).`,
          source: "staff",
        });
      }
    }
  }

  if (screenKey === "client" && claim.client_person_id) {
    const fullName = [values.title, values.forename, values.surname].filter(Boolean).join(" ") || "Unknown";
    run(
      `UPDATE people SET title = ?, forename = ?, surname = ?, full_name = ?, address_line1 = ?, postcode = ?,
        telephone = ?, mobile_tel = ?, home_tel = ?, email = ?, date_of_birth = ?, licence_number = ?,
        licence_issued_on = ?, licence_expires_on = ?
       WHERE id = ?`,
      [
        values.title || null,
        values.forename || null,
        values.surname || null,
        fullName,
        values.address || null,
        values.postcode || null,
        values.telMain || values.telMobile || null,
        values.telMobile || null,
        values.telHome || null,
        values.email || null,
        values.dob || null,
        values.licenceNumber || null,
        values.licenceIssuedOn || null,
        values.licenceExpiry || null,
        claim.client_person_id,
      ],
    );
  }

  if (screenKey === "vehicle" && claim.client_vehicle_id) {
    run(
      `UPDATE vehicles SET make = ?, model = ?, registration = ?, colour = ?, gta_group = ? WHERE id = ?`,
      [
        values.clientMake || "Unknown",
        values.clientModel || "Unknown",
        values.clientReg || "Unknown",
        values.clientColour || "Unknown",
        values.clientGtaGroup ? normaliseGtaGroup(values.clientGtaGroup) : null,
        claim.client_vehicle_id,
      ],
    );
    const tp = get<{ vehicle_id: string | null }>(
      `SELECT vehicle_id FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence LIMIT 1`,
      [claimId],
    );
    if (tp?.vehicle_id && (values.tpMake || values.tpModel || values.tpReg || values.tpColour)) {
      run(`UPDATE vehicles SET make = COALESCE(NULLIF(?, ''), make), model = COALESCE(NULLIF(?, ''), model),
            registration = COALESCE(NULLIF(?, ''), registration), colour = COALESCE(NULLIF(?, ''), colour) WHERE id = ?`, [
        values.tpMake,
        values.tpModel,
        values.tpReg,
        values.tpColour,
        tp.vehicle_id,
      ]);
    }
  }

  if (screenKey === "accident") {
    const accidentAt = values.accidentDate
      ? occurredFromForm(`${values.accidentDate}T${values.accidentTime || "00:00"}`)
      : null;
    run(
      `UPDATE claims SET accident_at = COALESCE(?, accident_at), accident_location = COALESCE(NULLIF(?, ''), accident_location),
        circumstances = COALESCE(NULLIF(?, ''), circumstances), weather_conditions = ?, journey_purpose = ?,
        client_speed = ?, tp_speed = ?, photos_at_scene = ?
       WHERE id = ?`,
      [
        accidentAt,
        values.location || "",
        values.details || "",
        values.weather || null,
        values.purpose || null,
        values.clientSpeed || null,
        values.tpSpeed || null,
        values.photosAtScene || null,
        claimId,
      ],
    );
  }

  if (screenKey === "insurer") {
    run(
      `UPDATE claims SET own_insurer_name = ?, own_policy_ref = ?, own_claim_ref = ?,
        own_insurer_address = ?, own_insurer_postcode = ?
       WHERE id = ?`,
      [
        values.companyName || null,
        values.policyNumber || null,
        values.claimReference || null,
        values.address || null,
        values.postcode || null,
        claimId,
      ],
    );
    if (actorId) {
      updateClaimAudatexCodes(
        claimId,
        {
          audatexNetworkCode: values.audatexNetworkCode,
          audatexWorkProviderCode: values.audatexWorkProviderCode,
        },
        actorId,
      );
    }
  }

  if (screenKey === "storage") {
    const beforeEnd = get<{ storage_billing_end_on: string | null; storage_rate_pence: number | null }>(
      `SELECT storage_billing_end_on, storage_rate_pence FROM claims WHERE id = ?`,
      [claimId],
    );
    const hasDaily = Object.prototype.hasOwnProperty.call(values, "dailyRate");
    const nextRate = hasDaily ? (values.dailyRate ? Number.parseInt(values.dailyRate, 10) || null : null) : null;
    const rateChanges = hasDaily && nextRate !== (beforeEnd?.storage_rate_pence ?? null);
    const hasEnd = Object.prototype.hasOwnProperty.call(values, "endDate");
    run(
      `UPDATE claims SET storage_started_on = ?,
        storage_billing_end_on = CASE WHEN ? = 1 THEN ? ELSE storage_billing_end_on END,
        storage_rate_pence = CASE WHEN ? = 1 THEN ? ELSE storage_rate_pence END,
        storage_status = CASE WHEN ? != '' THEN 'active' ELSE storage_status END
       WHERE id = ?`,
      [
        values.startDate || null,
        hasEnd ? 1 : 0,
        values.endDate || null,
        rateChanges ? 1 : 0,
        nextRate,
        values.startDate || "",
        claimId,
      ],
    );
    const reason = (values.endDateReason || "").trim();
    if (reason && (values.endDate || "") !== (beforeEnd?.storage_billing_end_on || "")) {
      recordManualStorageEndReason({
        claimId,
        actorId,
        typedEnd: values.endDate || "",
        reason,
      });
    }
    if (hasEnd && values.endDate && values.endDate !== (beforeEnd?.storage_billing_end_on || "")) {
      recordStorageEndedOnce({
        claimId,
        actorId,
        occurredAt: utcFromLondonDateTime(`${values.endDate}T09:00`),
        details: `Storage ended on ${values.endDate.split("-").reverse().join("/")}. Recorded when the storage screen was saved.`,
      });
    }
    getStorageDateReview(claimId);
    getStorageEndDateReview(claimId);
  }

  if (screenKey === "recovery") {
    const existing = get<{ id: string }>(`SELECT id FROM recovery_jobs WHERE claim_id = ? LIMIT 1`, [claimId]);
    if (existing) {
      const charged = (tick: string, fee: string) => (values[tick] === "yes" ? Number.parseInt(values[fee] || "0", 10) || 0 : 0);
      run(
        `UPDATE recovery_jobs SET location = COALESCE(NULLIF(?, ''), location), recovered_at = COALESCE(NULLIF(?, ''), recovered_at),
          charge_pence = ?, ooh_pence = ?, environmental_pence = ?, winch_pence = ?,
          inherited_note = COALESCE(NULLIF(?, ''), inherited_note)
         WHERE id = ?`,
        [
          values.location || "",
          values.recoveryDate || "",
          Number.parseInt(values.standardCharge || "0", 10) || 0,
          charged("outOfHours", "outOfHoursFee"),
          charged("environment", "environmentFee"),
          charged("winch", "winchFee"),
          values.reasonForFee || "",
          existing.id,
        ],
      );
      getStorageDateReview(claimId);
      if (values.recoveryDate) {
        recordRecoveryCompletedOnce({
          claimId,
          actorId,
          occurredAt: utcFromLondonDateTime(`${values.recoveryDate}T09:00`),
          details: `Recovery recorded on ${values.recoveryDate.split("-").reverse().join("/")}. Recorded when the recovery screen was saved.`,
        });
        run(`UPDATE claims SET recovery_status = 'complete' WHERE id = ? AND (recovery_status IS NULL OR recovery_status = '' OR recovery_status = 'none' OR recovery_status = 'required')`, [
          claimId,
        ]);
      }
    }
  }

  if (screenKey === "tp1") updateThirdParty(claimId, 1, values);
  if (screenKey === "tp2") updateThirdParty(claimId, 2, values);

  if (screenKey === "assessed-damage" && values.totalLoss === "yes") {
    const before = get<{ total_loss: number | null }>(`SELECT total_loss FROM claims WHERE id = ?`, [claimId]);
    run(`UPDATE claims SET total_loss = 1 WHERE id = ?`, [claimId]);
    if (Number(before?.total_loss) !== 1) {
      flagStorageEndOnTotalLoss(claimId, actorId);
      closeRepairStepsForTotalLoss(claimId, actorId);
    }
  }
}

function updateThirdParty(claimId: string, sequence: number, values: ScreenValues) {
  let tp = get<{ id: string; person_id: string; vehicle_id: string | null }>(
    `SELECT id, person_id, vehicle_id FROM claim_third_parties WHERE claim_id = ? AND sequence = ?`,
    [claimId, sequence],
  );
  if (!tp) {
    const insurerEmail = (values.insurerEmail || "").trim();
    const named = [values.title, values.forename, values.surname, values.insurerName].some((part) => (part || "").trim());
    if (!insurerEmail && !named) return;
    const personId = newId("person");
    const fullName = [values.title, values.forename, values.surname].filter((part) => (part || "").trim()).join(" ") || "Unknown";
    const now = nowUtcIso();
    run(
      `INSERT INTO people(id, kind, full_name, title, forename, surname, address_line1, postcode, telephone, email, created_at)
       VALUES (?, 'individual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        personId,
        fullName,
        values.title || null,
        values.forename || null,
        values.surname || null,
        values.address || null,
        values.postcode || null,
        values.telMain || null,
        values.email || null,
        now,
      ],
    );
    const tpId = newId("tp");
    run(
      `INSERT INTO claim_third_parties(id, claim_id, person_id, sequence, insurer_email)
       VALUES (?, ?, ?, ?, ?)`,
      [tpId, claimId, personId, sequence, insurerEmail || null],
    );
    tp = { id: tpId, person_id: personId, vehicle_id: null };
  }
  const fullName = [values.title, values.forename, values.surname].filter(Boolean).join(" ");
  if (fullName) {
    run(
      `UPDATE people SET title = ?, forename = ?, surname = ?, full_name = ?, address_line1 = ?, postcode = ?,
        telephone = ?, email = ? WHERE id = ?`,
      [
        values.title || null,
        values.forename || null,
        values.surname || null,
        fullName,
        values.address || null,
        values.postcode || null,
        values.telMain || null,
        values.email || null,
        tp.person_id,
      ],
    );
  }
  run(
    `UPDATE claim_third_parties SET insurer_name = ?, insurer_address = ?, insurer_postcode = ?, insurer_tel = ?,
      insurer_email = ?, insurer_ref = ?, policy_number = ?, liability_admitted = ?, agent_name = ?,
      agent_address = ?, agent_postcode = ?, agent_tel = ?, agent_email = ?, agent_ref = ?,
      agent_handler_name = ?, agent_handler_email = ?, agent_handler_tel = ?
     WHERE id = ?`,
    [
      values.insurerName || null,
      values.insurerAddress || null,
      values.insurerPostcode || null,
      values.insurerTel || null,
      values.insurerEmail || null,
      values.insurerReference || null,
      values.policyNumber || null,
      values.liabilityDeclared || null,
      values.agentName || null,
      values.agentAddress || null,
      values.agentPostcode || null,
      values.agentTel || null,
      values.agentEmail || null,
      values.agentReference || null,
      values.agentHandlerName || null,
      values.agentHandlerEmail || null,
      values.agentHandlerTel || null,
      tp.id,
    ],
  );
  rememberInsurerOn(getDb(), {
    name: values.insurerName || "",
    address: values.insurerAddress || "",
    postcode: values.insurerPostcode || "",
    telephone: values.insurerTel || "",
    email: values.insurerEmail || "",
  });
  rememberAgentOn(getDb(), {
    name: values.agentName || "",
    address: values.agentAddress || "",
    postcode: values.agentPostcode || "",
    telephone: values.agentTel || "",
    email: values.agentEmail || "",
    handlerName: values.agentHandlerName || "",
    handlerEmail: values.agentHandlerEmail || "",
    handlerTel: values.agentHandlerTel || "",
  });
  if (tp.vehicle_id) {
    run(
      `UPDATE vehicles SET registration = COALESCE(NULLIF(?, ''), registration), make = COALESCE(NULLIF(?, ''), make),
        model = COALESCE(NULLIF(?, ''), model) WHERE id = ?`,
      [values.registration || "", values.make || "", values.model || "", tp.vehicle_id],
    );
  }
}

export function seedScreenDefaults(claimId: string, screenKey: string): ScreenValues {
  const saved = getScreenData(claimId, screenKey);
  const claim = get<Record<string, string | number | null>>(
    `SELECT c.*, p.title, p.forename, p.surname, p.full_name, p.address_line1, p.town, p.postcode, p.telephone,
            p.email, p.date_of_birth, p.licence_number, p.mobile_tel, p.home_tel, p.licence_issued_on, p.licence_expires_on,
            v.registration, v.make, v.model, v.colour, v.transmission, v.fuel, v.gta_group
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  if (!claim) return saved;
  const defaults: ScreenValues = { ...saved };
  const fill = (key: string, value: string | number | null | undefined) => {
    if (defaults[key]) return;
    if (value === null || value === undefined || value === "") return;
    // Older files stored "Unknown" for a blank address. The box is left empty so it reads "Address needed".
    if ((key === "address" || key === "postcode") && String(value).trim().toLowerCase() === "unknown") return;
    defaults[key] = String(value);
  };

  if (screenKey === "general") {
    fill("caseStatus", claim.current_position);
    defaults.typeOfClaim = normalizeLiabilityStatus(defaults.typeOfClaim || String(claim.claim_type || ""));
    defaults.roadworthiness = normalizeRoadworthiness(defaults.roadworthiness || String(claim.roadworthiness || ""));
    defaults.jurisdiction = normaliseJurisdiction(String(claim.jurisdiction || defaults.jurisdiction || ""));
  }
  if (screenKey === "client") {
    fill("title", claim.title);
    fill("forename", claim.forename);
    fill("surname", claim.surname);
    if (!defaults.forename && !defaults.surname && claim.full_name) {
      const bits = String(claim.full_name).trim().split(/\s+/);
      const titles = new Set(["Mr", "Mrs", "Miss", "Ms", "Master"]);
      if (bits[0] && titles.has(bits[0]) && !defaults.title) defaults.title = bits[0];
      const names = titles.has(bits[0] || "") ? bits.slice(1) : bits;
      if (names.length === 1) fill("forename", names[0]);
      else if (names.length > 1) {
        fill("forename", names.slice(0, -1).join(" "));
        fill("surname", names[names.length - 1]);
      }
    }
    fill("address", [claim.address_line1, claim.town].filter((part) => part && String(part).trim().toLowerCase() !== "unknown").join("\n"));
    fill("postcode", claim.postcode);
    fill("telMain", claim.telephone);
    fill("telMobile", claim.mobile_tel);
    fill("telHome", claim.home_tel);
    fill("email", claim.email);
    fill("dob", claim.date_of_birth);
    fill("licenceNumber", claim.licence_number);
    fill("licenceIssuedOn", claim.licence_issued_on);
    fill("licenceExpiry", claim.licence_expires_on);
    defaults.dob = claim.date_of_birth == null ? "" : String(claim.date_of_birth);
    defaults.licenceNumber = claim.licence_number == null ? "" : String(claim.licence_number);
    defaults.telMain = claim.telephone == null ? "" : String(claim.telephone);
  }
  if (screenKey === "owner") {
    fill("companyName", claim.full_name);
    fill("address", [claim.address_line1, claim.town].filter((part) => part && String(part).trim().toLowerCase() !== "unknown").join("\n"));
    fill("postcode", claim.postcode);
    fill("telMain", claim.telephone);
    fill("email", claim.email);
  }
  if (screenKey === "vehicle") {
    fill("clientReg", claim.registration);
    fill("clientMake", claim.make);
    fill("clientModel", claim.model);
    fill("clientColour", claim.colour);
    fill("clientGtaGroup", claim.gta_group);
    const tp = all<Record<string, string | number | null>>(
      `SELECT v.registration, v.make, v.model, v.colour
       FROM claim_third_parties tp LEFT JOIN vehicles v ON v.id = tp.vehicle_id
       WHERE tp.claim_id = ? ORDER BY tp.sequence LIMIT 1`,
      [claimId],
    )[0];
    if (tp) {
      fill("tpReg", tp.registration);
      fill("tpMake", tp.make);
      fill("tpModel", tp.model);
      fill("tpColour", tp.colour);
      defaults.tpReg = tp.registration == null ? "" : String(tp.registration);
      defaults.tpMake = tp.make == null ? "" : String(tp.make);
      defaults.tpModel = tp.model == null ? "" : String(tp.model);
    }
    defaults.clientGtaGroup = claim.gta_group == null ? "" : String(claim.gta_group);
  }
  if (screenKey === "hire-mitigation") {
    fill("clientReg", claim.registration);
    fill("gearbox", claim.transmission);
    fill("fuelType", claim.fuel);
  }
  if (screenKey === "accident") {
    if (claim.accident_at && !defaults.accidentDate) {
      defaults.accidentDate = londonDateIso(new Date(String(claim.accident_at)));
    }
    fill("location", claim.accident_location);
    fill("details", claim.circumstances);
    fill("weather", claim.weather_conditions);
    fill("purpose", claim.journey_purpose);
    fill("clientSpeed", claim.client_speed);
    fill("tpSpeed", claim.tp_speed);
    fill("photosAtScene", claim.photos_at_scene);
    defaults.details = claim.circumstances == null ? "" : String(claim.circumstances);
    defaults.location = claim.accident_location == null ? "" : String(claim.accident_location);
  }
  if (screenKey === "insurer") {
    fill("companyName", claim.own_insurer_name);
    fill("policyNumber", claim.own_policy_ref);
    fill("claimReference", claim.own_claim_ref);
    fill("address", claim.own_insurer_address);
    fill("postcode", claim.own_insurer_postcode);
    defaults.companyName = claim.own_insurer_name == null ? "" : String(claim.own_insurer_name);
    defaults.policyNumber = claim.own_policy_ref == null ? "" : String(claim.own_policy_ref);
    defaults.claimReference = claim.own_claim_ref == null ? "" : String(claim.own_claim_ref);
    defaults.address = claim.own_insurer_address == null ? "" : String(claim.own_insurer_address);
    defaults.postcode = claim.own_insurer_postcode == null ? "" : String(claim.own_insurer_postcode);
    fill("audatexNetworkCode", claim.audatex_network_code);
    fill("audatexWorkProviderCode", claim.audatex_work_provider_code);
    const audatexSuggestion = suggestAudatexCodesForClaim(claimId);
    if (!String(claim.audatex_network_code || "").trim() && audatexSuggestion.network) {
      fill("audatexNetworkCode", audatexSuggestion.network.value);
      fill(
        "audatexNetworkCodeSuggestedFrom",
        `${audatexSuggestion.network.insurerName} · ${audatexSuggestion.network.sourceFileReference}`,
      );
    }
    if (!String(claim.audatex_work_provider_code || "").trim() && audatexSuggestion.workProvider) {
      fill("audatexWorkProviderCode", audatexSuggestion.workProvider.value);
      fill(
        "audatexWorkProviderCodeSuggestedFrom",
        `${audatexSuggestion.workProvider.insurerName} · ${audatexSuggestion.workProvider.sourceFileReference}`,
      );
    }
  }
  if (screenKey === "storage") {
    fill("startDate", claim.storage_started_on);
    fill("endDate", claim.storage_billing_end_on);
    defaults.startDate = claim.storage_started_on == null ? "" : String(claim.storage_started_on);
    defaults.endDate = claim.storage_billing_end_on == null ? "" : String(claim.storage_billing_end_on);
    if (claim.storage_rate_pence != null) fill("dailyRate", String(claim.storage_rate_pence));
  }
  if (screenKey === "recovery") {
    const job = get<Record<string, string | number | null>>(
      `SELECT * FROM recovery_jobs WHERE claim_id = ? LIMIT 1`,
      [claimId],
    );
    if (job) {
      fill("location", job.location);
      const recovered = job.recovered_at ? String(job.recovered_at).slice(0, 10) : "";
      fill("recoveryDate", recovered);
      defaults.recoveryDate = recovered;
      if (!Object.prototype.hasOwnProperty.call(saved, "standardCharge") && Number(job.charge_pence) > 0) {
        defaults.standardCharge = String(job.charge_pence);
      }
      const jobExtras: Array<[string, string, string, number, number]> = [
        ["outOfHours", "outOfHoursFee", "outOfHoursKept", Number(job.ooh_pence), INDICATIVE_DEFAULTS.ooh_net_pence],
        ["environment", "environmentFee", "environmentKept", Number(job.environmental_pence), INDICATIVE_DEFAULTS.environmental_net_pence],
        ["winch", "winchFee", "winchKept", Number(job.winch_pence), INDICATIVE_DEFAULTS.winch_net_pence],
      ];
      for (const [tick, fee, kept, jobPence, defaultPence] of jobExtras) {
        if (Object.prototype.hasOwnProperty.call(saved, tick) || !(jobPence > 0)) continue;
        defaults[tick] = "yes";
        defaults[fee] = String(jobPence);
        if (jobPence !== defaultPence) defaults[kept] = String(jobPence);
      }
      fill("reasonForFee", job.inherited_note);
    }
  }
  if (screenKey === "tp1" || screenKey === "tp2") {
    const sequence = screenKey === "tp1" ? 1 : 2;
    const tp = get<Record<string, string | number | null>>(
      `SELECT tp.*, pe.title, pe.forename, pe.surname, pe.address_line1, pe.town, pe.postcode, pe.telephone, pe.email,
              v.registration, v.make, v.model
       FROM claim_third_parties tp
       JOIN people pe ON pe.id = tp.person_id
       LEFT JOIN vehicles v ON v.id = tp.vehicle_id
       WHERE tp.claim_id = ? AND tp.sequence = ?`,
      [claimId, sequence],
    );
    if (tp) {
      fill("title", tp.title);
      fill("forename", tp.forename);
      fill("surname", tp.surname);
      fill("address", [tp.address_line1, tp.town].filter(Boolean).join("\n"));
      fill("postcode", tp.postcode);
      fill("telMain", tp.telephone);
      fill("email", tp.email);
      fill("registration", tp.registration);
      fill("make", tp.make);
      fill("model", tp.model);
      if (sequence === 1) {
        defaults.registration = tp.registration == null ? "" : String(tp.registration);
        defaults.make = tp.make == null ? "" : String(tp.make);
        defaults.model = tp.model == null ? "" : String(tp.model);
      }
      fill("insurerName", tp.insurer_name);
      fill("insurerAddress", tp.insurer_address);
      fill("insurerPostcode", tp.insurer_postcode);
      fill("insurerTel", tp.insurer_tel);
      fill("insurerEmail", tp.insurer_email);
      fill("insurerReference", tp.insurer_ref);
      fill("policyNumber", tp.policy_number);
      fill("liabilityDeclared", tp.liability_admitted);
      fill("agentName", tp.agent_name);
      fill("agentAddress", tp.agent_address);
      fill("agentPostcode", tp.agent_postcode);
      fill("agentTel", tp.agent_tel);
      fill("agentEmail", tp.agent_email);
      fill("agentHandlerName", tp.agent_handler_name);
      fill("agentHandlerEmail", tp.agent_handler_email);
      fill("agentHandlerTel", tp.agent_handler_tel);
      fill("agentReference", tp.agent_ref);
    }
  }
  return defaults;
}

export function knownScreenKeys() {
  return CLAIM_SCREENS.map((s) => s.key);
}

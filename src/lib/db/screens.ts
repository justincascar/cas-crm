import { accidentDateError, nowUtcIso, londonDateIso, occurredFromForm } from "../dates";
import { FieldValidationError } from "../form-validation";
import { CLAIM_SCREENS, getClaimScreen } from "../claim-screens";
import { dobConfirmName, dobKindForField, dobSaveError, isDobFieldName } from "../age";
import { isMobileFieldName, mobileNumberError } from "../phone-number";
import { formatTypedValue } from "../text";
import { get, all, getDb, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { normaliseGtaGroup } from "../documents/gta";
import { poundsToPence } from "./intake";
import { rememberAgentOn, rememberInsurerOn } from "./insurers";
import { displayValue } from "../screen-display";
import { updateClaimAudatexCodes, updateClaimWorkflowStatus, suggestAudatexCodesForClaim } from "./queries";
import { getStorageDateReview, getStorageEndDateReview } from "./storage-recovery-date";
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
  return values;
}

export function screenSaveFieldError(
  claimId: string,
  screenKey: string,
  values: ScreenValues,
): { field: string; message: string } | null {
  if (screenKey === "accident") {
    const accident = accidentDateError(values.accidentDate);
    return accident ? { field: "accidentDate", message: accident } : null;
  }
  const def = getClaimScreen(screenKey);
  if (!def) return null;
  const claim = get<{ client_role: string | null }>(`SELECT client_role FROM claims WHERE id = ?`, [claimId]);
  for (const section of def.sections) {
    for (const field of section.fields) {
      if (isMobileFieldName(field.name)) {
        const mobileErr = mobileNumberError(values[field.name]);
        if (mobileErr) return { field: field.name, message: mobileErr };
      }
      if (!isDobFieldName(field.name)) continue;
      const err = dobSaveError(
        values[field.name],
        dobKindForField(screenKey, field.name, claim?.client_role || undefined),
        values[dobConfirmName(field.name)] === "yes",
      );
      if (err) return { field: field.name, message: err };
    }
  }
  return null;
}

export function screenSaveError(claimId: string, screenKey: string, values: ScreenValues): string | null {
  return screenSaveFieldError(claimId, screenKey, values)?.message ?? null;
}

export function saveScreenData(claimId: string, screenKey: string, values: ScreenValues, actorId: string) {
  const blocked = screenSaveFieldError(claimId, screenKey, values);
  if (blocked) throw new FieldValidationError(blocked.field, blocked.message);
  const now = nowUtcIso();
  run(
    `INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(claim_id, screen_key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
    [claimId, screenKey, JSON.stringify(values), now],
  );
  applySideEffects(claimId, screenKey, values, actorId);
  run(`UPDATE claims SET updated_at = ? WHERE id = ?`, [now, claimId]);
}

function applySideEffects(claimId: string, screenKey: string, values: ScreenValues, actorId: string) {
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
    run(
      `UPDATE claims SET storage_started_on = ?, storage_billing_end_on = ?, storage_rate_pence = ?,
        storage_status = CASE WHEN ? != '' THEN 'active' ELSE storage_status END
       WHERE id = ?`,
      [
        values.startDate || null,
        values.endDate || null,
        values.dailyRate ? Number.parseInt(values.dailyRate, 10) || null : null,
        values.startDate || "",
        claimId,
      ],
    );
    getStorageDateReview(claimId);
    getStorageEndDateReview(claimId);
  }

  if (screenKey === "recovery") {
    const existing = get<{ id: string }>(`SELECT id FROM recovery_jobs WHERE claim_id = ? LIMIT 1`, [claimId]);
    if (existing) {
      run(
        `UPDATE recovery_jobs SET location = COALESCE(NULLIF(?, ''), location), recovered_at = COALESCE(NULLIF(?, ''), recovered_at),
          charge_pence = CASE WHEN ? != '' THEN CAST(? AS INTEGER) ELSE charge_pence END,
          inherited_note = COALESCE(NULLIF(?, ''), inherited_note)
         WHERE id = ?`,
        [
          values.location || "",
          values.recoveryDate || "",
          values.standardCharge || "",
          values.standardCharge || "0",
          values.reasonForFee || "",
          existing.id,
        ],
      );
      getStorageDateReview(claimId);
    }
  }

  if (screenKey === "tp1") updateThirdParty(claimId, 1, values);
  if (screenKey === "tp2") updateThirdParty(claimId, 2, values);

  if (screenKey === "assessed-damage" && values.totalLoss === "yes") {
    run(`UPDATE claims SET total_loss = 1 WHERE id = ?`, [claimId]);
  }

  if (screenKey === "loss-of-use") {
    const map: Array<[string, string]> = [
      ["firstNotificationTpi", "initial_letter_tp_insurer"],
      ["engineerInstructed", "engineer_instructed"],
      ["repairAuthorised", "repairs_authorised"],
      ["repairStart", "repairs_started"],
      ["hireOut", "hire_started"],
      ["hireBack", "hire_ended"],
    ];
    for (const [field, eventType] of map) {
      if (!values[field]) continue;
      const existing = get<{ id: string }>(
        `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = ? LIMIT 1`,
        [claimId, eventType],
      );
      if (existing) continue;
      recordClaimEvent({
        claimId,
        eventType,
        occurredAt: values[field],
        details: "Recorded from loss of use dates.",
        actorId,
        source: "staff",
      });
    }
  }
}

function updateThirdParty(claimId: string, sequence: number, values: ScreenValues) {
  const tp = get<{ id: string; person_id: string; vehicle_id: string | null }>(
    `SELECT id, person_id, vehicle_id FROM claim_third_parties WHERE claim_id = ? AND sequence = ?`,
    [claimId, sequence],
  );
  if (!tp) return;
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
    defaults[key] = String(value);
  };

  if (screenKey === "general") {
    fill("caseStatus", claim.current_position);
    defaults.typeOfClaim = normalizeLiabilityStatus(defaults.typeOfClaim || String(claim.claim_type || ""));
    defaults.roadworthiness = normalizeRoadworthiness(defaults.roadworthiness || String(claim.roadworthiness || ""));
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
    fill("address", [claim.address_line1, claim.town].filter(Boolean).join("\n"));
    fill("postcode", claim.postcode);
    fill("telMain", claim.telephone);
    fill("telMobile", claim.mobile_tel);
    fill("telHome", claim.home_tel);
    fill("email", claim.email);
    fill("dob", claim.date_of_birth);
    fill("licenceNumber", claim.licence_number);
    fill("licenceIssuedOn", claim.licence_issued_on);
    fill("licenceExpiry", claim.licence_expires_on);
  }
  if (screenKey === "owner") {
    fill("companyName", claim.full_name);
    fill("address", [claim.address_line1, claim.town].filter(Boolean).join("\n"));
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
    }
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
  }
  if (screenKey === "insurer") {
    fill("companyName", claim.own_insurer_name);
    fill("policyNumber", claim.own_policy_ref);
    fill("claimReference", claim.own_claim_ref);
    fill("address", claim.own_insurer_address);
    fill("postcode", claim.own_insurer_postcode);
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
    if (claim.storage_rate_pence != null) fill("dailyRate", String(claim.storage_rate_pence));
  }
  if (screenKey === "recovery") {
    const job = get<Record<string, string | number | null>>(
      `SELECT * FROM recovery_jobs WHERE claim_id = ? LIMIT 1`,
      [claimId],
    );
    if (job) {
      fill("location", job.location);
      fill("recoveryDate", job.recovered_at ? String(job.recovered_at).slice(0, 10) : "");
      if (job.charge_pence != null) fill("standardCharge", String(job.charge_pence));
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

import { CAS_COMPANY, CAS_HIRE_AGREEMENT_BANNER, CAS_HIRE_TERMS_HTML } from "../documents/cas-hire-terms";
import {
  HIRE_PACK_MANDATORY,
  OWN_VEHICLE_DETAILS_HEADING,
  RENTAL_PERIOD_DECISION,
  STORAGE_RECOVERY_MANDATORY,
  STORAGE_RECOVERY_STANDALONE_BANNER,
} from "../documents/hire-pack-fields";
import { formatUkDate, formatUkDateTime, nowUtcIso } from "../dates";
import { describeHireAgreementParts } from "../documents/hire-agreement-parts";
import { dobSaveError } from "../age";
import { FieldValidationError } from "../form-validation";
import { mobileNumberError } from "../phone-number";
import { formatGbp } from "../money";
import { all, get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";

export type HirePackData = Record<string, string | number | null>;

const EMPTY_PACK: HirePackData = {
  title: "",
  home_tel: "",
  work_tel: "",
  mobile_tel: "",
  licence_issued_on: "",
  licence_expires_on: "",
  additional_name: "",
  additional_address: "",
  additional_dob: "",
  additional_licence: "",
  additional_licence_issued_on: "",
  additional_licence_expires_on: "",
  delivery_address: "",
  hire_fuel: "",
  vehicle_group: "",
  group_charged: "",
  date_out: "",
  date_in: "",
  daily_rate_pence: 0,
  sat_nav_pence: 0,
  additional_driver_pence: 0,
  hands_free_pence: 0,
  cdw_pence: 0,
  child_seat_pence: 0,
  automatic_pence: 0,
  insurance_daily_pence: 0,
  estate_pence: 0,
  insurance_pence: 0,
  tow_bar_pence: 0,
  admin_pence: 0,
  roof_rack_pence: 0,
  delivery_collection_pence: 0,
  no_replacement_offer: 1,
  declined_offer_reason: "",
  understands_personal_liability: 1,
  need_reason: "",
  own_vehicle_unusable: 1,
  no_other_vehicle: 1,
  delivery_mileage: null,
  delivery_fuel: "",
  delivery_tyres: "",
  delivery_damage: "",
  delivery_interior: "",
  collection_mileage: null,
  collection_fuel: "",
  collection_damage: "",
  storage_daily_pence: 0,
  recovery_pence: 0,
  driver_delivery_start: "",
  driver_delivery_finish: "",
  driver_name: "",
  means_documents_requested: 0,
  means_documents_on_file: 0,
  cannot_fund_hire: 0,
  no_other_credit: 0,
  means_notes: "",
  group_override_reason: "",
  daily_rate_manual: 0,
  own_vehicle_mileage: null,
  own_vehicle_fuel: "",
  own_vehicle_tyres: "",
  own_vehicle_damage: "",
};

export function getHirePack(claimId: string) {
  const claim = get<Record<string, string | number | null>>(
    `SELECT c.*, s.name AS handler_name, p.full_name AS client_name, p.date_of_birth, p.address_line1, p.town, p.postcode,
            p.telephone, p.email, p.licence_number, v.registration AS client_reg, v.make AS client_make, v.model AS client_model,
            v.gta_group AS client_gta_group, c.hire_agreement_number
     FROM claims c
     LEFT JOIN staff s ON s.id = c.handler_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  if (!claim) return null;
  const hire = get<Record<string, string | number | null>>(
    `SELECT he.*, v.registration AS hire_reg, v.make AS hire_make, v.model AS hire_model, v.transmission AS hire_transmission, v.fuel AS hire_fuel,
            v.gta_group AS supplied_gta_group
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ?
     ORDER BY he.started_at DESC`,
    [claimId],
  );
  const savedRow = get<HirePackData>(`SELECT * FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  const recoveryJob = get<{ recovered_at: string | null }>(
    `SELECT recovered_at FROM recovery_jobs WHERE claim_id = ? AND recovered_at IS NOT NULL AND trim(recovered_at) != '' ORDER BY recovered_at DESC LIMIT 1`,
    [claimId],
  );
  const reservation = get<{ id: string }>(
    `SELECT id FROM reservations WHERE claim_id = ? AND lower(status) IN ('reserved', 'active') LIMIT 1`,
    [claimId],
  );
  const hireDescription = [hire?.hire_make, hire?.hire_model, hire?.hire_reg]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const parts = describeHireAgreementParts({
    hireAllocated: Boolean(hire),
    hireDescription,
    recoveryStatus: claim.recovery_status ? String(claim.recovery_status) : null,
    storageStatus: claim.storage_status ? String(claim.storage_status) : null,
    storageStartedOn: claim.storage_started_on ? String(claim.storage_started_on) : null,
    recoveryRecoveredAt: recoveryJob?.recovered_at ? String(recoveryJob.recovered_at) : null,
    hasReservation: Boolean(reservation),
  });
  const stored = savedRow || {};
  const address = [claim.address_line1, claim.town, claim.postcode].filter(Boolean).join(", ");
  const merged: HirePackData = {
    ...EMPTY_PACK,
    home_tel: String(claim.telephone || ""),
    mobile_tel: String(claim.telephone || ""),
    delivery_address: address,
    date_out: hire?.started_at ? String(hire.started_at) : "",
    daily_rate_pence: Number(hire?.rate_pence_per_day || 0),
    hire_fuel: String(hire?.hire_fuel || ""),
    ...stored,
    claim_id: claimId,
  };
  const ctx = {
    agreementNumber: String(claim.file_reference),
    hirerName: String(claim.client_name || ""),
    hirerAddress: address || String(merged.delivery_address || ""),
    hirerDob: String(claim.date_of_birth || ""),
    licenceNumber: String(claim.licence_number || ""),
    licenceIssuedOn: String(merged.licence_issued_on || ""),
    licenceExpiresOn: String(merged.licence_expires_on || ""),
    hireMake: String(hire?.hire_make || ""),
    hireModel: String(hire?.hire_model || ""),
    hireRegistration: String(hire?.hire_reg || ""),
    hireTransmission: String(hire?.hire_transmission || ""),
    dateOut: String(merged.date_out || hire?.started_at || ""),
    dailyRatePence: Number(merged.daily_rate_pence || hire?.rate_pence_per_day || 0),
    needReason: String(merged.need_reason || ""),
    clientVehicleRegistration: String(claim.client_reg || ""),
  };
  const missing = HIRE_PACK_MANDATORY.filter((key) => {
    const value = ctx[key];
    return value === "" || value === null || value === undefined || value === 0 || value === "unknown";
  });
  const srCtx = {
    clientName: String(claim.client_name || ""),
    clientVehicleRegistration: String(claim.client_reg || ""),
  };
  const srMissing = STORAGE_RECOVERY_MANDATORY.filter((key) => {
    const value = srCtx[key];
    return value === "" || value === null || value === undefined || value === "unknown";
  });
  return {
    claim,
    hire,
    stored: merged,
    ctx,
    missing,
    srMissing,
    srNumber: `${claim.file_reference}-SR`,
    clientMake: String(claim.client_make || ""),
    clientModel: String(claim.client_model || ""),
    packSaved: Boolean(savedRow),
    parts,
  };
}

export function hirePackSaveFieldError(input: HirePackData): { field: string; message: string } | null {
  const confirmed = (key: string) => {
    const value = input[key];
    return value === "yes" || value === 1;
  };
  const hirerErr = dobSaveError(String(input.date_of_birth || ""), "hirer", confirmed("date_of_birth_confirmed"));
  if (hirerErr) return { field: "date_of_birth", message: hirerErr };
  const mobileErr = mobileNumberError(String(input.mobile_tel || ""));
  if (mobileErr) return { field: "mobile_tel", message: mobileErr };
  const additionalErr = dobSaveError(
    String(input.additional_dob || ""),
    "driver",
    confirmed("additional_dob_confirmed"),
  );
  if (additionalErr) return { field: "additional_dob", message: additionalErr };
  return null;
}

export function hirePackSaveError(input: HirePackData): string | null {
  return hirePackSaveFieldError(input)?.message ?? null;
}

export function saveHirePack(claimId: string, input: HirePackData) {
  const blocked = hirePackSaveFieldError(input);
  if (blocked) throw new FieldValidationError(blocked.field, blocked.message);
  const existing = get(`SELECT claim_id FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  const columns = Object.keys(EMPTY_PACK);
  const values = columns.map((key) => input[key] ?? EMPTY_PACK[key]);
  if (existing) {
    run(
      `UPDATE hire_pack_data SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE claim_id = ?`,
      [...values, nowUtcIso(), claimId],
    );
  } else {
    run(
      `INSERT INTO hire_pack_data(claim_id, ${columns.join(", ")}, updated_at) VALUES (?, ${columns.map(() => "?").join(", ")}, ?)`,
      [claimId, ...values, nowUtcIso()],
    );
  }
  run(
    `UPDATE people SET
        date_of_birth = COALESCE(NULLIF(?, ''), date_of_birth),
        licence_number = COALESCE(NULLIF(?, ''), licence_number),
        telephone = COALESCE(NULLIF(?, ''), telephone)
     WHERE id = (SELECT client_person_id FROM claims WHERE id = ?)`,
    [
      String(input.date_of_birth || ""),
      String(input.licence_number || ""),
      String(input.mobile_tel || input.home_tel || ""),
      claimId,
    ],
  );
}

export function generateHirePackDocument(claimId: string, actorId: string) {
  const pack = getHirePack(claimId);
  if (!pack) throw new Error("File not found.");
  const html = renderHirePack(pack);
  const versionRow = get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = 'hire_pack'`,
    [claimId],
  );
  const version = Number(versionRow?.v || 0) + 1;
  const documentId = newId("doc");
  run(
    `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
     VALUES (?, ?, ?, 'hire_pack', ?, 0, 1, ?, 'hire_pack', ?, ?)`,
    [
      documentId,
      claimId,
      "Hire Pack",
      version,
      html,
      JSON.stringify(pack.missing),
      nowUtcIso(),
    ],
  );
  recordClaimEvent({
    claimId,
    eventType: "document_generated",
    occurredAt: nowUtcIso(),
    details: `Hire Pack version ${version} generated from CRM data${pack.missing.length ? `. Missing: ${pack.missing.join(", ")}` : ""}`,
    actorId,
    channel: "letter",
    documentId,
    source: "system",
  });
  return { documentId, missing: pack.missing };
}

export function generateStorageRecoveryDocument(claimId: string, actorId: string) {
  const pack = getHirePack(claimId);
  if (!pack) throw new Error("File not found.");
  const html = renderStorageRecovery(pack);
  const versionRow = get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = 'storage_recovery'`,
    [claimId],
  );
  const version = Number(versionRow?.v || 0) + 1;
  const documentId = newId("doc");
  run(
    `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
     VALUES (?, ?, ?, 'agreement', ?, 0, 1, ?, 'storage_recovery', ?, ?)`,
    [
      documentId,
      claimId,
      "Storage & Recovery Agreement",
      version,
      html,
      JSON.stringify(pack.srMissing),
      nowUtcIso(),
    ],
  );
  recordClaimEvent({
    claimId,
    eventType: "document_generated",
    occurredAt: nowUtcIso(),
    details: `Storage & Recovery Agreement version ${version} generated as a standalone document${pack.srMissing.length ? `. Missing: ${pack.srMissing.join(", ")}` : ""}. Solicitor-reviewed standalone wording is still to come.`,
    actorId,
    channel: "letter",
    documentId,
    source: "system",
  });
  return { documentId, missing: pack.srMissing };
}

function v(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "" || value === 0) return "Unknown";
  return String(value);
}

function money(pence: string | number | null | undefined) {
  return formatGbp(Number(pence || 0));
}

export function renderHirePack(pack: NonNullable<ReturnType<typeof getHirePack>>) {
  const s = pack.stored;
  const hire = pack.hire;
  const agreement = pack.ctx.agreementNumber;
  const name = pack.ctx.hirerName || "Unknown";
  const address = pack.ctx.hirerAddress || "Unknown";
  const hireVehicle = `${v(hire?.hire_make)} ${v(hire?.hire_model)}`.replace("Unknown Unknown", "Unknown");
  const dateOut = s.date_out ? formatUkDate(String(s.date_out)) : formatUkDate(hire?.started_at ? String(hire.started_at) : null);
  const missingBanner =
    pack.missing.length > 0
      ? `<p class="missing">Missing from CRM (shown as Unknown — not invented): ${pack.missing.join(", ")}</p>`
      : "";

  return `<article class="letter hire-pack">
${missingBanner}
<p><strong>${CAS_COMPANY.name}</strong> — Hire Pack generated from the file. Driver sheets are internal and must not be given to the client. Signatures are not fabricated. Storage &amp; Recovery is a separate document and is not included in these pages.</p>

<section>
<h2>Driver Delivery Sheet (Do Not Give to Client)</h2>
<p>Agreement Number: <strong>${escape(agreement)}</strong></p>
<p>Delivery Address: ${escape(v(s.delivery_address || address))}</p>
<p>Start Time: ${escape(v(s.driver_delivery_start))} &nbsp; Finish Time: ${escape(v(s.driver_delivery_finish))}</p>
<p>Client: ${escape(name)}<br/>Address: ${escape(address)}<br/>Home Tel: ${escape(v(s.home_tel))} &nbsp; Work Tel: ${escape(v(s.work_tel))} &nbsp; Mob Tel: ${escape(v(s.mobile_tel))}</p>
<p>Hire vehicle: ${escape(hireVehicle)} &nbsp; Reg: ${escape(v(hire?.hire_reg))}</p>
<p>Driver name: ${escape(v(s.driver_name))}</p>
</section>

<section>
<h2>Vehicle Damage Form</h2>
<p>Agreement number: <strong>${escape(agreement)}</strong></p>
<p>Client: ${escape(name)} — ${escape(address)}</p>
<p>Hire vehicle: ${escape(hireVehicle)} &nbsp; ${escape(v(hire?.hire_reg))}</p>
<table>
<tr><th></th><th>Delivered to client</th><th>Collected from client</th></tr>
<tr><td>Mileage</td><td>${escape(v(s.delivery_mileage))}</td><td>${escape(v(s.collection_mileage))}</td></tr>
<tr><td>Fuel</td><td>${escape(v(s.delivery_fuel))}</td><td>${escape(v(s.collection_fuel))}</td></tr>
<tr><td>Tyre depths</td><td colspan="2">${escape(v(s.delivery_tyres))}</td></tr>
<tr><td>Interior</td><td colspan="2">${escape(v(s.delivery_interior))}</td></tr>
<tr><td>Damage (delivery)</td><td colspan="2">${escape(v(s.delivery_damage))}</td></tr>
<tr><td>Damage (collection)</td><td colspan="2">${escape(v(s.collection_damage))}</td></tr>
</table>
<p>I hereby confirm that the damage to the vehicle is marked above and may be supported by digital images taken at the time of collection by Complete Accident Solutions Ltd.</p>
<p>Date delivered: ${escape(dateOut)} &nbsp; Date collected: ${escape(s.date_in ? formatUkDate(String(s.date_in)) : "Unknown")}</p>
<p>Signed by Hirer: ______________________ (upload signed copy — not fabricated)</p>
<p>Signed for and on behalf of ${CAS_COMPANY.name}: ______________________</p>
</section>

<section>
<h2>Mitigation Questionnaire / Statement of Truth</h2>
<p>Agreement Number: <strong>${escape(agreement)}</strong> &nbsp; Date: ${escape(dateOut)}</p>
<p>TO BE COMPLETED BY CUSTOMER</p>
<p>Prior to agreeing to enter into the hire agreement my duty to keep my losses to a minimum have been explained to me and</p>
<p>${Number(s.no_replacement_offer) ? "☑" : "☐"} I had not received an offer for a replacement vehicle from the at-fault insurer</p>
<p>${s.declined_offer_reason ? "☑" : "☐"} I did receive an offer of a replacement vehicle but did not accept it because: ${escape(v(s.declined_offer_reason))}</p>
<p>${Number(s.understands_personal_liability) ? "☑" : "☐"} I understand that if I choose to hire on credit I am personally liable for paying for the hire costs which I would not have incurred had I been offered and accepted a suitable courtesy vehicle from my own motor insurer or legal expenses insurer.</p>
<p>I need a hire vehicle because: ${escape(v(s.need_reason))}</p>
<p>${Number(s.own_vehicle_unusable) ? "☑" : "☐"} I believe my own vehicle is unroadworthy and/or unusable and I understand temporary repairs are impractical or uneconomic.</p>
<p>${Number(s.no_other_vehicle) ? "☑" : "☐"} I do not have another suitable vehicle available to me, either being my own or through my immediate family.</p>
<h3>Financial means</h3>
<p>Need for a vehicle is separate from whether I could reasonably have paid for a replacement myself. Intake already asks for a statement of means and three months' bank statements. This declaration refers to that disclosure; it does not replace it.</p>
<p>${Number(s.means_documents_requested) ? "☑" : "☐"} A statement of means and bank statements have been requested</p>
<p>${Number(s.means_documents_on_file) ? "☑" : "☐"} A statement of means and/or bank statements are on this file</p>
<p>${Number(s.cannot_fund_hire) ? "☑" : "☐"} I could not reasonably have funded a replacement vehicle from my own resources</p>
<p>${Number(s.no_other_credit) ? "☑" : "☐"} I did not have access to other credit that I could reasonably have used to hire a replacement</p>
<p>Further notes: ${escape(v(s.means_notes))}</p>
<p>I have read and understood the above and I believe that the answers I have given are true.</p>
<p>Name: ${escape(name)} &nbsp; Address: ${escape(address)}</p>
<p>Signed: ______________________ &nbsp; Date: ${escape(dateOut)}</p>
</section>

<section>
<h2>Hire Agreement — 1 of 3</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Agreement number: <strong>${escape(agreement)}</strong></p>
<h3>Driver details</h3>
<table>
<tr><th></th><th>Hirer</th><th>Additional driver</th></tr>
<tr><td>Name</td><td>${escape(name)}</td><td>${escape(v(s.additional_name))}</td></tr>
<tr><td>Address</td><td>${escape(address)}</td><td>${escape(v(s.additional_address))}</td></tr>
<tr><td>DOB</td><td>${escape(pack.ctx.hirerDob || "Unknown")}</td><td>${escape(v(s.additional_dob))}</td></tr>
<tr><td>Driving licence</td><td>${escape(pack.ctx.licenceNumber || "Unknown")}</td><td>${escape(v(s.additional_licence))}</td></tr>
<tr><td>Date of issue</td><td>${escape(v(s.licence_issued_on))}</td><td>${escape(v(s.additional_licence_issued_on))}</td></tr>
<tr><td>Date of expiry</td><td>${escape(v(s.licence_expires_on))}</td><td>${escape(v(s.additional_licence_expires_on))}</td></tr>
</table>
<p>Delivery address: ${escape(v(s.delivery_address || address))}</p>
<h3>Vehicle details</h3>
<p>Make: ${escape(v(hire?.hire_make))} &nbsp; Model: ${escape(v(hire?.hire_model))} &nbsp; Reg: ${escape(v(hire?.hire_reg))}<br/>
Transmission: ${escape(v(hire?.hire_transmission))} &nbsp; Fuel: ${escape(v(s.hire_fuel || hire?.hire_fuel))}<br/>
Vehicle group: ${escape(v(s.vehicle_group))} &nbsp; Group charged: ${escape(v(s.group_charged))}<br/>
Date out: ${escape(dateOut)} &nbsp; Date in: ${escape(s.date_in ? formatUkDate(String(s.date_in)) : "Unknown")}</p>
<h3>Charges</h3>
<table>
<tr><td>Daily rate</td><td>${money(s.daily_rate_pence)}</td><td>Sat navigation</td><td>${money(s.sat_nav_pence)}</td></tr>
<tr><td>Additional driver</td><td>${money(s.additional_driver_pence)}</td><td>Hands free</td><td>${money(s.hands_free_pence)}</td></tr>
<tr><td>Collision damage waiver</td><td>${money(s.cdw_pence)}</td><td>Child seat</td><td>${money(s.child_seat_pence)}</td></tr>
<tr><td>Automatic charge</td><td>${money(s.automatic_pence)}</td><td>Insurance (daily)</td><td>${money(s.insurance_daily_pence)}</td></tr>
<tr><td>Estate charge</td><td>${money(s.estate_pence)}</td><td>Insurance</td><td>${money(s.insurance_pence)}</td></tr>
<tr><td>Tow bar</td><td>${money(s.tow_bar_pence)}</td><td>Admin fee</td><td>${money(s.admin_pence)}</td></tr>
<tr><td>Roof rack</td><td>${money(s.roof_rack_pence)}</td><td>Delivery &amp; collection</td><td>${money(s.delivery_collection_pence)}</td></tr>
</table>
<p>All charges are subject to VAT at the current rate. Rates are taken from this file / agreement. Defaults are not applied automatically.</p>
<h3>Statement of liability</h3>
<p>When Your Own Vehicle has been damaged in an Accident which is not Your fault, You can hire a replacement of a similar standard from Us. You are responsible for the cost but We will finance it for a period of up to 51 weeks while the Third Party's insurer is pursued for the amounts due.</p>
<p>At the commencement of this agreement there is no estimate of the length of time You will need the vehicle, however the total charges under this agreement can be calculated by multiplying the number of days hired by the corresponding daily rental charge as detailed above.</p>
<p>Signed by Hirer: ______________________ Date: ${escape(dateOut)}</p>
<p>Signed for and on behalf of ${CAS_COMPANY.name}: ______________________</p>
</section>

<section>
<h2>Hire Agreement — 2 of 3</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
${CAS_HIRE_TERMS_HTML}
<p>Full remaining clauses are those in the CAS Hire Pack supplied to the CRM (hire and storage arrangements, terms of hire, repair arrangements, general provisions and miscellaneous). They are not rewritten here. Operational file alerts use a maximum of ${RENTAL_PERIOD_DECISION.alertDays} days specified separately by CAS; the supplied pack defines the rental period as ${RENTAL_PERIOD_DECISION.packDays} days. ${RENTAL_PERIOD_DECISION.note}</p>
<p>Signed by Hirer: ______________________ &nbsp; Date of agreement: ${escape(dateOut)}</p>
</section>

<section>
<h2>Hire Agreement — 3 of 3 — Notice of the Right to Cancel</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Date: ${escape(dateOut)}</p>
<p>"The Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008"</p>
<p>Name: ${escape(name)}<br/>Address: ${escape(address)}</p>
<p>You have the right to cancel the Contract within 14 days. Notice must be in writing.</p>
<p>Post: Hire Administration, ${CAS_COMPANY.name}, ${CAS_COMPANY.address}<br/>
Electronic mail: ${CAS_COMPANY.email}<br/>
Telephone: ${CAS_COMPANY.phone}</p>
<p>Agreement number: ${escape(agreement)}</p>
<p>If you wish to cancel, complete, detach and return this form ONLY IF YOU WISH TO CANCEL THE CONTRACT.</p>
</section>

<section>
<h2>Driver Collection Sheet (Do Not Give to Client)</h2>
<p>Agreement Number: <strong>${escape(agreement)}</strong></p>
<p>Collection Address: ${escape(v(s.delivery_address || address))}</p>
<p>Client: ${escape(name)} — ${escape(address)}</p>
<p>Hire vehicle: ${escape(hireVehicle)} &nbsp; ${escape(v(hire?.hire_reg))}</p>
<p>Generated ${escape(formatUkDateTime(nowUtcIso()))} from CRM file ${escape(agreement)}. Not a live Word merge of Hire Pack.doc; layout follows that pack. Signed originals must be uploaded separately.</p>
</section>
</article>`;
}

export function renderStorageRecovery(pack: NonNullable<ReturnType<typeof getHirePack>>) {
  const s = pack.stored;
  const name = pack.ctx.hirerName || "Unknown";
  const address = pack.ctx.hirerAddress || "Unknown";
  const clientVehicle = `${v(pack.clientMake)} ${v(pack.clientModel)}`.replace("Unknown Unknown", "Unknown");
  const missingBanner =
    pack.srMissing.length > 0
      ? `<p class="missing">Missing from CRM (shown as Unknown — not invented): ${pack.srMissing.join(", ")}</p>`
      : "";
  const recoveredOn = pack.claim.storage_started_on
    ? formatUkDate(String(pack.claim.storage_started_on))
    : "Unknown";
  return `<article class="letter hire-pack">
${missingBanner}
<p><strong>${CAS_COMPANY.name}</strong></p>
<h2>Storage &amp; Recovery Agreement</h2>
<p>${STORAGE_RECOVERY_STANDALONE_BANNER}</p>
<p>Document number: <strong>${escape(String(pack.srNumber))}</strong> &nbsp; File: ${escape(pack.ctx.agreementNumber)}</p>
<p>This document does not use a hire agreement number and does not require a Hire Agreement on the file.</p>
<p>Name: ${escape(name)}<br/>Address: ${escape(address)}</p>
<h3>${OWN_VEHICLE_DETAILS_HEADING}</h3>
<p>This is the client's own damaged vehicle being recovered and stored — not a hire vehicle.</p>
<p>Make: ${escape(v(pack.clientMake))} &nbsp; Model: ${escape(v(pack.clientModel))} &nbsp; Reg: ${escape(v(pack.ctx.clientVehicleRegistration))}</p>
<p>Mileage: ${escape(v(s.own_vehicle_mileage))} &nbsp; Fuel: ${escape(v(s.own_vehicle_fuel))}</p>
<p>Tyre depths NSF / OSF / NSR / OSR: ${escape(v(s.own_vehicle_tyres))}</p>
<p>Damage: ${escape(v(s.own_vehicle_damage))}</p>
<p>Recovered on: ${escape(recoveredOn)}</p>
<p>Storage daily rate: ${money(s.storage_daily_pence || pack.claim.storage_rate_pence)} &nbsp; Recovery: ${money(s.recovery_pence)}</p>
<p>${CAS_COMPANY.name} will not accept responsibility for any valuables left in the vehicle at point of collection including removable car stereo and satellite navigation equipment.</p>
<p>Signed by the client: ______________________ (upload signed copy — not fabricated)</p>
<p>Signed for and on behalf of ${CAS_COMPANY.name}: ______________________</p>
</article>`;
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function listHirePackDocuments() {
  return all(`SELECT d.*, c.file_reference FROM documents d JOIN claims c ON c.id = d.claim_id WHERE d.template_key = 'hire_pack' ORDER BY d.created_at DESC`);
}

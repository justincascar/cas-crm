import { CAS_COMPANY, CAS_HIRE_AGREEMENT_BANNER, CAS_HIRE_TERMS_HTML } from "../documents/cas-hire-terms";
import { OWN_VEHICLE_DETAILS_HEADING } from "../documents/hire-pack-fields";
import { describeHireAgreementParts, type AgreementPart, type HireAgreementParts } from "../documents/hire-agreement-parts";
import {
  GTA_MARKUP_PERCENT_DEFAULT,
  GTA_NOT_CLASSIFIED,
  gtaGroupLabel,
  groupChargedAboveClient,
  normaliseGtaGroup,
  standardDailyRatePence,
} from "../documents/gta";
import { formatUkDate, formatUkDateTime, nowUtcIso } from "../dates";
import { formatGbp } from "../money";
import { get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { formatHandoverMileage } from "./handover";
import { getHirePack, type HirePackData } from "./hire-pack";

export const HIRE_AGREEMENT_TEMPLATE_KEY = "hire_agreement";
export const HIRE_AGREEMENT_DOCUMENT_TYPE = "hire_agreement";
export const SETTING_GTA_MARKUP_PERCENT = "gta_markup_percent";
export const SETTING_NEXT_HIRE_AGREEMENT_NUMBER = "next_hire_agreement_number";

/** Demonstration sequence. It does not continue from real CAS agreement 100773 or numbers near it. */
export function formatHireAgreementNumber(sequence: number): string {
  return `TEST-HA-${String(sequence).padStart(6, "0")}`;
}

export { describeHireAgreementParts };
export type { AgreementPart, HireAgreementParts };

export type HireAgreementView = {
  agreementNumber: string;
  hirerName: string;
  hirerAddress: string;
  hirerDob: string;
  licenceNumber: string;
  licenceIssuedOn: string;
  licenceExpiresOn: string;
  additionalName: string;
  additionalAddress: string;
  additionalDob: string;
  additionalLicence: string;
  additionalLicenceIssuedOn: string;
  additionalLicenceExpiresOn: string;
  deliveryAddress: string;
  hireMake: string;
  hireModel: string;
  hireRegistration: string;
  hireTransmission: string;
  hireFuel: string;
  suppliedGroup: string | null;
  clientGroup: string | null;
  groupCharged: string | null;
  dateOut: string;
  dateIn: string;
  dailyRatePence: number | null;
  hireMileage: string;
  hireFuelLevel: string;
  extras: Record<string, number | null>;
  clientVehiclePresent: boolean;
  clientMake: string;
  clientModel: string;
  clientRegistration: string;
  ownMileage: string | number | null;
  ownFuel: string;
  ownTyres: string;
  ownDamage: string;
  storageDailyPence: number | null;
  recoveryPence: number | null;
  overrideReason: string;
  includeHire: boolean;
  includeStorageRecovery: boolean;
  hireReason: string;
  storageReason: string;
  termsReason: string;
};

const EXTRA_ROWS: Array<[string, string, string, string]> = [
  ["Daily rate", "daily", "Sat navigation", "sat_nav"],
  ["Additional driver surcharge", "additional_driver", "Hands free", "hands_free"],
  ["Collision damage waiver", "cdw", "Child seat", "child_seat"],
  ["Automatic charge", "automatic", "Insurance (daily)", "insurance_daily"],
  ["Estate charge", "estate", "Insurance", "insurance"],
  ["Tow bar", "tow_bar", "Admin fee", "admin"],
  ["Roof rack", "roof_rack", "Delivery & collection", "delivery_collection"],
];

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function blank(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function shown(value: string | number | null | undefined, missingLabel = "Missing — not guessed") {
  const text = blank(value);
  return text ? escape(text) : `<span class="missing">${escape(missingLabel)}</span>`;
}

function moneyOrNotEntered(pence: number | null | undefined) {
  if (pence === null || pence === undefined) return "not entered";
  return formatGbp(pence);
}

export function hireAgreementWarnings(view: Pick<HireAgreementView, "suppliedGroup" | "clientGroup" | "groupCharged" | "overrideReason">) {
  const chargedAbove = groupChargedAboveClient(view.groupCharged, view.clientGroup);
  const suppliedAbove =
    !chargedAbove && groupChargedAboveClient(view.suppliedGroup, view.clientGroup);
  return { chargedAbove, suppliedAbove };
}

export function hireAgreementMissing(view: HireAgreementView): string[] {
  const missing: string[] = [];
  if (view.includeHire) {
    if (!blank(view.licenceNumber)) missing.push("licence number");
    if (!normaliseGtaGroup(view.clientGroup)) missing.push("GTA group on the client's own vehicle");
    if (!blank(view.hireRegistration)) missing.push("hire vehicle registration");
    if (!normaliseGtaGroup(view.suppliedGroup)) missing.push("GTA group on the vehicle supplied");
    if (!normaliseGtaGroup(view.groupCharged)) missing.push("Group Charged");
    if (view.dailyRatePence == null) missing.push("daily rate");
  }
  if (view.includeStorageRecovery && !view.clientVehiclePresent) missing.push("client's own vehicle on the Storage & Recovery page");
  if (view.includeStorageRecovery && !view.includeHire && !normaliseGtaGroup(view.clientGroup)) {
    missing.push("GTA group on the client's own vehicle");
  }
  return missing;
}

export function renderHireAgreement(view: HireAgreementView): string {
  const missing = hireAgreementMissing(view);
  const warnings = hireAgreementWarnings(view);
  const agreement = escape(view.agreementNumber);
  const dateOut = view.dateOut ? formatUkDate(view.dateOut) : "";
  const dateIn = view.dateIn ? formatUkDate(view.dateIn) : "";
  const missingBanner = missing.length
    ? `<p class="missing">Missing from the file (not guessed): ${escape(missing.join("; "))}.</p>`
    : "";
  const warningBanner = [
    warnings.suppliedAbove
      ? `<p class="missing">A higher-group vehicle is being supplied (${escape(gtaGroupLabel(view.suppliedGroup))}). The daily rate still follows the client's own group (${escape(gtaGroupLabel(view.clientGroup))}). CAS does not charge for that upgrade.</p>`
      : "",
    warnings.chargedAbove
      ? `<p class="missing">Group Charged (${escape(gtaGroupLabel(view.groupCharged))}) is above the client's own vehicle group (${escape(gtaGroupLabel(view.clientGroup))}). That is above normal CAS policy. Reason recorded: ${escape(blank(view.overrideReason) || "no reason recorded")}.</p>`
      : "",
  ].join("");

  const chargeRows = EXTRA_ROWS.map(([leftLabel, leftKey, rightLabel, rightKey]) => {
    const left =
      leftKey === "daily" ? (view.dailyRatePence == null ? "Missing — not guessed" : formatGbp(view.dailyRatePence)) : moneyOrNotEntered(view.extras[leftKey]);
    const right = moneyOrNotEntered(view.extras[rightKey]);
    return `<tr><td>${leftLabel}</td><td>${escape(left)}</td><td>${rightLabel}</td><td>${escape(right)}</td></tr>`;
  }).join("");

  let cursor = 0;
  const hirePage = view.includeHire ? ++cursor : 0;
  const termsPage = ++cursor;
  const storagePage = view.includeStorageRecovery ? ++cursor : 0;
  const cancelPage = ++cursor;
  const total = cursor;
  const pageLabel = (page: number) => `${page} of ${total}`;
  const storageGap = view.clientVehiclePresent
    ? ""
    : `<p class="missing">This Storage &amp; Recovery page is incomplete. No client's own vehicle is recorded on this file. Details are not guessed.</p>`;

  return `<article class="letter hire-agreement">
${missingBanner}
${view.includeHire ? warningBanner : ""}
<p>${escape(view.hireReason)} ${escape(view.storageReason)} ${escape(view.termsReason)}</p>
${view.includeHire ? `<section>
<h2>Hire Agreement — ${pageLabel(hirePage)}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Agreement number: <strong>${agreement}</strong></p>
<h3>Driver details</h3>
<table>
<tr><th></th><th>Hirer</th><th>Additional driver</th></tr>
<tr><td>Name</td><td>${shown(view.hirerName)}</td><td>${escape(blank(view.additionalName))}</td></tr>
<tr><td>Address</td><td>${shown(view.hirerAddress)}</td><td>${escape(blank(view.additionalAddress))}</td></tr>
<tr><td>DOB</td><td>${shown(view.hirerDob ? formatUkDate(view.hirerDob) : "")}</td><td>${escape(blank(view.additionalDob) ? formatUkDate(view.additionalDob) : "")}</td></tr>
<tr><td>Driving licence number</td><td>${shown(view.licenceNumber)}</td><td>${escape(blank(view.additionalLicence))}</td></tr>
<tr><td>Date of issue</td><td>${shown(view.licenceIssuedOn ? formatUkDate(view.licenceIssuedOn) : "")}</td><td>${escape(blank(view.additionalLicenceIssuedOn) ? formatUkDate(view.additionalLicenceIssuedOn) : "")}</td></tr>
<tr><td>Date of expiry</td><td>${shown(view.licenceExpiresOn ? formatUkDate(view.licenceExpiresOn) : "")}</td><td>${escape(blank(view.additionalLicenceExpiresOn) ? formatUkDate(view.additionalLicenceExpiresOn) : "")}</td></tr>
</table>
<p>Delivery address: ${shown(view.deliveryAddress || view.hirerAddress)}</p>
<h3>Vehicle details</h3>
<p>Make: ${shown(view.hireMake)} &nbsp; Model: ${shown(view.hireModel)} &nbsp; Vehicle reg: ${shown(view.hireRegistration)}<br/>
Transmission: ${shown(view.hireTransmission)} &nbsp; Fuel: ${shown(view.hireFuel, "not entered")}<br/>
Group of vehicle supplied (not used for the rate): ${escape(gtaGroupLabel(view.suppliedGroup))}<br/>
Group Charged: ${shown(gtaGroupLabel(view.groupCharged) === GTA_NOT_CLASSIFIED ? "" : gtaGroupLabel(view.groupCharged))}<br/>
Client's own vehicle group (the rating group): ${escape(gtaGroupLabel(view.clientGroup))}<br/>
Date out: ${shown(dateOut)} &nbsp; Date in: ${escape(dateIn || "not entered")}<br/>
Mileage at delivery: ${shown(view.hireMileage, "not entered")} &nbsp; Fuel level at delivery: ${shown(view.hireFuelLevel, "not entered")}</p>
<h3>Charges</h3>
<table>${chargeRows}</table>
<p>All charges are subject to VAT at the current rate.</p>
<h3>Statement of liability</h3>
<p>When Your Own Vehicle has been damaged in an Accident which is not Your fault, You can hire a replacement of a similar standard from Us. You are responsible for the cost but We will finance it for a period of up to 51 weeks while the Third Party's insurer is pursued for the amounts due.</p>
<p>At the commencement of this agreement there is no estimate of the length of time You will need the vehicle, however the total charges under this agreement can be calculated by multiplying the number of days hired by the corresponding daily rental charge as detailed above. All charges are subject to VAT at the current rate.</p>
<p>Whilst the agreement is in force You will be liable as if You are the owner of the vehicle, or any replacement, for any fixed penalties and charges as set out in the Full Terms and Conditions howsoever incurred during the Rental Period. You also agree to pay Us an administration fee of £50.00 for each one that We have to transfer to You or pay on Your behalf. You are also required to return the vehicle in a clean and tidy condition at the end of the hire period and You agree to pay a valet fee of £75.00 if the vehicle is deemed excessively dirty.</p>
<p>This document sets out the terms of Your agreement with Us. You enter the agreement when You sign it. You should read it carefully first and if there is anything You do not understand You should seek legal advice.</p>
<p>This explanation is provided as a short summary only and the Definitions and Full Terms and Conditions provided to You within this agreement prevail over it.</p>
<h3>Declaration</h3>
<p>I hereby confirm that I have read and understood the summary above and the Full Terms and Conditions provided in conjunction with this agreement and that by signing I am entering into a contractual arrangement and agree to be bound by its terms. I acknowledge receipt of the notice of my right to cancel the agreement set out on page ${pageLabel(cancelPage)} of this agreement.</p>
<p>I wish the performance of this contract to begin before the expiry of the cancellation period. I understand that if I cancel this agreement within the cancellation period I shall become immediately liable to pay for all goods and services that were supplied in accordance with this agreement before the cancellation.</p>
<p>Signed by Hirer: ______________________ Date: ______________</p>
<p>Signed for and behalf of Complete Accident Solutions LTD: ______________________</p>
</section>` : ""}
<section>
<h2>Hire Agreement — ${pageLabel(termsPage)}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Agreement number: <strong>${agreement}</strong></p>
${CAS_HIRE_TERMS_HTML}
<p>Signed by Hirer: ______________________</p>
<p>Date of Agreement: ______________</p>
</section>
${view.includeStorageRecovery ? `<section>
<h2>Hire Agreement — ${pageLabel(storagePage)}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Agreement number: <strong>${agreement}</strong></p>
<h2>Storage &amp; Recovery Agreement</h2>
${storageGap}
<p>Name: ${shown(view.hirerName)}<br/>Address: ${shown(view.hirerAddress)}</p>
<h3>${OWN_VEHICLE_DETAILS_HEADING}</h3>
<p>This is the client's own vehicle being recovered and stored, not the hire vehicle.</p>
<p>Make: ${shown(view.clientMake)} &nbsp; Model: ${shown(view.clientModel)} &nbsp; Vehicle reg: ${shown(view.clientRegistration)}<br/>
GTA group: ${escape(gtaGroupLabel(view.clientGroup))}</p>
<p>Storage daily rate: ${escape(moneyOrNotEntered(view.storageDailyPence))} &nbsp; Recovery: ${escape(moneyOrNotEntered(view.recoveryPence))}</p>
<p>Mileage: ${escape(blank(view.ownMileage) || "not entered")} &nbsp; Fuel: ${escape(blank(view.ownFuel) || "not entered")}</p>
<p>Tyre depths NSF / OSF / NSR / OSR: ${escape(blank(view.ownTyres) || "not entered")}</p>
<p>Damage: ${escape(blank(view.ownDamage) || "not entered")}</p>
<p>I hereby confirm that the damage to the vehicle is marked above and may be supported by digital images taken at the time of collection by Complete Accident Solutions Ltd.</p>
<p>This STORAGE &amp; RECOVERY agreement is bound by the terms outlined in full in the accompanying Terms and Conditions and incur the charges as outlined above upon signing.</p>
<p>Complete Accident Solutions LTD will not accept responsibility for any valuables left in the vehicle at point of collection including removable car stereo and satellite navigation equipment.</p>
<p>Complete Accident Solutions LTD will not accept responsibility for any mechanical defects with the above vehicle whilst in their possession.</p>
<p>Complete Accident Solutions LTD accept responsibility for any PCNs corresponding to the above vehicle incurred between the DATE COLLECTED and DATE RETURNED as recorded above.</p>
<p>In the event that allegations are made against Complete Accident Solutions LTD with regards to damage being incurred to the above vehicle whilst in their possession the damage recorded on this form, digital images taken at the point of collection and return and possible engineering evidence will be used to refute or substantiate the allegations and copies of all paperwork provided to the client.</p>
<p>Signed by Hirer: ______________________</p>
<p>Signed for and on behalf of Complete Accident Solutions Ltd: ______________________</p>
</section>` : ""}
<section>
<h2>Hire Agreement — ${pageLabel(cancelPage)}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<h2>Notice of the Right to Cancel</h2>
<p>Date: ${shown(dateOut)}</p>
<p>"The Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008"</p>
<p>Name: ${shown(view.hirerName)}</p>
<p>Address: ${shown(view.hirerAddress)}</p>
<p>In accordance with the "The Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008" you have the right to cancel the Contract within 14 days from the date as presented on the contract by completing the section below and returning to Complete Accident Solutions Ltd. The 14 day period is determined from the date outlined on the Contract till the date of serving notice of cancellation.</p>
<p>The notice of cancellation will be deemed to be served as soon as it is posted or sent to Complete Accident Solutions Ltd or in the case of an electronic communication from the day it is sent to Complete Accident Solutions Ltd.</p>
<p>Upon safe receipt of the "Notice of the Right to Cancel" document a member of staff from Complete Accident Solutions Ltd will contact you by telephone within 2 hours in order to discuss any provisions already provided by Complete Accident Solutions Ltd which may include a replacement vehicle and or repairs to your vehicle. Cancellation of the contract will then be confirmed in writing and will be provided by hand or post within 24 hours.</p>
<p>Due to factors out of Complete Accident Solutions Ltd and your control with regards to the "Notice of the Right to Cancel" document not being received or received illegible if sent by Post, or Electronic Mail it remains your responsibility to ensure that Complete Accident Solutions Ltd are aware of your instruction to cancel the contract and therefore if you have not received a telephone call from Complete Accident Solutions Ltd within 24 hours if sent by Post or 2 hours if sent by Electronic Mail you are required to contact Complete Accident Solutions Ltd without any delay on (01792) 341069.</p>
<p>If you cancel the Contract within the cancellation period you will immediately become liable to pay for all goods and services that were supplied with the Contract before cancellation.</p>
<p>If the Contract includes the provision for repairs to your vehicle which have either commenced or parts ordered in anticipation of repairs being undertaken you will be responsible to meet any incurred costs and the nominated repairing garage are entitled to exercise Lien on your vehicle until any outstanding charges have been settled by you.</p>
<p>If further explanation or clarification of this document is required please either contact the HIRE ADMINISTRATION department as detailed below or seek independent legal advice.</p>
<p>You are not under any obligation to use the section below but it is your duty to ensure that the notice of cancellation that you send to us conveys your name, address, agreement number, signature and date of signing in order to ensure that it can administered without delay.</p>
<p>Acceptable methods of notifying Complete Accident Solutions Ltd of your intention to cancel the contract are by:</p>
<p>Post: Hire Administration, ${CAS_COMPANY.name}, 171 Cwmgarw Road, Brynamman, Ammanford, SA18 1DG</p>
<p>Electronic mail: ${CAS_COMPANY.email}</p>
<p>If you wish to cancel the contract you MUST DO SO IN WRITING and deliver personally or send (which may be by electronic mail) this to the address below. You may use this form if you want to but you do not have to.</p>
<p>(Complete, detach and return this form ONLY IF YOU WISH TO CANCEL THE CONTRACT.)</p>
<p>TO THE: HIRE ADMINISTRATION DEPARTMENT, COMPLETE ACCIDENT SOLUTIONS LTD, ${CAS_COMPANY.address}</p>
<p>Agreement number: <strong>${agreement}</strong></p>
<p>Name: ${shown(view.hirerName)}</p>
<p>Address: ${shown(view.hirerAddress)}</p>
<p>Signature: ______________________ Date: ______________</p>
<p>Generated ${escape(formatUkDateTime(nowUtcIso()))}. Signatures are not fabricated.</p>
</section>
</article>`;
}

export function getGtaMarkupPercent(): number {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_GTA_MARKUP_PERCENT]);
  const n = Number(row?.value);
  if (!Number.isFinite(n) || n < 0 || n > 500) return GTA_MARKUP_PERCENT_DEFAULT;
  return n;
}

export function setGtaMarkupPercent(raw: string) {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 500) {
    throw new Error("Enter a markup percentage from 0 to 500.");
  }
  const existing = get(`SELECT key FROM settings WHERE key = ?`, [SETTING_GTA_MARKUP_PERCENT]);
  if (existing) run(`UPDATE settings SET value = ? WHERE key = ?`, [String(n), SETTING_GTA_MARKUP_PERCENT]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_GTA_MARKUP_PERCENT, String(n)]);
}

export function parseGtaGroupField(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const code = normaliseGtaGroup(text);
  if (!code) throw new Error("Choose a GTA group from the list, or leave it not classified.");
  return code;
}

/** Writes the client's own GTA group and returns the rating group plus the daily rate to store. */
export function prepareHireRating(input: {
  claimId: string;
  clientGroupRaw: string;
  groupChargedRaw: string;
  dailyRateRaw: string;
  actorId?: string;
  overrideReason: string;
}): { groupCharged: string; dailyRatePence: number; dailyRateManual: number } {
  const clientGroup = parseGtaGroupField(input.clientGroupRaw);
  const vehicle = get<{ client_vehicle_id: string | null }>(
    `SELECT client_vehicle_id FROM claims WHERE id = ?`,
    [input.claimId],
  );
  if (vehicle?.client_vehicle_id) {
    run(`UPDATE vehicles SET gta_group = ? WHERE id = ?`, [clientGroup, vehicle.client_vehicle_id]);
  }
  const charged = parseGtaGroupField(input.groupChargedRaw) || clientGroup;
  const markup = getGtaMarkupPercent();
  const calculated = standardDailyRatePence(charged, markup);
  const raw = input.dailyRateRaw.trim();
  let dailyRatePence = calculated ?? 0;
  let dailyRateManual = 0;
  if (raw) {
    const submitted = Math.round(Number.parseFloat(raw) * 100);
    if (!Number.isFinite(submitted)) throw new Error("Enter the daily rate in pounds, or leave it blank to use the calculated rate.");
    dailyRatePence = submitted;
    dailyRateManual = calculated != null && submitted !== calculated ? 1 : 0;
  }
  if (input.actorId && groupChargedAboveClient(charged, clientGroup)) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_group_charged_override",
      occurredAt: nowUtcIso(),
      details: `Group Charged ${gtaGroupLabel(charged)} is above the client's own group ${gtaGroupLabel(clientGroup)}. Reason: ${input.overrideReason.trim() || "no reason recorded"}.`,
      actorId: input.actorId,
      source: "staff",
    });
  }
  return { groupCharged: charged || "", dailyRatePence, dailyRateManual };
}

function optionalPence(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function allocateHireAgreementNumber(claimId: string): string {
  const existing = get<{ hire_agreement_number: string | null }>(
    `SELECT hire_agreement_number FROM claims WHERE id = ?`,
    [claimId],
  );
  if (existing?.hire_agreement_number) return String(existing.hire_agreement_number);
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_NEXT_HIRE_AGREEMENT_NUMBER]);
  const sequence = Math.max(1, Number(row?.value || "1") || 1);
  const number = formatHireAgreementNumber(sequence);
  run(`UPDATE claims SET hire_agreement_number = ? WHERE id = ?`, [number, claimId]);
  const next = String(sequence + 1);
  if (row) run(`UPDATE settings SET value = ? WHERE key = ?`, [next, SETTING_NEXT_HIRE_AGREEMENT_NUMBER]);
  else run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_NEXT_HIRE_AGREEMENT_NUMBER, next]);
  return number;
}

export function buildHireAgreementView(
  pack: NonNullable<ReturnType<typeof getHirePack>>,
  agreementNumber: string,
  dailyRatePence: number | null,
): HireAgreementView {
  const s = pack.stored;
  const hire = pack.hire;
  const clientReg = String(pack.ctx.clientVehicleRegistration || "");
  return {
    agreementNumber,
    hirerName: String(pack.ctx.hirerName || ""),
    hirerAddress: String(pack.ctx.hirerAddress || ""),
    hirerDob: String(pack.ctx.hirerDob || ""),
    licenceNumber: String(pack.ctx.licenceNumber || ""),
    licenceIssuedOn: String(s.licence_issued_on || ""),
    licenceExpiresOn: String(s.licence_expires_on || ""),
    additionalName: String(s.additional_name || ""),
    additionalAddress: String(s.additional_address || ""),
    additionalDob: String(s.additional_dob || ""),
    additionalLicence: String(s.additional_licence || ""),
    additionalLicenceIssuedOn: String(s.additional_licence_issued_on || ""),
    additionalLicenceExpiresOn: String(s.additional_licence_expires_on || ""),
    deliveryAddress: String(s.delivery_address || pack.ctx.hirerAddress || ""),
    hireMake: String(hire?.hire_make || ""),
    hireModel: String(hire?.hire_model || ""),
    hireRegistration: String(hire?.hire_reg || ""),
    hireTransmission: String(hire?.hire_transmission || ""),
    hireFuel: String(s.hire_fuel || hire?.hire_fuel || ""),
    suppliedGroup: normaliseGtaGroup(String(hire?.supplied_gta_group || "")),
    clientGroup: normaliseGtaGroup(String(pack.claim.client_gta_group || "")),
    groupCharged: normaliseGtaGroup(String(s.group_charged || pack.claim.client_gta_group || "")),
    dateOut: String(s.date_out || hire?.started_at || ""),
    dateIn: String(s.date_in || ""),
    dailyRatePence,
    hireMileage: pack.handoverReadings?.hireDelivery ? formatHandoverMileage(pack.handoverReadings.hireDelivery.mileage) : "",
    hireFuelLevel: pack.handoverReadings?.hireDelivery?.fuelLabel || "",
    extras: {
      sat_nav: pack.packSaved ? optionalPence(s.sat_nav_pence) : null,
      additional_driver: pack.packSaved ? optionalPence(s.additional_driver_pence) : null,
      hands_free: pack.packSaved ? optionalPence(s.hands_free_pence) : null,
      cdw: pack.packSaved ? optionalPence(s.cdw_pence) : null,
      child_seat: pack.packSaved ? optionalPence(s.child_seat_pence) : null,
      automatic: pack.packSaved ? optionalPence(s.automatic_pence) : null,
      insurance_daily: pack.packSaved ? optionalPence(s.insurance_daily_pence) : null,
      estate: pack.packSaved ? optionalPence(s.estate_pence) : null,
      insurance: pack.packSaved ? optionalPence(s.insurance_pence) : null,
      tow_bar: pack.packSaved ? optionalPence(s.tow_bar_pence) : null,
      admin: pack.packSaved ? optionalPence(s.admin_pence) : null,
      roof_rack: pack.packSaved ? optionalPence(s.roof_rack_pence) : null,
      delivery_collection: pack.packSaved ? optionalPence(s.delivery_collection_pence) : null,
    },
    clientVehiclePresent: Boolean(clientReg && clientReg !== "Unknown"),
    clientMake: String(pack.clientMake || ""),
    clientModel: String(pack.clientModel || ""),
    clientRegistration: clientReg,
    ownMileage: pack.handoverReadings?.clientRecovery
      ? formatHandoverMileage(pack.handoverReadings.clientRecovery.mileage)
      : s.own_vehicle_mileage,
    ownFuel: pack.handoverReadings?.clientRecovery
      ? pack.handoverReadings.clientRecovery.fuelLabel
      : String(s.own_vehicle_fuel || ""),
    ownTyres: String(s.own_vehicle_tyres || ""),
    ownDamage: String(s.own_vehicle_damage || ""),
    storageDailyPence: pack.packSaved ? optionalPence(s.storage_daily_pence) : optionalPence(pack.claim.storage_rate_pence),
    recoveryPence: pack.packSaved ? optionalPence(s.recovery_pence) : null,
    overrideReason: String(s.group_override_reason || ""),
    includeHire: pack.parts.hire.included,
    includeStorageRecovery: pack.parts.storageRecovery.included,
    hireReason: pack.parts.hire.reason,
    storageReason: pack.parts.storageRecovery.reason,
    termsReason: pack.parts.termsAndCancel.reason,
  };
}

export function generateHireAgreementDocument(claimId: string, actorId: string, dailyRatePence: number | null) {
  const pack = getHirePack(claimId);
  if (!pack) throw new Error("File not found.");
  const agreementNumber = allocateHireAgreementNumber(claimId);
  const view = buildHireAgreementView(pack, agreementNumber, dailyRatePence);
  const html = renderHireAgreement(view);
  const missing = hireAgreementMissing(view);
  const versionRow = get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = ?`,
    [claimId, HIRE_AGREEMENT_TEMPLATE_KEY],
  );
  const version = Number(versionRow?.v || 0) + 1;
  const documentId = newId("doc");
  const title = `Hire Agreement ${agreementNumber}`;
  run(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, body_html, template_key, missing_json, created_by, created_at)
     VALUES (?, ?, ?, 'agreement', ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    [
      documentId,
      claimId,
      title,
      HIRE_AGREEMENT_DOCUMENT_TYPE,
      version,
      html,
      HIRE_AGREEMENT_TEMPLATE_KEY,
      JSON.stringify(missing),
      actorId,
      nowUtcIso(),
    ],
  );
  recordClaimEvent({
    claimId,
    eventType: "document_generated",
    occurredAt: nowUtcIso(),
    details: `${title} version ${version} filed. ${view.hireReason} ${view.storageReason}${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`,
    actorId,
    channel: "letter",
    documentId,
    source: "system",
  });
  return { documentId, missing, agreementNumber, view };
}

export function storedExtra(pack: HirePackData, key: keyof HirePackData): number | null {
  return optionalPence(pack[key]);
}

import { INDICATIVE_DEFAULTS } from "../constants";
import { accidentDateError, nowUtcIso, occurredFromForm, londonDateIso } from "../dates";
import { mobileNumberError } from "../phone-number";
import { clientDobKind, counterpartDobKind, dobSaveError } from "../age";
import { storageStartFromRecovery, recoveryChargeTotalPence } from "../domain/rules";
import { emailGateway } from "../email/gateway";
import { formatGbp, grossFromNet } from "../money";
import { whatsappGateway } from "../whatsapp/gateway";
import { readFormText } from "../text";
import { nextReference } from "./queries";
import { newId, run } from "./connection";
import { recordClaimEvent, requestScenePhotosWhatsApp } from "./chronology";
import {
  liabilityStatusLabel,
  normalizeLiabilityStatus,
  normalizeRoadworthiness,
  roadworthinessLabel,
} from "../domain/claim-status";
import { getDb } from "./connection";
import { rememberAgentOn, rememberInsurerOn } from "./insurers";

export type IntakePerson = {
  title?: string;
  forename?: string;
  surname?: string;
  postcode?: string;
  addressLine1?: string;
  town?: string;
  mobile?: string;
  otherTel?: string;
  skipOtherTel?: boolean;
  email?: string;
  dob?: string;
  dobConfirmed?: boolean;
};

export type IntakeVehicle = {
  registration?: string;
  make?: string;
  model?: string;
  colour?: string;
  gearbox?: string;
  fuel?: string;
  taxStatus?: string;
  motStatus?: string;
  insuranceStatus?: string;
  detailsMatch?: boolean;
  lookupIncomplete?: boolean;
};

export type IntakeThirdParty = {
  included: boolean;
  title?: string;
  forename?: string;
  surname?: string;
  postcode?: string;
  addressLine1?: string;
  town?: string;
  telephone?: string;
  vehicle: IntakeVehicle;
  insurerName?: string;
  insurerAddress?: string;
  insurerPostcode?: string;
  insurerTel?: string;
  insurerEmail?: string;
  policyNumber?: string;
  claimReference?: string;
  handlerName?: string;
  handlerEmail?: string;
  handlerTel?: string;
  agentName?: string;
  agentAddress?: string;
  agentPostcode?: string;
  agentTel?: string;
  agentEmail?: string;
  agentRef?: string;
  agentHandlerName?: string;
  agentHandlerEmail?: string;
  agentHandlerTel?: string;
  liabilityAdmitted?: string;
  midInsurer?: string;
};

export type IntakeInput = {
  handlerId: string;
  clientRole: string;
  client: IntakePerson;
  counterpart?: IntakePerson;
  vehicle: IntakeVehicle;
  damageDescription?: string;
  requestPhotosWhatsapp?: boolean;
  accidentDate?: string;
  accidentTime?: string;
  location?: string;
  circumstances?: string;
  policeAttended?: string;
  policeRef?: string;
  policeDetails?: string;
  witnesses?: string;
  witness?: { name?: string; telephone?: string; postcode?: string; addressLine1?: string; town?: string };
  photosAtScene?: string;
  requestScenePhotosWhatsapp?: boolean;
  weather?: string;
  journeyPurpose?: string;
  clientSpeed?: string;
  tpSpeed?: string;
  needsRecovery?: boolean;
  recovery?: {
    location?: string;
    date?: string;
    chargePence?: number;
    winchPence?: number;
    oohPence?: number;
    environmentalPence?: number;
    forkliftPence?: number;
    mileagePence?: number;
    manualPence?: number;
    inherited?: boolean;
    inheritedNote?: string;
    storageRatePence?: number;
    notifyDriverWhatsapp?: boolean;
    notifyClientWhatsapp?: boolean;
    sendAgreementChannel?: string;
  };
  thirdParties: IntakeThirdParty[];
  claimType?: string;
  roadworthiness?: string;
};

function blank(value: string | null | undefined): string {
  const t = (value || "").trim();
  return t || "Unknown";
}

function optional(value: string | null | undefined): string | null {
  const t = (value || "").trim();
  return t ? t : null;
}

export function personFullName(person: IntakePerson): string {
  const parts = [person.title, person.forename, person.surname].map((p) => (p || "").trim()).filter(Boolean);
  return parts.join(" ") || "Unknown";
}

export function accidentAtFromParts(date?: string, time?: string): string | undefined {
  const d = (date || "").trim();
  if (!d) return undefined;
  const t = (time || "").trim() || "00:00";
  return occurredFromForm(`${d}T${t.length === 5 ? t : "00:00"}`);
}

export function intakeFieldErrors(input: IntakeInput): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  const clientMobile = mobileNumberError(input.client.mobile);
  if (clientMobile) errors.push({ field: "client_mobile", message: clientMobile });
  const clientErr = dobSaveError(input.client.dob, clientDobKind(input.clientRole), Boolean(input.client.dobConfirmed));
  if (clientErr) errors.push({ field: "client_dob", message: clientErr });
  if (input.clientRole === "owner" || input.clientRole === "driver") {
    if (input.counterpart?.mobile) {
      const counterpartMobileErr = mobileNumberError(input.counterpart.mobile);
      if (counterpartMobileErr) errors.push({ field: "counterpart_mobile", message: counterpartMobileErr });
    }
    const counterpartErr = dobSaveError(
      input.counterpart?.dob,
      counterpartDobKind(input.clientRole),
      Boolean(input.counterpart?.dobConfirmed),
    );
    if (counterpartErr) errors.push({ field: "counterpart_dob", message: counterpartErr });
  }
  const accident = accidentDateError(input.accidentDate);
  if (accident) errors.push({ field: "accidentDate", message: accident });
  return errors;
}

export function intakeDateErrors(input: IntakeInput): string | null {
  return intakeFieldErrors(input)[0]?.message ?? null;
}

function insertPerson(person: IntakePerson, preferred: string | null) {
  const id = newId("person");
  const now = nowUtcIso();
  const fullName = personFullName(person);
  const mobile = optional(person.mobile);
  const other = person.skipOtherTel ? null : optional(person.otherTel);
  run(
    `INSERT INTO people(
      id, kind, full_name, title, forename, surname, date_of_birth, address_line1, town, postcode,
      telephone, email, preferred_channel, mobile_tel, home_tel, created_at
    ) VALUES (?, 'individual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fullName,
      optional(person.title),
      optional(person.forename),
      optional(person.surname),
      optional(person.dob),
      blank(person.addressLine1),
      optional(person.town),
      blank(person.postcode),
      mobile || other || "Unknown",
      optional(person.email),
      preferred,
      mobile,
      other,
      now,
    ],
  );
  return { id, fullName };
}

function insertVehicle(usage: string, vehicle: IntakeVehicle, provenance: string) {
  const id = newId("veh");
  const gearbox = (vehicle.gearbox || "").trim();
  const incomplete = vehicle.lookupIncomplete || !gearbox || gearbox === "unknown";
  run(
    `INSERT INTO vehicles(
      id, usage, registration, make, model, transmission, fuel, colour, lookup_source, lookup_incomplete,
      provenance, tax_status, mot_status, insurance_recorded, details_match_client
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      usage,
      blank(vehicle.registration),
      blank(vehicle.make),
      blank(vehicle.model),
      gearbox || "unknown",
      blank(vehicle.fuel),
      blank(vehicle.colour),
      vehicle.lookupIncomplete ? "simulated" : "manual",
      incomplete ? 1 : 0,
      provenance,
      optional(vehicle.taxStatus),
      optional(vehicle.motStatus),
      optional(vehicle.insuranceStatus),
      vehicle.detailsMatch ? 1 : 0,
    ],
  );
  return id;
}

function addClaimedLine(claimId: string, head: string, description: string, netPence: number) {
  if (!netPence) return;
  const { vat, gross } = grossFromNet(netPence);
  run(
    `INSERT INTO financial_lines(
      id, claim_id, head_of_loss, description, quantity, unit, rate_pence, net_pence, vat_pence, gross_pence,
      claimed_pence, offered_pence, agreed_pence, received_pence, offer_status
    ) VALUES (?, ?, ?, ?, 1, 'item', ?, ?, ?, ?, ?, 0, 0, 0, NULL)`,
    [newId("fin"), claimId, head, description, netPence, netPence, vat, gross, gross],
  );
}

function recoveryAgreementHtml(input: {
  fileReference: string;
  clientName: string;
  location: string;
  recoveredOn: string;
  storageRate: string;
  totalRecovery: string;
}): { html: string; missing: string[] } {
  const missing: string[] = [];
  if (input.clientName === "Unknown") missing.push("Client name");
  if (input.location === "Unknown") missing.push("Recovery location");
  if (input.recoveredOn === "Unknown") missing.push("Recovery date");
  const html = `
    <article class="letter hire-pack">
      <header>
        <p><strong>Complete Accident Solutions Ltd</strong></p>
        <p>Storage &amp; Recovery Agreement — ${escapeHtml(input.fileReference)}-SR</p>
      </header>
      <p class="text-sm">Standalone document. It is not a page of a Hire Agreement and does not require a hire agreement on the file. Solicitor-reviewed standalone wording is still to come. This page records the facts captured on intake. It is not a signed contract and has not been executed.</p>
      <h3>Your Own Vehicle Details</h3>
      <p>This is the client's own damaged vehicle being recovered and stored — not a hire vehicle.</p>
      <p>Client: ${escapeHtml(input.clientName)}</p>
      <p>Recovery location: ${escapeHtml(input.location)}</p>
      <p>Recovery date: ${escapeHtml(input.recoveredOn)}</p>
      <p>Recovery charges recorded (net extras as entered): ${escapeHtml(input.totalRecovery)}</p>
      <p>Storage rate: ${escapeHtml(input.storageRate)} per day. Storage starts on the same day as recovery. The storage billing end date is recorded separately and is not invented here.</p>
      <p>Signature: not recorded. Unsigned documents stay unsigned.</p>
    </article>
  `;
  return { html, missing };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function simulateWhatsApp(claimId: string, handlerId: string, to: string, body: string, subject: string) {
  const result = await whatsappGateway.send({ to, body });
  const now = nowUtcIso();
  run(
    `INSERT INTO correspondence(
      id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at
    ) VALUES (?, ?, 'outgoing', 'whatsapp', ?, ?, ?, ?, 'CAS prototype', 0, ?, ?)`,
    [newId("corr"), claimId, subject, body.slice(0, 180), body, to, result.ok ? result.status : result.status, now],
  );
  recordClaimEvent({
    claimId,
    eventType: "outgoing_whatsapp",
    occurredAt: now,
    details: result.ok ? `${subject} (simulated WhatsApp). ${result.warning}` : `${subject} failed: ${result.error}`,
    actorId: handlerId,
    channel: "whatsapp",
    source: "staff",
  });
  return result;
}

export async function createClaimFromIntake(input: IntakeInput) {
  const clientName = personFullName(input.client);
  if (!input.client.forename?.trim() && !input.client.surname?.trim() && clientName === "Unknown") {
    throw new Error("Client forename or surname is required.");
  }
  const dateError = intakeDateErrors(input);
  if (dateError) throw new Error(dateError);

  const id = newId("claim");
  const now = nowUtcIso();
  const ref = nextReference();
  const accidentAt = accidentAtFromParts(input.accidentDate, input.accidentTime);
  const clientPerson = insertPerson(input.client, "phone");
  const vehicleId = insertVehicle("client", input.vehicle, "staff");

  let counterpartId: string | undefined;
  const role = input.clientRole || "owner_driver";
  if ((role === "owner" || role === "driver") && input.counterpart) {
    const hasCounterpart =
      Boolean(input.counterpart.forename?.trim() || input.counterpart.surname?.trim() || input.counterpart.mobile?.trim());
    if (hasCounterpart) counterpartId = insertPerson(input.counterpart, "phone").id;
  }

  const recoveryAt = input.needsRecovery && input.recovery?.date ? occurredFromForm(input.recovery.date) : null;
  const storageStarted = storageStartFromRecovery(recoveryAt);
  const storageRate =
    input.recovery?.storageRatePence && input.recovery.storageRatePence > 0
      ? input.recovery.storageRatePence
      : INDICATIVE_DEFAULTS.storage_per_day_net_pence;

  const recoveryStatus = recoveryAt ? "completed" : input.needsRecovery ? "required" : "none";
  const storageStatus = storageStarted ? "active" : "none";

  run(
    `INSERT INTO claims(
      id, file_reference, created_at, updated_at, accident_at, accident_location, circumstances,
      claim_type, cas_liability_assessment, insurer_liability_position, roadworthiness, current_position,
      handler_id, next_action, next_action_due, client_person_id, client_vehicle_id,
      incomplete_client_submission, is_new_enquiry, repair_status, engineering_status, hire_status,
      recovery_status, storage_status, salvage_status, total_loss, payment_qualifies_off_hire,
      repairs_complete, repaired_vehicle_returned, client_form_status, later_declared_total_loss, replacement_need_review,
      client_role, damage_description, police_attended, police_ref, police_details, weather_conditions,
      journey_purpose, client_speed, tp_speed, needs_recovery, photos_at_scene, photos_whatsapp_status, other_contact_skipped,
      storage_started_on, storage_rate_pence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'pending', ?, ?, ?, ?, ?, ?, ?, 0, 1, 'not_applicable', 'not_instructed', 'none', ?, ?, 'none', 0, 0, 0, 0, 'staff_complete', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ref,
      now,
      now,
      accidentAt || null,
      blank(input.location),
      blank(input.circumstances),
      normalizeLiabilityStatus(input.claimType),
      normalizeRoadworthiness(input.roadworthiness),
      "New enquiry — intake captured",
      input.handlerId || "staff-sian",
      input.needsRecovery ? "Arrange or confirm recovery and replacement transport" : "Review new file",
      now,
      clientPerson.id,
      vehicleId,
      recoveryStatus,
      storageStatus,
      role,
      optional(input.damageDescription),
      optional(input.policeAttended),
      optional(input.policeRef),
      optional(input.policeDetails),
      optional(input.weather),
      optional(input.journeyPurpose),
      optional(input.clientSpeed),
      optional(input.tpSpeed),
      input.needsRecovery ? 1 : 0,
      optional(input.photosAtScene),
      input.requestPhotosWhatsapp || input.requestScenePhotosWhatsapp ? "requested_simulated" : null,
      input.client.skipOtherTel ? 1 : 0,
      storageStarted,
      input.needsRecovery ? storageRate : null,
    ],
  );

  run(`INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, 'client', 1)`, [
    newId("party"),
    id,
    clientPerson.id,
  ]);
  if (role === "owner_driver" || role === "driver") {
    run(`INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, 'driver', 1)`, [
      newId("party"),
      id,
      clientPerson.id,
    ]);
  }
  if (role === "owner_driver" || role === "owner") {
    run(`INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, 'vehicle_owner', 1)`, [
      newId("party"),
      id,
      clientPerson.id,
    ]);
  }
  if (counterpartId) {
    const counterpartRole = role === "owner" ? "driver" : "vehicle_owner";
    run(`INSERT INTO claim_parties(id, claim_id, person_id, role, is_primary) VALUES (?, ?, ?, ?, 0)`, [
      newId("party"),
      id,
      counterpartId,
      counterpartRole,
    ]);
  }

  run(
    `INSERT INTO vehicle_compliance_checks(
      id, claim_id, vehicle_id, registration, checked_at, tax_status, mot_status, insurance_status,
      details_match, source, notes, checker_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated', ?, ?)`,
    [
      newId("comp"),
      id,
      vehicleId,
      blank(input.vehicle.registration),
      now,
      optional(input.vehicle.taxStatus),
      optional(input.vehicle.motStatus),
      optional(input.vehicle.insuranceStatus),
      input.vehicle.detailsMatch ? "yes" : "unchecked",
      "Prototype tax/MOT result. Insurance is unknown until an authorised AskMID / MID result is recorded.",
      input.handlerId,
    ],
  );

  if (input.witnesses === "yes" && (input.witness?.name || input.witness?.telephone)) {
    run(
      `INSERT INTO claim_witnesses(id, claim_id, full_name, telephone, postcode, address_line1, town, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("wit"),
        id,
        blank(input.witness?.name),
        optional(input.witness?.telephone),
        optional(input.witness?.postcode),
        optional(input.witness?.addressLine1),
        optional(input.witness?.town),
        now,
      ],
    );
  }

  for (const [index, tp] of input.thirdParties.entries()) {
    if (!tp.included) continue;
    const empty =
      !tp.forename?.trim() &&
      !tp.surname?.trim() &&
      !tp.vehicle.registration?.trim() &&
      !tp.insurerName?.trim();
    if (empty) continue;
    const person = insertPerson(
      {
        title: tp.title,
        forename: tp.forename,
        surname: tp.surname,
        postcode: tp.postcode,
        addressLine1: tp.addressLine1,
        town: tp.town,
        mobile: tp.telephone,
        email: tp.insurerEmail,
      },
      null,
    );
    const tpVehicleId = insertVehicle("third_party", tp.vehicle, "staff");
    run(
      `INSERT INTO claim_third_parties(
        id, claim_id, person_id, vehicle_id, insurer_name, insurer_ref, representative, nomination_date, sequence,
        insurer_address, insurer_postcode, insurer_tel, insurer_email, policy_number, handler_name, handler_email,
        handler_tel, agent_name, agent_address, agent_postcode, agent_tel, agent_email, agent_ref, agent_handler_name,
        agent_handler_email, agent_handler_tel, liability_admitted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("tp"),
        id,
        person.id,
        tpVehicleId,
        optional(tp.insurerName),
        optional(tp.claimReference),
        optional(tp.agentName),
        index + 1,
        optional(tp.insurerAddress),
        optional(tp.insurerPostcode),
        optional(tp.insurerTel),
        optional(tp.insurerEmail),
        optional(tp.policyNumber),
        optional(tp.handlerName),
        optional(tp.handlerEmail),
        optional(tp.handlerTel),
        optional(tp.agentName),
        optional(tp.agentAddress),
        optional(tp.agentPostcode),
        optional(tp.agentTel),
        optional(tp.agentEmail),
        optional(tp.agentRef),
        optional(tp.agentHandlerName),
        optional(tp.agentHandlerEmail),
        optional(tp.agentHandlerTel),
        optional(tp.liabilityAdmitted),
      ],
    );
    rememberInsurerOn(getDb(), {
      name: tp.insurerName || "",
      address: tp.insurerAddress || "",
      postcode: tp.insurerPostcode || "",
      telephone: tp.insurerTel || "",
      email: tp.insurerEmail || "",
    });
    rememberAgentOn(getDb(), {
      name: tp.agentName || "",
      address: tp.agentAddress || "",
      postcode: tp.agentPostcode || "",
      telephone: tp.agentTel || "",
      email: tp.agentEmail || "",
      handlerName: tp.agentHandlerName || "",
      handlerEmail: tp.agentHandlerEmail || "",
      handlerTel: tp.agentHandlerTel || "",
    });
    if (tp.midInsurer || tp.insurerName) {
      run(
        `INSERT INTO mid_lookups(id, claim_id, registration, accident_on, lookup_on, insurer, checker_id, evidence, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
        [
          newId("mid"),
          id,
          blank(tp.vehicle.registration),
          accidentAt ? londonDateIso(new Date(accidentAt)) : null,
          now,
          optional(tp.midInsurer) || optional(tp.insurerName),
          input.handlerId,
          "Staff-recorded AskMID / MID result. Not scraped.",
        ],
      );
    }
    run(
      `INSERT INTO vehicle_compliance_checks(
        id, claim_id, vehicle_id, registration, checked_at, tax_status, mot_status, insurance_status,
        details_match, source, notes, checker_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated', 'Third-party vehicle check. Insurance recorded separately via authorised MID.', ?)`,
      [
        newId("comp"),
        id,
        tpVehicleId,
        blank(tp.vehicle.registration),
        now,
        optional(tp.vehicle.taxStatus),
        optional(tp.vehicle.motStatus),
        optional(tp.vehicle.insuranceStatus) || optional(tp.midInsurer),
        tp.vehicle.detailsMatch ? "yes" : "unchecked",
        input.handlerId,
      ],
    );
  }

  let agreementDocumentId: string | null = null;
  if (input.needsRecovery && input.recovery) {
    const parts = {
      charge: input.recovery.chargePence || 0,
      winch: input.recovery.winchPence || 0,
      ooh: input.recovery.oohPence || 0,
      environmental: input.recovery.environmentalPence || 0,
      forklift: input.recovery.forkliftPence || 0,
      mileage: input.recovery.mileagePence || 0,
      manual: input.recovery.manualPence || 0,
    };
    const total = recoveryChargeTotalPence(parts);
    const recId = newId("rec");
    if (total) addClaimedLine(id, "recovery", "Recovery charges as entered on intake", total);
    if (input.recovery.inherited) {
      run(
        `INSERT INTO notes(id, claim_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        [
          newId("note"),
          id,
          input.handlerId,
          `Inherited recovery charge recorded. ${input.recovery.inheritedNote || "Receipt to be filed. Amount not invented."}`,
          now,
        ],
      );
    }

    if (input.recovery.sendAgreementChannel && input.recovery.sendAgreementChannel !== "none") {
      const pack = recoveryAgreementHtml({
        fileReference: ref,
        clientName: clientPerson.fullName,
        location: blank(input.recovery.location),
        recoveredOn: recoveryAt ? londonDateIso(new Date(recoveryAt)) : "Unknown",
        storageRate: formatGbp(storageRate),
        totalRecovery: formatGbp(total),
      });
      agreementDocumentId = newId("doc");
      run(
        `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
         VALUES (?, ?, ?, 'agreement', 1, 0, 1, ?, 'recovery_storage_agreement', ?, ?)`,
        [
          agreementDocumentId,
          id,
          `Credit recovery and storage agreement — ${ref}`,
          pack.html,
          JSON.stringify(pack.missing),
          now,
        ],
      );
    }

    run(
      `INSERT INTO recovery_jobs(
        id, claim_id, location, recovered_at, charge_pence, winch_pence, ooh_pence, environmental_pence,
        forklift_pence, mileage_pence, manual_pence, inherited, inherited_note, driver_whatsapp_status,
        client_whatsapp_status, agreement_status, agreement_channel, agreement_document_id, storage_started_on,
        storage_rate_pence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recId,
        id,
        optional(input.recovery.location),
        recoveryAt,
        parts.charge,
        parts.winch,
        parts.ooh,
        parts.environmental,
        parts.forklift,
        parts.mileage,
        parts.manual,
        input.recovery.inherited ? 1 : 0,
        optional(input.recovery.inheritedNote),
        input.recovery.notifyDriverWhatsapp ? "simulated_queued" : null,
        input.recovery.notifyClientWhatsapp ? "simulated_queued" : null,
        agreementDocumentId ? "unsigned_simulated" : null,
        optional(input.recovery.sendAgreementChannel),
        agreementDocumentId,
        storageStarted,
        storageRate,
      ],
    );
  }

  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'create', 'claim', ?, ?)`, [
    newId("audit"),
    now,
    input.handlerId,
    id,
    `Intake captured ${ref}`,
  ]);
  recordClaimEvent({
    claimId: id,
    eventType: "file_opened",
    occurredAt: now,
    details: `File ${ref} opened from staff intake.`,
    actorId: input.handlerId,
    channel: "system",
    source: "system",
  });
  const liability = normalizeLiabilityStatus(input.claimType);
  if (liability) {
    recordClaimEvent({
      claimId: id,
      eventType: "liability_status_changed",
      occurredAt: now,
      details: `Set to ${liabilityStatusLabel(liability)}.`,
      actorId: input.handlerId,
      source: "staff",
    });
  }
  const roadworthiness = normalizeRoadworthiness(input.roadworthiness);
  if (roadworthiness) {
    recordClaimEvent({
      claimId: id,
      eventType: "roadworthiness_changed",
      occurredAt: now,
      details: `Set to ${roadworthinessLabel(roadworthiness)}.`,
      actorId: input.handlerId,
      source: "staff",
    });
  }
  if (accidentAt) {
    recordClaimEvent({
      claimId: id,
      eventType: "accident",
      occurredAt: accidentAt,
      details: input.location || "Unknown",
      actorId: input.handlerId,
      source: "staff",
    });
  }
  if (recoveryAt) {
    recordClaimEvent({
      claimId: id,
      eventType: "recovery_completed",
      occurredAt: recoveryAt,
      details: input.recovery?.location || "Unknown",
      actorId: input.handlerId,
      source: "staff",
    });
    recordClaimEvent({
      claimId: id,
      eventType: "storage_started",
      occurredAt: recoveryAt,
      details: "Storage starts the same day as recovery. Billing end is not set automatically.",
      actorId: input.handlerId,
      source: "system",
    });
  }

  if (input.requestPhotosWhatsapp && input.client.mobile) {
    await simulateWhatsApp(
      id,
      input.handlerId,
      input.client.mobile,
      `Please send photographs of the damage on ${blank(input.vehicle.registration)} for file ${ref}. Complete Accident Solutions.`,
      "Request damage photographs",
    );
  }
  if (input.photosAtScene === "yes" && input.requestScenePhotosWhatsapp) {
    if (input.client.mobile) {
      await requestScenePhotosWhatsApp(id, input.handlerId);
    } else {
      recordClaimEvent({
        claimId: id,
        eventType: "other",
        occurredAt: now,
        details: "Photographs were taken at the scene, but no mobile number was recorded so WhatsApp was not requested.",
        actorId: input.handlerId,
        source: "staff",
      });
    }
  }

  if (input.needsRecovery && input.recovery?.notifyDriverWhatsapp) {
    await simulateWhatsApp(
      id,
      input.handlerId,
      "recovery-driver (prototype)",
      `Recovery job ${ref}. Client ${clientPerson.fullName}, mobile ${input.client.mobile || "Unknown"}, location ${input.recovery.location || input.location || "Unknown"}.`,
      "Recovery job to driver",
    );
  }
  if (input.needsRecovery && input.recovery?.notifyClientWhatsapp && input.client.mobile) {
    await simulateWhatsApp(
      id,
      input.handlerId,
      input.client.mobile,
      `A recovery driver is on the way to ${input.recovery.location || input.location || "the recorded location"}. Complete Accident Solutions. File ${ref}.`,
      "Recovery on the way",
    );
  }
  if (agreementDocumentId && input.recovery?.sendAgreementChannel && input.recovery.sendAgreementChannel !== "none") {
    const channel = input.recovery.sendAgreementChannel;
    const body = `Please read and sign the credit recovery and storage agreement for file ${ref}. Prototype: not a live send. Unsigned copies stay unsigned.`;
    if (channel === "email" || channel === "both") {
      const send = await emailGateway.send({
        to: input.client.email || "unknown@example.invalid",
        subject: `Our ref: ${ref}  Recovery and storage agreement`,
        body,
      });
      run(
        `INSERT INTO correspondence(
          id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at
        ) VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, 'CAS prototype', 0, ?, ?)`,
        [
          newId("corr"),
          id,
          `Our ref: ${ref}  Recovery and storage agreement`,
          body,
          body,
          input.client.email || "Unknown",
          send.ok ? send.status : send.status,
          now,
        ],
      );
    }
    if ((channel === "whatsapp" || channel === "both") && input.client.mobile) {
      await simulateWhatsApp(id, input.handlerId, input.client.mobile, body, "Recovery and storage agreement");
    }
  }

  return { id, fileReference: ref, hireStatus: "none" as const, chargesStarted: false };
}

export function poundsToPence(raw: string | null | undefined): number {
  const t = (raw || "").trim();
  if (!t) return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formFlag(formData: FormData, name: string): boolean {
  const v = formData.get(name);
  return v === "yes" || v === "on" || v === "true";
}

export function personFromForm(formData: FormData, prefix: string): IntakePerson {
  return {
    title: String(formData.get(`${prefix}title`) || ""),
    forename: readFormText(formData, `${prefix}forename`),
    surname: readFormText(formData, `${prefix}surname`),
    postcode: readFormText(formData, `${prefix}postcode`),
    addressLine1: readFormText(formData, `${prefix}address`),
    town: readFormText(formData, `${prefix}town`),
    mobile: readFormText(formData, `${prefix}mobile`),
    otherTel: readFormText(formData, `${prefix}otherTel`),
    skipOtherTel: formFlag(formData, `${prefix}skipOtherTel`),
    email: readFormText(formData, `${prefix}email`),
    dob: String(formData.get(`${prefix}dob`) || ""),
    dobConfirmed: formFlag(formData, `${prefix}dob_confirmed`),
  };
}

export function vehicleFromForm(formData: FormData, prefix: string): IntakeVehicle {
  return {
    registration: readFormText(formData, `${prefix}registration`),
    make: readFormText(formData, `${prefix}make`),
    model: readFormText(formData, `${prefix}model`),
    colour: readFormText(formData, `${prefix}colour`),
    gearbox: String(formData.get(`${prefix}gearbox`) || ""),
    fuel: readFormText(formData, `${prefix}fuel`),
    taxStatus: readFormText(formData, `${prefix}taxStatus`),
    motStatus: readFormText(formData, `${prefix}motStatus`),
    insuranceStatus: readFormText(formData, `${prefix}insuranceStatus`),
    detailsMatch: formFlag(formData, `${prefix}detailsMatch`),
    lookupIncomplete: formFlag(formData, `${prefix}lookupIncomplete`),
  };
}

export function thirdPartyFromForm(formData: FormData, prefix: string, included: boolean): IntakeThirdParty {
  return {
    included,
    title: String(formData.get(`${prefix}title`) || ""),
    forename: readFormText(formData, `${prefix}forename`),
    surname: readFormText(formData, `${prefix}surname`),
    postcode: readFormText(formData, `${prefix}postcode`),
    addressLine1: readFormText(formData, `${prefix}address`),
    town: readFormText(formData, `${prefix}town`),
    telephone: readFormText(formData, `${prefix}telephone`),
    vehicle: vehicleFromForm(formData, `${prefix}veh_`),
    insurerName: readFormText(formData, `${prefix}insurerName`),
    insurerAddress: readFormText(formData, `${prefix}insurerAddress`),
    insurerPostcode: readFormText(formData, `${prefix}insurerPostcode`),
    insurerTel: readFormText(formData, `${prefix}insurerTel`),
    insurerEmail: readFormText(formData, `${prefix}insurerEmail`),
    policyNumber: String(formData.get(`${prefix}policyNumber`) || ""),
    claimReference: String(formData.get(`${prefix}claimReference`) || ""),
    handlerName: readFormText(formData, `${prefix}handlerName`),
    handlerEmail: readFormText(formData, `${prefix}handlerEmail`),
    handlerTel: readFormText(formData, `${prefix}handlerTel`),
    agentName: readFormText(formData, `${prefix}agentName`),
    agentAddress: readFormText(formData, `${prefix}agentAddress`),
    agentPostcode: readFormText(formData, `${prefix}agentPostcode`),
    agentTel: readFormText(formData, `${prefix}agentTel`),
    agentEmail: readFormText(formData, `${prefix}agentEmail`),
    agentRef: String(formData.get(`${prefix}agentRef`) || ""),
    agentHandlerName: readFormText(formData, `${prefix}agentHandlerName`),
    agentHandlerEmail: readFormText(formData, `${prefix}agentHandlerEmail`),
    agentHandlerTel: readFormText(formData, `${prefix}agentHandlerTel`),
    liabilityAdmitted: String(formData.get(`${prefix}liabilityAdmitted`) || ""),
    midInsurer: readFormText(formData, `${prefix}midInsurer`),
  };
}

export function intakeFromFormData(formData: FormData): IntakeInput {
  const needsRecovery = formFlag(formData, "needsRecovery");
  const includeTp2 = formFlag(formData, "includeTp2");
  const includeTp3 = formFlag(formData, "includeTp3");
  return {
    handlerId: String(formData.get("handlerId") || "staff-sian"),
    clientRole: String(formData.get("clientRole") || "owner_driver"),
    client: personFromForm(formData, "client_"),
    counterpart: personFromForm(formData, "counterpart_"),
    vehicle: vehicleFromForm(formData, "veh_"),
    damageDescription: readFormText(formData, "damageDescription"),
    requestPhotosWhatsapp: formFlag(formData, "requestPhotosWhatsapp"),
    accidentDate: String(formData.get("accidentDate") || ""),
    accidentTime: String(formData.get("accidentTime") || ""),
    location: readFormText(formData, "location"),
    circumstances: readFormText(formData, "circumstances"),
    policeAttended: String(formData.get("policeAttended") || ""),
    policeRef: String(formData.get("policeRef") || ""),
    policeDetails: readFormText(formData, "policeDetails"),
    witnesses: String(formData.get("witnesses") || "no"),
    witness: {
      name: readFormText(formData, "witness_name"),
      telephone: readFormText(formData, "witness_telephone"),
      postcode: readFormText(formData, "witness_postcode"),
      addressLine1: readFormText(formData, "witness_address"),
      town: readFormText(formData, "witness_town"),
    },
    photosAtScene: String(formData.get("photosAtScene") || "no"),
    requestScenePhotosWhatsapp: formFlag(formData, "requestScenePhotosWhatsapp"),
    weather: readFormText(formData, "weather"),
    journeyPurpose: readFormText(formData, "journeyPurpose"),
    clientSpeed: String(formData.get("clientSpeed") || ""),
    tpSpeed: String(formData.get("tpSpeed") || ""),
    needsRecovery,
    recovery: {
      location: readFormText(formData, "recoveryLocation"),
      date: String(formData.get("recoveryDate") || ""),
      chargePence: poundsToPence(String(formData.get("recoveryCharge") || "")),
      winchPence: poundsToPence(String(formData.get("recoveryWinch") || "")),
      oohPence: poundsToPence(String(formData.get("recoveryOoh") || "")),
      environmentalPence: poundsToPence(String(formData.get("recoveryEnvironmental") || "")),
      forkliftPence: poundsToPence(String(formData.get("recoveryForklift") || "")),
      mileagePence: poundsToPence(String(formData.get("recoveryMileage") || "")),
      manualPence: poundsToPence(String(formData.get("recoveryManual") || "")),
      inherited: formFlag(formData, "inheritedRecovery"),
      inheritedNote: readFormText(formData, "inheritedNote"),
      storageRatePence: poundsToPence(String(formData.get("storageRate") || "")),
      notifyDriverWhatsapp: formFlag(formData, "notifyDriverWhatsapp"),
      notifyClientWhatsapp: formFlag(formData, "notifyClientWhatsapp"),
      sendAgreementChannel: String(formData.get("agreementChannel") || "none"),
    },
    thirdParties: [
      thirdPartyFromForm(formData, "tp1_", true),
      thirdPartyFromForm(formData, "tp2_", includeTp2),
      thirdPartyFromForm(formData, "tp3_", includeTp3),
    ],
    claimType: normalizeLiabilityStatus(String(formData.get("claimType") || "")),
    roadworthiness: normalizeRoadworthiness(String(formData.get("roadworthiness") || "")),
  };
}

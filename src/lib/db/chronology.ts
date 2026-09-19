import { emailGateway } from "../email/gateway";
import { phoneGateway } from "../phone/gateway";
import { whatsappGateway } from "../whatsapp/gateway";
import { scenePhotosWhatsAppBody, scenePhotosWhatsAppSubject } from "../whatsapp/scene-photos";
import { CAS_CLAIMS_MAILBOX, ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT } from "../constants";
import { eventLabel, latestDates, type ClaimEventType } from "../domain/events";
import { agreementDayNumber, hireChargesAccrualEnd } from "../domain/rules";
import { channelForTemplate, eventTypeForTemplate, isDocumentTemplateKey, type DocumentTemplateKey } from "../documents/catalog";
import {
  CAS_TEMPLATE_NOTICE,
  OPERATIONAL_DRAFT_NOTICE,
  emptyCorrespondenceFields,
  namesDiffer,
  summariseLossesClaimed,
  type CorrespondenceContext,
} from "../documents/correspondence";
import { generateEmail, isEmailTemplateKey } from "../documents/email-templates";
import { generateLetter, isLetterTemplateKey, type LetterTemplateKey } from "../documents/templates";
import { nowUtcIso, occurredFromForm } from "../dates";
import { blankInsurerField } from "../insurers";
import { all, get, getDb, newId, run } from "./connection";
import { ENGINEER_INSTRUCTION_MARKED_SENT, ENGINEER_INSTRUCTION_PREPARED, getEngineer, setClaimEngineer } from "./engineers";
import { findKnownInsurerOn } from "./insurers";
import { buildMailtoHref } from "../email/mailto";

export type ClaimEventRow = {
  id: string;
  claim_id: string;
  event_type: string;
  title: string;
  details: string | null;
  occurred_at: string;
  recorded_at: string;
  actor_id: string | null;
  actor_name: string | null;
  channel: string | null;
  document_id: string | null;
  correspondence_id: string | null;
  source: string;
};

export function listClaimEvents(claimId: string): ClaimEventRow[] {
  return all<ClaimEventRow>(
    `SELECT e.*, s.name AS actor_name
     FROM claim_events e
     LEFT JOIN staff s ON s.id = e.actor_id
     WHERE e.claim_id = ?
     ORDER BY e.occurred_at ASC, e.recorded_at ASC`,
    [claimId],
  );
}

export function recordClaimEvent(input: {
  claimId: string;
  eventType: string;
  occurredAt: string;
  details?: string;
  actorId?: string;
  channel?: string;
  documentId?: string;
  correspondenceId?: string;
  source?: string;
}) {
  const id = newId("event");
  const now = nowUtcIso();
  const title = eventLabel(input.eventType);
  run(
    `INSERT INTO claim_events(
      id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel,
      document_id, correspondence_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      input.eventType,
      title,
      input.details || null,
      occurredFromForm(input.occurredAt),
      now,
      input.actorId || null,
      input.channel || null,
      input.documentId || null,
      input.correspondenceId || null,
      input.source || "staff",
    ],
  );
  applyEventSideEffects(input.claimId, input.eventType as ClaimEventType, occurredFromForm(input.occurredAt));
  run(`UPDATE claims SET updated_at = ? WHERE id = ?`, [now, input.claimId]);
  return id;
}

function applyEventSideEffects(claimId: string, eventType: ClaimEventType, occurredAt: string) {
  if (eventType === "engineer_instructed") {
    run(
      `UPDATE claims SET engineering_status = CASE WHEN engineering_status IN ('report_received') THEN engineering_status ELSE 'instructed' END, last_correspondence_at = COALESCE(last_correspondence_at, ?) WHERE id = ?`,
      [occurredAt, claimId],
    );
  }
  if (eventType === "engineer_report_received") {
    run(`UPDATE claims SET engineering_status = 'report_received' WHERE id = ?`, [claimId]);
  }
  if (eventType === "repairs_started") {
    run(`UPDATE claims SET repair_status = 'in_progress' WHERE id = ?`, [claimId]);
  }
  if (eventType === "repairs_complete") {
    run(`UPDATE claims SET repairs_complete = 1, repair_status = CASE WHEN repaired_vehicle_returned = 1 THEN 'complete' ELSE 'awaiting_return' END WHERE id = ?`, [claimId]);
  }
  if (
    eventType === "initial_letter_tp_insurer" ||
    eventType === "initial_letter_own_insurer" ||
    eventType === "outgoing_email" ||
    eventType === "incoming_email" ||
    eventType === "liability_chase_sent" ||
    eventType === "client_welcome_sent" ||
    eventType === "hire_pack_sent" ||
    eventType === "payment_chase_1_sent" ||
    eventType === "payment_chase_2_sent" ||
    eventType === "rebuttal_sent" ||
    eventType === "total_loss_cessation_sent" ||
    eventType === "client_total_loss_update_sent" ||
    eventType === "client_status_update_sent" ||
    eventType === "vehicle_ready_notice_sent" ||
    eventType === "internal_chase_sent" ||
    eventType === "outgoing_whatsapp" ||
    eventType === "incoming_whatsapp" ||
    eventType === "outgoing_call" ||
    eventType === "incoming_call"
  ) {
    run(`UPDATE claims SET last_correspondence_at = ? WHERE id = ?`, [occurredAt, claimId]);
  }
  if (eventType === "hire_started") {
    run(`UPDATE claims SET hire_status = CASE WHEN hire_status = 'ended' THEN hire_status ELSE 'active' END WHERE id = ?`, [claimId]);
  }
}

function letterContext(claimId: string, letterDate: string, engineerId?: string): CorrespondenceContext {
  const claim = get<Record<string, string | number | null>>(
    `SELECT c.*, s.name AS handler_name, s.id AS handler_staff_id,
            p.full_name AS client_name, p.email AS client_email, p.telephone AS client_telephone,
            v.registration, v.make, v.model
     FROM claims c
     LEFT JOIN staff s ON s.id = c.handler_id
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  if (!claim) throw new Error("File not found.");
  const tp = get<Record<string, string | null>>(
    `SELECT tp.insurer_name, tp.insurer_ref, tp.insurer_email, tp.handler_email, tp.policy_number,
            tp.handler_name, tp.insurer_address, tp.insurer_postcode,
            p.full_name AS insured_name, v.make AS tp_make, v.model AS tp_model, v.registration AS tp_reg
     FROM claim_third_parties tp
     LEFT JOIN people p ON p.id = tp.person_id
     LEFT JOIN vehicles v ON v.id = tp.vehicle_id
     WHERE tp.claim_id = ?
     ORDER BY tp.sequence ASC
     LIMIT 1`,
    [claimId],
  );
  const driver = get<{ full_name: string | null }>(
    `SELECT p.full_name
     FROM claim_parties cp
     JOIN people p ON p.id = cp.person_id
     WHERE cp.claim_id = ? AND cp.role = 'driver'
     ORDER BY cp.is_primary DESC
     LIMIT 1`,
    [claimId],
  );
  const hire = get<Record<string, string | number | null>>(
    `SELECT started_at, billing_end_at, collection_at, rate_pence_per_day, credit_hire FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC`,
    [claimId],
  );
  const pack = get<Record<string, string | number | null>>(`SELECT * FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  const recovery = get<{ location: string | null }>(`SELECT location FROM recovery_jobs WHERE claim_id = ? LIMIT 1`, [claimId]);
  const lines = all<{ head_of_loss: string; claimed_pence: number; received_pence: number }>(
    `SELECT head_of_loss, claimed_pence, received_pence FROM financial_lines WHERE claim_id = ?`,
    [claimId],
  );
  const settings = get<{ value: string }>(`SELECT value FROM settings WHERE key = 'chaser_interval_days'`);
  const dates = latestDates(listClaimEvents(claimId));
  if (claim.accident_at) dates.accident = String(claim.accident_at);

  const hireStart = hire?.started_at ? String(hire.started_at) : pack?.date_out ? String(pack.date_out) : dates.hire_started || null;
  const hireEnd =
    hire?.billing_end_at ? String(hire.billing_end_at) : pack?.date_in ? String(pack.date_in) : dates.hire_ended || dates.vehicle_returned || null;
  const dailyRate = Number(pack?.daily_rate_pence || hire?.rate_pence_per_day || 0) || null;
  const hireDays = hireStart && hireEnd ? agreementDayNumber(hireStart, hireEnd) : null;
  const hireClaimed = lines
    .filter((line) => line.head_of_loss === "hire" || line.head_of_loss === "credit_hire")
    .reduce((sum, line) => sum + (line.claimed_pence || 0), 0);
  const repairClaimed = lines
    .filter((line) => line.head_of_loss === "repairs" || line.head_of_loss === "vehicle_damage")
    .reduce((sum, line) => sum + (line.claimed_pence || 0), 0);
  const received = lines.reduce((sum, line) => sum + (line.received_pence || 0), 0);
  const claimed = lines.reduce((sum, line) => sum + (line.claimed_pence || 0), 0);
  const outstanding = Math.max(0, claimed - received);
  const cessation = hireChargesAccrualEnd({
    vehicleReturnedAt: dates.vehicle_returned || null,
    totalLossCessationAt: dates.total_loss_cessation_sent || (claim.off_hire_scheduled_on ? String(claim.off_hire_scheduled_on) : null),
  });
  const handlerId = String(claim.handler_id || claim.handler_staff_id || "");
  const selectedEngineerId = (engineerId || String(claim.engineer_id || "")).trim();
  const engineer = selectedEngineerId ? getEngineer(selectedEngineerId) : undefined;
  const engineering = String(claim.engineering_status || "");
  const repairStatus = String(claim.repair_status || "");
  let overdueItem = "";
  if (engineering === "instructed" || engineering === "awaiting_report") overdueItem = "Engineer's report";
  else if (repairStatus === "in_progress" || repairStatus === "awaiting_return") overdueItem = "Repair";
  const creditHire = Number(hire?.credit_hire) === 1;
  const clientDriverName = String(driver?.full_name || "");
  const courtesyReservation = get<{ id: string }>(
    `SELECT id FROM reservations
     WHERE claim_id = ? AND lower(kind) = 'courtesy'
       AND lower(status) NOT IN ('ended', 'cancelled', 'released', 'completed')
     LIMIT 1`,
    [claimId],
  );
  const storedOwnAddress = [blankInsurerField(String(claim.own_insurer_address || "")), blankInsurerField(String(claim.own_insurer_postcode || ""))]
    .filter(Boolean)
    .join(", ");
  const knownOwn = storedOwnAddress ? null : findKnownInsurerOn(getDb(), String(claim.own_insurer_name || ""));
  const knownOwnAddress = knownOwn
    ? [blankInsurerField(knownOwn.address), blankInsurerField(knownOwn.postcode)].filter(Boolean).join(", ")
    : "";
  const tpAddress = [blankInsurerField(String(tp?.insurer_address || "")), blankInsurerField(String(tp?.insurer_postcode || ""))]
    .filter(Boolean)
    .join(", ");

  return {
    ...emptyCorrespondenceFields(),
    fileReference: String(claim.file_reference),
    clientName: String(claim.client_name || "Unknown"),
    handlerName: String(claim.handler_name || "Complete Accident Solutions"),
    accidentAt: claim.accident_at ? String(claim.accident_at) : null,
    accidentLocation: String(claim.accident_location || "Unknown"),
    circumstances: String(claim.circumstances || "Unknown"),
    registration: String(claim.registration || "Unknown"),
    make: String(claim.make || ""),
    model: String(claim.model || ""),
    tpInsurer: String(tp?.insurer_name || "Unknown"),
    tpPolicyOrClaimRef: String(tp?.insurer_ref || "Unknown"),
    ownInsurer: String(claim.own_insurer_name || "Unknown"),
    ownPolicyRef: String(claim.own_policy_ref || "Unknown"),
    ownInsurerAddress: storedOwnAddress || knownOwnAddress,
    dates,
    letterDate,
    senderTitle: handlerId === "staff-justin" ? "Managing Director" : "Claims handler",
    clientEmail: String(claim.client_email || ""),
    tpInsuredName: String(tp?.insured_name || ""),
    tpEmail: String(tp?.insurer_email || tp?.handler_email || ""),
    tpHandlerName: blankInsurerField(String(tp?.handler_name || "")),
    tpInsurerAddress: tpAddress,
    engineerName: engineer?.name || "",
    engineerAddress: engineer?.address || "",
    engineerEmail: engineer?.email || "",
    vehicleLocation: String(recovery?.location || ""),
    siteContactName: "",
    siteContactPhone: "",
    reportTurnaroundDays: String(settings?.value || ENGINEER_CHASER_INTERVAL_DAYS_DEFAULT),
    hireStartAt: hireStart,
    hireEndAt: hireEnd,
    dailyRatePence: dailyRate,
    totalHireDays: hireDays,
    totalHireChargePence: hireClaimed || (hireDays && dailyRate ? hireDays * dailyRate : null),
    repairCostPence: repairClaimed || null,
    needSummary: String(pack?.need_reason || claim.circumstances || ""),
    needEvidenceSummary: String(pack?.need_reason || ""),
    hireCessationDate: cessation,
    currentStageLabel: String(claim.current_position || ""),
    stageSpecificDetail: String(claim.next_action || ""),
    readyDate: dates.repairs_complete || null,
    collectionLocation: String(pack?.delivery_address || recovery?.location || ""),
    overdueItem,
    recipientName: overdueItem === "Repair" ? "the repairer" : "",
    originalDueDate: dates.engineer_instructed || dates.repairs_started || null,
    outstandingBalancePence: outstanding || null,
    settlementAmountPence: received || null,
    finalSettlementAmountPence: received || null,
    cessationBasis: cessation ? "the earlier of vehicle return and the recorded total-loss cessation date" : "",
    clientDriverName: namesDiffer(clientDriverName, String(claim.client_name || "")) ? clientDriverName : "",
    tpVehicleMake: String(tp?.tp_make || ""),
    tpVehicleModel: String(tp?.tp_model || ""),
    tpVehicleReg: String(tp?.tp_reg || ""),
    tpPolicyNumber: String(tp?.policy_number || ""),
    lossesClaimed: summariseLossesClaimed(lines, creditHire),
    creditHire,
    courtesyAllocated: Boolean(courtesyReservation),
  };
}

export function generateClaimDocument(input: {
  claimId: string;
  templateKey: DocumentTemplateKey | LetterTemplateKey;
  actorId: string;
  letterDate?: string;
  recordOnFile?: boolean;
}) {
  if (!isDocumentTemplateKey(input.templateKey)) {
    throw new Error("Unknown document template.");
  }
  const letterDate = occurredFromForm(input.letterDate);
  const ctx = letterContext(input.claimId, letterDate);
  const generated = isEmailTemplateKey(input.templateKey)
    ? generateEmail(input.templateKey, ctx)
    : generateLetter(input.templateKey, ctx);
  const versionRow = get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = ?`,
    [input.claimId, input.templateKey],
  );
  const version = Number(versionRow?.v || 0) + 1;
  const documentId = newId("doc");
  const kind = channelForTemplate(input.templateKey) === "email" ? "email" : "letter";
  run(
    `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
    [
      documentId,
      input.claimId,
      generated.title,
      kind,
      version,
      generated.html,
      input.templateKey,
      JSON.stringify(generated.missing),
      letterDate,
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_generated",
    occurredAt: letterDate,
    details: `${generated.title} (version ${version}) generated — not sent${generated.missing.length ? `. Missing: ${generated.missing.join(", ")}` : ""}${generated.legalSignOffRequired ? ". Legal wording needs solicitor sign-off before live use." : ""}`,
    actorId: input.actorId,
    channel: kind,
    documentId,
    source: "system",
  });
  if (input.recordOnFile !== false) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: eventTypeForTemplate(input.templateKey),
      occurredAt: letterDate,
      details: `Recorded from generated ${generated.title}.`,
      actorId: input.actorId,
      channel: kind,
      documentId,
      source: "staff",
    });
  }
  return { documentId, letter: generated };
}

export function getDocument(id: string) {
  return get<Record<string, string | number | null>>(
    `SELECT d.*, c.file_reference, p.full_name AS client_name
     FROM documents d
     JOIN claims c ON c.id = d.claim_id
     LEFT JOIN people p ON p.id = c.client_person_id
     WHERE d.id = ?`,
    [id],
  );
}

export async function sendClaimEmail(input: {
  claimId: string;
  actorId: string;
  to: string;
  subject: string;
  body: string;
  templateKey?: DocumentTemplateKey;
  occurredAt?: string;
}) {
  const when = occurredFromForm(input.occurredAt);
  const result = await emailGateway.send({ to: input.to, subject: input.subject, body: input.body });
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, 'cas-prototype@local', 0, ?, ?)`,
    [
      correspondenceId,
      input.claimId,
      input.subject,
      input.body.slice(0, 180),
      input.body,
      input.to,
      result.status,
      when,
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "outgoing_email",
    occurredAt: when,
    details: result.ok
      ? `${input.subject} — ${result.warning}`
      : `Send failed: ${result.error}`,
    actorId: input.actorId,
    channel: "email",
    correspondenceId,
    source: "staff",
  });
  if (input.templateKey && isDocumentTemplateKey(input.templateKey)) {
    const specific = eventTypeForTemplate(input.templateKey);
    if (specific !== "outgoing_email" && specific !== "document_generated") {
      recordClaimEvent({
        claimId: input.claimId,
        eventType: specific,
        occurredAt: when,
        details: `Recorded from CAS email template ${input.templateKey}.`,
        actorId: input.actorId,
        channel: "email",
        correspondenceId,
        source: "staff",
      });
    }
  }
  return { ...result, correspondenceId };
}

export function logIncomingEmail(input: {
  claimId: string;
  actorId: string;
  from: string;
  subject: string;
  body: string;
  occurredAt?: string;
}) {
  const when = occurredFromForm(input.occurredAt);
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, 'incoming', 'email', ?, ?, ?, 'cas-prototype@local', ?, 1, 'received', ?)`,
    [correspondenceId, input.claimId, input.subject, input.body.slice(0, 180), input.body, input.from, when],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "incoming_email",
    occurredAt: when,
    details: `${input.subject} from ${input.from}`,
    actorId: input.actorId,
    channel: "email",
    correspondenceId,
    source: "staff",
  });
  return correspondenceId;
}

export async function sendClaimWhatsApp(input: {
  claimId: string;
  actorId: string;
  to: string;
  body: string;
  occurredAt?: string;
  subject?: string;
}) {
  const when = occurredFromForm(input.occurredAt);
  const result = await whatsappGateway.send({ to: input.to, body: input.body });
  const correspondenceId = newId("corr");
  const subject = input.subject || `WhatsApp to ${input.to}`;
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, 'outgoing', 'whatsapp', ?, ?, ?, ?, 'CAS WhatsApp (prototype)', 0, ?, ?)`,
    [
      correspondenceId,
      input.claimId,
      subject,
      input.body.slice(0, 180),
      input.body,
      input.to,
      result.status,
      when,
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "outgoing_whatsapp",
    occurredAt: when,
    details: result.ok ? `${input.body.slice(0, 120)} — ${result.warning}` : `Send failed: ${result.error}`,
    actorId: input.actorId,
    channel: "whatsapp",
    correspondenceId,
    source: "staff",
  });
  return { ...result, correspondenceId };
}

export async function requestScenePhotosWhatsApp(claimId: string, actorId: string) {
  const claim = get<{
    file_reference: string;
    mobile_tel: string | null;
    registration: string | null;
  }>(
    `SELECT c.file_reference, p.mobile_tel, v.registration
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  if (!claim) throw new Error("That file was not found.");
  const mobile = (claim.mobile_tel || "").trim();
  if (!mobile) {
    throw new Error("Enter a mobile number on Client details before asking for photographs by WhatsApp.");
  }
  const result = await sendClaimWhatsApp({
    claimId,
    actorId,
    to: mobile,
    body: scenePhotosWhatsAppBody(claim.file_reference, claim.registration),
    subject: scenePhotosWhatsAppSubject(claim.file_reference),
  });
  run(`UPDATE claims SET photos_whatsapp_status = ? WHERE id = ?`, [result.ok ? result.status : "failed", claimId]);
  return result;
}

export function logIncomingWhatsApp(input: {
  claimId: string;
  actorId: string;
  from: string;
  body: string;
  occurredAt?: string;
}) {
  const when = occurredFromForm(input.occurredAt);
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, 'incoming', 'whatsapp', ?, ?, ?, 'CAS WhatsApp (prototype)', ?, 1, 'received', ?)`,
    [correspondenceId, input.claimId, `WhatsApp from ${input.from}`, input.body.slice(0, 180), input.body, input.from, when],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "incoming_whatsapp",
    occurredAt: when,
    details: `WhatsApp from ${input.from}`,
    actorId: input.actorId,
    channel: "whatsapp",
    correspondenceId,
    source: "staff",
  });
  return correspondenceId;
}

export async function recordClaimCall(input: {
  claimId: string;
  actorId: string;
  direction: "outgoing" | "incoming";
  number: string;
  party: string;
  outcome: string;
  notes?: string;
  occurredAt?: string;
}) {
  const when = occurredFromForm(input.occurredAt);
  const result = await phoneGateway.place({ to: input.number, direction: input.direction });
  const correspondenceId = newId("corr");
  const subject = `${input.direction === "outgoing" ? "Call to" : "Call from"} ${input.party || input.number}`;
  const body = [input.outcome, input.notes, result.ok ? result.warning : result.error].filter(Boolean).join("\n");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, ?, 'phone', ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      correspondenceId,
      input.claimId,
      input.direction,
      subject,
      `${input.outcome}${input.notes ? ` — ${input.notes.slice(0, 80)}` : ""}`.slice(0, 180),
      body,
      input.direction === "outgoing" ? input.number : "CAS (prototype)",
      input.direction === "incoming" ? input.number : "CAS (prototype)",
      result.status,
      when,
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: input.direction === "outgoing" ? "outgoing_call" : "incoming_call",
    occurredAt: when,
    details: `${subject}. Outcome: ${input.outcome}${input.notes ? `. ${input.notes}` : ""} — ${result.ok ? result.warning : result.error}`,
    actorId: input.actorId,
    channel: "phone",
    correspondenceId,
    source: "staff",
  });
  return { ...result, correspondenceId };
}

export function letterPreview(
  claimId: string,
  templateKey: DocumentTemplateKey,
  letterDate?: string,
  engineerId?: string,
) {
  const ctx = letterContext(claimId, occurredFromForm(letterDate), engineerId);
  if (isEmailTemplateKey(templateKey)) return generateEmail(templateKey, ctx);
  if (isLetterTemplateKey(templateKey)) return generateLetter(templateKey, ctx);
  throw new Error("Unknown document template.");
}

function letterTextForMailto(text: string): string {
  return text
    .replaceAll(CAS_TEMPLATE_NOTICE, "")
    .replaceAll(OPERATIONAL_DRAFT_NOTICE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function instructEngineer(input: {
  claimId: string;
  engineerId: string;
  actorId: string;
  letterDate?: string;
}) {
  setClaimEngineer(input.claimId, input.engineerId);
  const engineer = getEngineer(input.engineerId);
  if (!engineer) throw new Error("Pick an engineer from the saved list.");
  if (!engineer.email.trim()) {
    throw new Error("This engineer has no email address. Add one under Settings → Engineers.");
  }
  const generated = generateClaimDocument({
    claimId: input.claimId,
    templateKey: "engineer_instruction",
    actorId: input.actorId,
    letterDate: input.letterDate,
    recordOnFile: false,
  });
  const when = occurredFromForm(input.letterDate);
  const mailtoBody = letterTextForMailto(generated.letter.text);
  const mailto = buildMailtoHref(engineer.email, generated.letter.subject, mailtoBody);
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, 'engineer_instruction', ?)`,
    [
      correspondenceId,
      input.claimId,
      generated.letter.subject,
      mailtoBody.slice(0, 180),
      mailtoBody,
      engineer.email,
      CAS_CLAIMS_MAILBOX,
      ENGINEER_INSTRUCTION_PREPARED,
      when,
    ],
  );
  run(`UPDATE claim_events SET correspondence_id = ? WHERE document_id = ? AND event_type = 'document_generated'`, [
    correspondenceId,
    generated.documentId,
  ]);
  return {
    documentId: generated.documentId,
    correspondenceId,
    mailto,
    to: engineer.email,
    subject: generated.letter.subject,
    body: mailtoBody,
    engineerName: engineer.name,
    letter: generated.letter,
  };
}

export function markEngineerInstructionSent(input: {
  claimId: string;
  correspondenceId: string;
  actorId: string;
  occurredAt?: string;
}) {
  const row = get<{
    id: string;
    claim_id: string;
    subject: string | null;
    to_address: string | null;
    sent_status: string | null;
    body: string | null;
  }>(`SELECT id, claim_id, subject, to_address, sent_status, body FROM correspondence WHERE id = ?`, [
    input.correspondenceId,
  ]);
  if (!row || row.claim_id !== input.claimId) throw new Error("Prepared engineer instruction not found on this file.");
  if (row.sent_status === ENGINEER_INSTRUCTION_MARKED_SENT) {
    throw new Error("This engineer instruction is already marked as sent.");
  }
  if (row.sent_status !== ENGINEER_INSTRUCTION_PREPARED) {
    throw new Error("This item is not a prepared engineer instruction waiting to be marked as sent.");
  }
  const when = occurredFromForm(input.occurredAt);
  const handler = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [input.actorId]);
  const handlerName = handler?.name || "Unknown handler";
  run(`UPDATE correspondence SET sent_status = ? WHERE id = ?`, [ENGINEER_INSTRUCTION_MARKED_SENT, input.correspondenceId]);
  const subject = String(row.subject || "Engineer instruction");
  const to = String(row.to_address || "");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "outgoing_email",
    occurredAt: when,
    details: `${subject} prepared for ${to}. Marked as sent by ${handlerName} after opening their own email client. Not auto-sent — live sending from ${CAS_CLAIMS_MAILBOX} is not connected.`,
    actorId: input.actorId,
    channel: "email",
    correspondenceId: input.correspondenceId,
    source: "staff",
  });
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "engineer_instructed",
    occurredAt: when,
    details: `Engineer instructed (${subject}). Marked as sent by ${handlerName}. Prepared, not auto-sent from ${CAS_CLAIMS_MAILBOX}.`,
    actorId: input.actorId,
    channel: "email",
    correspondenceId: input.correspondenceId,
    source: "staff",
  });
  return { handlerName, occurredAt: when };
}

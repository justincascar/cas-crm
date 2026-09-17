import { emailGateway } from "../email/gateway";
import { phoneGateway } from "../phone/gateway";
import { whatsappGateway } from "../whatsapp/gateway";
import { eventLabel, latestDates, type ClaimEventType } from "../domain/events";
import { generateLetter, type LetterTemplateKey } from "../documents/templates";
import { nowUtcIso, occurredFromForm } from "../dates";
import { all, get, newId, run } from "./connection";

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
    eventType === "outgoing_email" ||
    eventType === "incoming_email" ||
    eventType === "liability_chase_sent" ||
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

function letterContext(claimId: string, letterDate: string) {
  const claim = get<Record<string, string | number | null>>(
    `SELECT c.*, s.name AS handler_name, p.full_name AS client_name,
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
    `SELECT insurer_name, insurer_ref FROM claim_third_parties WHERE claim_id = ? LIMIT 1`,
    [claimId],
  );
  const dates = latestDates(listClaimEvents(claimId));
  if (claim.accident_at) dates.accident = String(claim.accident_at);
  return {
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
    dates,
    letterDate,
  };
}

export function generateClaimDocument(input: {
  claimId: string;
  templateKey: LetterTemplateKey;
  actorId: string;
  letterDate?: string;
  recordOnFile?: boolean;
}) {
  const letterDate = occurredFromForm(input.letterDate);
  const ctx = letterContext(input.claimId, letterDate);
  const letter = generateLetter(input.templateKey, ctx);
  const versionRow = get<{ v: number }>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE claim_id = ? AND template_key = ?`,
    [input.claimId, input.templateKey],
  );
  const version = Number(versionRow?.v || 0) + 1;
  const documentId = newId("doc");
  run(
    `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, missing_json, created_at)
     VALUES (?, ?, ?, 'letter', ?, 0, 1, ?, ?, ?, ?)`,
    [
      documentId,
      input.claimId,
      letter.title,
      version,
      letter.html,
      input.templateKey,
      JSON.stringify(letter.missing),
      letterDate,
    ],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_generated",
    occurredAt: letterDate,
    details: `${letter.title} (version ${version})${letter.missing.length ? `. Missing: ${letter.missing.join(", ")}` : ""}`,
    actorId: input.actorId,
    channel: "letter",
    documentId,
    source: "system",
  });
  if (input.recordOnFile !== false) {
    const eventType =
      input.templateKey === "initial_tp_insurer"
        ? "initial_letter_tp_insurer"
        : input.templateKey === "engineer_instruction"
          ? "engineer_instructed"
          : input.templateKey === "repair_commencement"
            ? "repairs_started"
            : "liability_chase_sent";
    recordClaimEvent({
      claimId: input.claimId,
      eventType,
      occurredAt: letterDate,
      details: `Recorded from generated ${letter.title}.`,
      actorId: input.actorId,
      channel: "letter",
      documentId,
      source: "staff",
    });
  }
  return { documentId, letter };
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
  templateKey?: LetterTemplateKey;
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
}) {
  const when = occurredFromForm(input.occurredAt);
  const result = await whatsappGateway.send({ to: input.to, body: input.body });
  const correspondenceId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
     VALUES (?, ?, 'outgoing', 'whatsapp', ?, ?, ?, ?, 'CAS WhatsApp (prototype)', 0, ?, ?)`,
    [
      correspondenceId,
      input.claimId,
      `WhatsApp to ${input.to}`,
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

export function letterPreview(claimId: string, templateKey: LetterTemplateKey, letterDate?: string) {
  const ctx = letterContext(claimId, occurredFromForm(letterDate));
  return generateLetter(templateKey, ctx);
}

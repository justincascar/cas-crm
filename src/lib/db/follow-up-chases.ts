import { CAS_CLAIMS_MAILBOX } from "../constants";
import { nowUtcIso } from "../dates";
import { buildMailtoHref } from "../email/mailto";
import {
  DOCUMENT_CHASES,
  DOCUMENT_CHASE_SENT_EVENT,
  TOTAL_LOSS_NOTICE_SENT_EVENT,
  TOTAL_LOSS_PAYMENT_CHASE_KIND,
  TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT,
  TOTAL_LOSS_PAYMENT_RECEIVED_EVENT,
  documentChaseByKind,
  documentChaseDecision,
  isDocumentChaseKind,
  totalLossPaymentChaseDecision,
  type SupplementaryChaseKind,
} from "../domain/follow-up-chases";
import { paymentDetailsLetterLine, type InsurerPaymentDetails } from "../domain/payment-details";
import type { ChaseView } from "./chase";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";
import { ENGINEER_INSTRUCTION_MARKED_SENT, ENGINEER_INSTRUCTION_PREPARED } from "./engineers";
import { getInsurerPaymentDetails } from "./payment-details";
import { TOTAL_LOSS_NOTICE_TEMPLATE } from "./total-loss";

const DOCUMENT_TEMPLATE_PREFIX = "document_chase_";
const TOTAL_LOSS_PAYMENT_CHASE_TEMPLATE = "total_loss_payment_chase";

type ClaimMeta = {
  id: string;
  file_reference: string;
  client_name: string | null;
  client_email: string | null;
  handler_name: string | null;
};

function claimFilter(column: string, claimId?: string): { sql: string; params: string[] } {
  if (!claimId) return { sql: "", params: [] };
  return { sql: ` AND ${column} = ?`, params: [claimId] };
}

function latestByKey(rows: Array<{ key: string; at: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const current = map.get(row.key);
    if (!current || row.at < current) map.set(row.key, row.at);
  }
  return map;
}

function latestAfter(rows: Array<{ key: string; at: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const current = map.get(row.key);
    if (!current || row.at > current) map.set(row.key, row.at);
  }
  return map;
}

function blankView(input: {
  kind: SupplementaryChaseKind;
  claimId: string;
  title: string;
  label: string;
  due: boolean;
  dueAt: string | null;
  clockAt: string | null;
  outcomeOnFile: boolean;
  reason: string;
  intervalDays: number;
  meta?: ClaimMeta;
}): ChaseView {
  return {
    kind: input.kind,
    claimId: input.claimId,
    fileReference: input.meta?.file_reference,
    clientName: input.meta?.client_name,
    handlerName: input.meta?.handler_name,
    title: input.title,
    dueLabel: input.label,
    active: !input.outcomeOnFile,
    due: input.due,
    outcomeOnFile: input.outcomeOnFile,
    handlerState: "tracking",
    daysOutstanding: null,
    clockAt: input.clockAt,
    dueAt: input.dueAt,
    reason: input.reason,
    label: input.due ? input.label : null,
    severity: input.due ? "red" : null,
    contactName: input.meta?.client_name || "",
    contactEmail: input.meta?.client_email || "",
    contactMissing: false,
    contactMissingMessage: null,
    frozenIntervalDays: input.intervalDays,
    globalIntervalDays: input.intervalDays,
    overrideDays: null,
    overrideReason: null,
    intervalDays: input.intervalDays,
    intervalSource: "settings",
  };
}

export function listFollowUpChases(asAt: string = nowUtcIso(), claimId?: string): ChaseView[] {
  const claim = claimFilter("c.id", claimId);
  const eventClaim = claimFilter("claim_id", claimId);
  const docClaim = claimFilter("claim_id", claimId);
  const metas = all<ClaimMeta>(
    `SELECT c.id, c.file_reference, p.full_name AS client_name, p.email AS client_email, s.name AS handler_name
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN staff s ON s.id = c.handler_id
     WHERE 1 = 1${claim.sql}`,
    claim.params,
  );
  const metaById = new Map(metas.map((row) => [row.id, row]));

  const welcomes = latestByKey(
    all<{ key: string; at: string }>(
      `SELECT claim_id AS key, occurred_at AS at FROM claim_events
       WHERE event_type = 'client_welcome_sent'${eventClaim.sql}`,
      eventClaim.params,
    ),
  );
  const onFile = new Set(
    all<{ claim_id: string; document_type: string }>(
      `SELECT claim_id, document_type FROM documents
       WHERE document_type IN (${DOCUMENT_CHASES.map(() => "?").join(", ")})${docClaim.sql}`,
      [...DOCUMENT_CHASES.map((item) => item.documentType), ...docClaim.params],
    ).map((row) => `${row.claim_id}:${row.document_type}`),
  );
  const bankTick = new Set(
    all<{ claim_id: string }>(
      `SELECT claim_id FROM hire_pack_data WHERE means_documents_on_file = 1${docClaim.sql}`,
      docClaim.params,
    ).map((row) => row.claim_id),
  );
  const documentSent = latestAfter(
    all<{ key: string; at: string }>(
      `SELECT claim_id || ':' || details AS key, occurred_at AS at FROM claim_events
       WHERE event_type = ?${eventClaim.sql}`,
      [DOCUMENT_CHASE_SENT_EVENT, ...eventClaim.params],
    ),
  );

  const views: ChaseView[] = [];
  for (const [id, requestedAt] of welcomes) {
    const meta = metaById.get(id);
    for (const paper of DOCUMENT_CHASES) {
      const received = onFile.has(`${id}:${paper.documentType}`) || (paper.documentType === "bank_statements" && bankTick.has(id));
      const decision = documentChaseDecision({
        requestedAt,
        received,
        lastChaseSentAt: documentSent.get(`${id}:${paper.kind}`) || null,
        asAt,
      });
      if (!decision.started) continue;
      views.push(
        blankView({
          kind: paper.kind,
          claimId: id,
          title: paper.title,
          label: paper.label,
          due: decision.due,
          dueAt: decision.dueAt,
          clockAt: requestedAt,
          outcomeOnFile: decision.outcomeOnFile,
          reason: decision.outcomeOnFile
            ? "The document is on file."
            : decision.due
              ? paper.label
              : "Requested. The 24-hour chase is not due yet.",
          intervalDays: 1,
          meta,
        }),
      );
    }
  }

  const notices = latestByKey(
    all<{ key: string; at: string }>(
      `SELECT claim_id AS key, occurred_at AS at FROM claim_events
       WHERE event_type = ?${eventClaim.sql}`,
      [TOTAL_LOSS_NOTICE_SENT_EVENT, ...eventClaim.params],
    ),
  );
  const markedSent = latestByKey(
    all<{ key: string; at: string }>(
      `SELECT c.claim_id AS key, e.occurred_at AS at
       FROM correspondence c
       JOIN claim_events e ON e.correspondence_id = c.id AND e.event_type = 'outgoing_email'
       WHERE c.template_key = ? AND c.sent_status = ?${claimFilter("c.claim_id", claimId).sql}`,
      [TOTAL_LOSS_NOTICE_TEMPLATE, ENGINEER_INSTRUCTION_MARKED_SENT, ...claimFilter("c.claim_id", claimId).params],
    ),
  );
  for (const [id, at] of markedSent) {
    if (!notices.has(id) || at < (notices.get(id) || at)) notices.set(id, at);
  }

  const promisedRows = all<{ claim_id: string; insurer_payment_promised_at: string | null }>(
    `SELECT claim_id, insurer_payment_promised_at FROM total_loss_reports
     WHERE insurer_payment_promised_at IS NOT NULL AND insurer_payment_promised_at != ''${docClaim.sql}`,
    docClaim.params,
  );
  const promised = new Map(promisedRows.map((row) => [row.claim_id, String(row.insurer_payment_promised_at)]));
  const receivedMoney = new Set(
    all<{ claim_id: string }>(
      `SELECT claim_id FROM financial_lines WHERE head_of_loss = 'vehicle_damage' AND received_pence > 0${docClaim.sql}`,
      docClaim.params,
    ).map((row) => row.claim_id),
  );
  const qualifying = new Set(
    all<{ id: string }>(
      `SELECT id FROM claims WHERE payment_qualifies_off_hire = 1${claim.sql.replaceAll("c.id", "id")}`,
      claim.params,
    ).map((row) => row.id),
  );
  const receivedEvent = new Set(
    all<{ claim_id: string }>(
      `SELECT DISTINCT claim_id FROM claim_events WHERE event_type = ?${eventClaim.sql}`,
      [TOTAL_LOSS_PAYMENT_RECEIVED_EVENT, ...eventClaim.params],
    ).map((row) => row.claim_id),
  );
  const paymentSent = latestAfter(
    all<{ key: string; at: string }>(
      `SELECT claim_id AS key, occurred_at AS at FROM claim_events WHERE event_type = ?${eventClaim.sql}`,
      [TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT, ...eventClaim.params],
    ),
  );

  for (const [id, noticeSentAt] of notices) {
    const paymentReceived = receivedMoney.has(id) || qualifying.has(id) || receivedEvent.has(id);
    const decision = totalLossPaymentChaseDecision({
      noticeSentAt,
      insurerPromisedAt: promised.get(id) || null,
      paymentReceived,
      lastChaseSentAt: paymentSent.get(id) || null,
      asAt,
    });
    if (!decision.started) continue;
    views.push(
      blankView({
        kind: TOTAL_LOSS_PAYMENT_CHASE_KIND,
        claimId: id,
        title: "Total-loss payment",
        label: decision.label,
        due: decision.due,
        dueAt: decision.dueAt,
        clockAt: promised.get(id) || noticeSentAt,
        outcomeOnFile: decision.stage === "received",
        reason:
          decision.stage === "received"
            ? "Payment has been received."
            : decision.stage === "awaiting_arrival"
              ? "The insurer has confirmed they are sending payment."
              : "The total-loss notification has been sent. No confirmation and no payment yet.",
        intervalDays: decision.stage === "awaiting_arrival" ? 7 : 3,
        meta: metaById.get(id),
      }),
    );
  }

  return views;
}

export function dueFollowUpChases(asAt: string = nowUtcIso()): ChaseView[] {
  return listFollowUpChases(asAt).filter((row) => row.due);
}

function clientContact(claimId: string) {
  return get<{ file_reference: string; full_name: string | null; email: string | null }>(
    `SELECT c.file_reference, p.full_name, p.email
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
}

export function prepareDocumentChaseEmail(input: { claimId: string; actorId: string; kind: string }) {
  const paper = documentChaseByKind(input.kind);
  if (!paper) throw new Error("Unknown document chase.");
  const claim = clientContact(input.claimId);
  if (!claim) throw new Error("File not found.");
  const to = String(claim.email || "").trim();
  if (!to) throw new Error("No client email on file. Nothing was prepared.");
  const subject = `Our ref: ${claim.file_reference} — ${paper.title}`;
  const name = claim.full_name || "Sir / Madam";
  const body = [
    `Dear ${name},`,
    "",
    `Our ref: ${claim.file_reference}`,
    "",
    `We still need your ${paper.title.toLowerCase()} for this claim. A photograph from your phone is enough.`,
    "",
    "This is a reminder only. It has not been sent automatically.",
    "",
    "Kind regards,",
    "",
    CAS_CLAIMS_MAILBOX,
  ].join("\n");
  return storePrepared({
    claimId: input.claimId,
    subject,
    body,
    to,
    templateKey: `${DOCUMENT_TEMPLATE_PREFIX}${paper.kind}`,
  });
}

function insurerContact(claimId: string) {
  return get<{
    file_reference: string;
    insurer_name: string | null;
    insurer_email: string | null;
    handler_email: string | null;
  }>(
    `SELECT c.file_reference, tp.insurer_name, tp.insurer_email, tp.handler_email
     FROM claims c
     LEFT JOIN claim_third_parties tp ON tp.claim_id = c.id
     WHERE c.id = ?
     ORDER BY tp.sequence, tp.id
     LIMIT 1`,
    [claimId],
  );
}

export function prepareTotalLossPaymentChaseEmail(input: { claimId: string; actorId: string; asAt?: string }) {
  const claim = insurerContact(input.claimId);
  if (!claim) throw new Error("File not found.");
  const to = String(claim.insurer_email || claim.handler_email || "").trim();
  if (!to) throw new Error("No insurer email on file. Add it on Third party 1. Nothing was prepared.");
  const chase = listFollowUpChases(input.asAt || nowUtcIso(), input.claimId).find((row) => row.kind === TOTAL_LOSS_PAYMENT_CHASE_KIND);
  const waitingForArrival = chase?.reason.includes("confirmed they are sending");
  const details = getInsurerPaymentDetails();
  const subject = `Our ref: ${claim.file_reference} — total loss payment`;
  const body = [
    "Dear Sir / Madam,",
    "",
    `Our ref: ${claim.file_reference}`,
    "",
    waitingForArrival
      ? "You confirmed that payment of the total-loss figure was being sent. It has not arrived."
      : "We have not yet heard whether the total-loss payment is being sent.",
    paymentDetailsLetterLine(details),
    "",
    "This is a reminder only. It has not been sent automatically.",
  ].join("\n");
  return storePrepared({
    claimId: input.claimId,
    subject,
    body,
    to,
    templateKey: TOTAL_LOSS_PAYMENT_CHASE_TEMPLATE,
  });
}

function storePrepared(input: { claimId: string; subject: string; body: string; to: string; templateKey: string }) {
  const id = newId("corr");
  const when = nowUtcIso();
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      input.claimId,
      input.subject,
      input.body.slice(0, 180),
      input.body,
      input.to,
      CAS_CLAIMS_MAILBOX,
      ENGINEER_INSTRUCTION_PREPARED,
      input.templateKey,
      when,
    ],
  );
  return {
    id,
    subject: input.subject,
    toAddress: input.to,
    body: input.body,
    createdAt: when,
    mailto: buildMailtoHref(input.to, input.subject, input.body),
  };
}

export function getPreparedFollowUpEmail(claimId: string, templateKey: string) {
  return get<{ id: string; subject: string | null; to_address: string | null; body: string | null; created_at: string }>(
    `SELECT id, subject, to_address, body, created_at FROM correspondence
     WHERE claim_id = ? AND template_key = ? AND sent_status = ?
     ORDER BY created_at DESC LIMIT 1`,
    [claimId, templateKey, ENGINEER_INSTRUCTION_PREPARED],
  );
}

export function markDocumentChaseSent(input: { claimId: string; kind: string; correspondenceId: string; actorId: string }) {
  if (!isDocumentChaseKind(input.kind)) throw new Error("Unknown document chase.");
  const row = preparedRow(input.correspondenceId, input.claimId, `${DOCUMENT_TEMPLATE_PREFIX}${input.kind}`);
  const when = nowUtcIso();
  run(`UPDATE correspondence SET sent_status = ? WHERE id = ?`, [ENGINEER_INSTRUCTION_MARKED_SENT, row.id]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: DOCUMENT_CHASE_SENT_EVENT,
    occurredAt: when,
    actorId: input.actorId,
    details: input.kind,
    channel: "email",
    correspondenceId: row.id,
    source: "staff",
  });
}

export function markTotalLossPaymentChaseSent(input: { claimId: string; correspondenceId: string; actorId: string }) {
  const row = preparedRow(input.correspondenceId, input.claimId, TOTAL_LOSS_PAYMENT_CHASE_TEMPLATE);
  const when = nowUtcIso();
  run(`UPDATE correspondence SET sent_status = ? WHERE id = ?`, [ENGINEER_INSTRUCTION_MARKED_SENT, row.id]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: TOTAL_LOSS_PAYMENT_CHASE_SENT_EVENT,
    occurredAt: when,
    actorId: input.actorId,
    details: "Total-loss payment chase marked as sent after the handler opened their own email client. Not auto-sent.",
    channel: "email",
    correspondenceId: row.id,
    source: "staff",
  });
}

function preparedRow(id: string, claimId: string, templateKey: string) {
  const row = get<{ id: string; claim_id: string; sent_status: string | null; template_key: string | null }>(
    `SELECT id, claim_id, sent_status, template_key FROM correspondence WHERE id = ?`,
    [id],
  );
  if (!row || row.claim_id !== claimId || row.template_key !== templateKey) {
    throw new Error("Prepared chase email not found on this file.");
  }
  if (row.sent_status === ENGINEER_INSTRUCTION_MARKED_SENT) throw new Error("This email is already marked as sent.");
  if (row.sent_status !== ENGINEER_INSTRUCTION_PREPARED) {
    throw new Error("This item is not a prepared chase email waiting to be marked as sent.");
  }
  return row;
}

export function documentChaseTemplateKey(kind: string): string {
  return `${DOCUMENT_TEMPLATE_PREFIX}${kind}`;
}

export function totalLossPaymentChaseTemplateKey(): string {
  return TOTAL_LOSS_PAYMENT_CHASE_TEMPLATE;
}

export function paymentLineForLetter(details: InsurerPaymentDetails = getInsurerPaymentDetails()): string {
  return paymentDetailsLetterLine(details);
}

import { nowUtcIso } from "../dates";
import { loadClaimEmailAttachments } from "./email-attachments";
import { CHASE_KINDS, chaseDefinition } from "../domain/chase";
import { isDocumentChaseKind } from "../domain/follow-up-chases";
import { MailboxSendError, sendMailboxMessage } from "../email/microsoft-graph";
import { CAS_CLAIMS_MAILBOX } from "../constants";
import { mailboxSentDetails } from "../email/sent-wording";
import { get, getDb } from "./connection";
import { recordClaimEvent, markEngineerInstructionSent, markOutstandingChaseSent } from "./chronology";
import {
  CORRESPONDENCE_SENDING,
  ENGINEER_INSTRUCTION_MARKED_SENT,
  ENGINEER_INSTRUCTION_PREPARED,
} from "./engineers";
import { documentChaseTemplateKey, markDocumentChaseSent, markTotalLossPaymentChaseSent, totalLossPaymentChaseTemplateKey } from "./follow-up-chases";
import { markTotalLossNoticeSent, TOTAL_LOSS_NOTICE_TEMPLATE } from "./total-loss";

const ENGINEER_INSTRUCTION_TEMPLATE = "engineer_instruction";

type PreparedRow = {
  id: string;
  claim_id: string;
  subject: string | null;
  body: string | null;
  to_address: string | null;
  sent_status: string | null;
  template_key: string | null;
};

export async function sendPreparedCorrespondence(input: {
  claimId: string;
  correspondenceId: string;
  actorId: string;
  attachmentIds?: string[];
}) {
  const row = get<PreparedRow>(
    `SELECT id, claim_id, subject, body, to_address, sent_status, template_key FROM correspondence WHERE id = ?`,
    [input.correspondenceId],
  );
  if (!row || row.claim_id !== input.claimId) throw new Error("Prepared email not found on this file.");
  if (row.sent_status === ENGINEER_INSTRUCTION_MARKED_SENT || row.sent_status === "sent") {
    throw new Error("This email has already been sent. It was not sent again.");
  }
  if (row.sent_status === CORRESPONDENCE_SENDING) {
    throw new Error("A send is already in progress for this email. Nothing further was sent.");
  }
  if (row.sent_status !== ENGINEER_INSTRUCTION_PREPARED) {
    throw new Error("This item is not a prepared email waiting to be sent.");
  }
  const to = String(row.to_address || "").trim();
  const subject = String(row.subject || "").trim();
  const body = String(row.body || "").trim();
  if (!to || !subject || !body) throw new Error("This prepared email is missing a recipient, subject or message. Nothing was sent.");
  const loaded = loadClaimEmailAttachments(input.claimId, input.attachmentIds || []);
  if (!loaded.ok) throw new Error(loaded.error);

  const claimed = getDb()
    .prepare(`UPDATE correspondence SET sent_status = ? WHERE id = ? AND claim_id = ? AND sent_status = ?`)
    .run(CORRESPONDENCE_SENDING, row.id, input.claimId, ENGINEER_INSTRUCTION_PREPARED);
  if (Number(claimed.changes) !== 1) {
    throw new Error("A send is already in progress for this email. Nothing further was sent.");
  }

  try {
    await sendMailboxMessage({
      to,
      subject,
      body,
      attachments: loaded.attachments.map((item) => ({ name: item.name, contentType: item.contentType, content: item.content })),
    });
  } catch (error) {
    getDb()
      .prepare(`UPDATE correspondence SET sent_status = ? WHERE id = ? AND sent_status = ?`)
      .run(ENGINEER_INSTRUCTION_PREPARED, row.id, CORRESPONDENCE_SENDING);
    const message = error instanceof Error ? error.message : "Microsoft 365 did not send this email. Nothing was sent.";
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "email_send_failed",
      occurredAt: nowUtcIso(),
      details: `Not sent to ${to}. ${message}`,
      actorId: input.actorId,
      channel: "email",
      correspondenceId: row.id,
      source: "staff",
    });
    if (error instanceof MailboxSendError) throw error;
    throw new MailboxSendError("unreachable", message);
  }

  try {
    finishSend(row, input.actorId);
  } catch (error) {
    const still = get<{ sent_status: string | null }>(`SELECT sent_status FROM correspondence WHERE id = ?`, [row.id]);
    if (still?.sent_status === CORRESPONDENCE_SENDING) {
      getDb().prepare(`UPDATE correspondence SET sent_status = ? WHERE id = ?`).run(ENGINEER_INSTRUCTION_MARKED_SENT, row.id);
      const handler = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [input.actorId]);
      recordClaimEvent({
        claimId: input.claimId,
        eventType: "outgoing_email",
        occurredAt: nowUtcIso(),
        details: mailboxSentDetails(subject, to, handler?.name || "Unknown handler"),
        actorId: input.actorId,
        channel: "email",
        correspondenceId: row.id,
        source: "staff",
      });
    }
    const detail = error instanceof Error ? error.message : "The file history could not be finished.";
    throw new Error(`The email was sent from ${CAS_CLAIMS_MAILBOX}. Do not send it again. ${detail}`);
  }
}

function finishSend(row: PreparedRow, actorId: string) {
  const templateKey = String(row.template_key || "");
  const shared = { claimId: row.claim_id, correspondenceId: row.id, actorId, deliveredByMailbox: true as const };
  if (templateKey === ENGINEER_INSTRUCTION_TEMPLATE) {
    markEngineerInstructionSent(shared);
    return;
  }
  if (templateKey === TOTAL_LOSS_NOTICE_TEMPLATE) {
    markTotalLossNoticeSent(shared);
    return;
  }
  if (templateKey === totalLossPaymentChaseTemplateKey()) {
    markTotalLossPaymentChaseSent(shared);
    return;
  }
  const documentKind = templateKey.startsWith("document_chase_") ? templateKey.slice("document_chase_".length) : "";
  if (documentKind && isDocumentChaseKind(documentKind) && documentChaseTemplateKey(documentKind) === templateKey) {
    markDocumentChaseSent({ ...shared, kind: documentKind });
    return;
  }
  for (const kind of CHASE_KINDS) {
    if (chaseDefinition(kind).templateKey === templateKey) {
      markOutstandingChaseSent({ ...shared, kind });
      return;
    }
  }
  const handler = get<{ name: string }>(`SELECT name FROM staff WHERE id = ?`, [actorId]);
  const handlerName = handler?.name || "Unknown handler";
  getDb().prepare(`UPDATE correspondence SET sent_status = ? WHERE id = ?`).run(ENGINEER_INSTRUCTION_MARKED_SENT, row.id);
  recordClaimEvent({
    claimId: row.claim_id,
    eventType: "outgoing_email",
    occurredAt: nowUtcIso(),
    details: mailboxSentDetails(String(row.subject || "Email"), String(row.to_address || ""), handlerName),
    actorId,
    channel: "email",
    correspondenceId: row.id,
    source: "staff",
  });
}

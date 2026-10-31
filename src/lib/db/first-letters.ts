import { normalizeLiabilityStatus, liabilityStatusLabel } from "../domain/claim-status";
import { clientDraftInfo, isClientDraftKey, WAITING_FOR_CAS_WORDING } from "../documents/client-drafts";
import type { DocumentTemplateKey } from "../documents/catalog";
import { savedText } from "../email/send-to";
import { nowUtcIso } from "../dates";
import { generateClaimDocument, letterPreview, recordClaimEvent, sendClaimEmail } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { isDocumentApproved } from "./document-approvals";
import { getScreenData } from "./screens";

/**
 * R63/R64: the first letters for a file, chosen by its liability status (the table at the top of the drafts file).
 * Each is prepared filled in and addressed; staff check it and send. Drafts wait for Justin's approval.
 */

type Recipient = "tp_insurer" | "own_insurer" | "client";
export type PackEntry = { key: DocumentTemplateKey | "draft_courtesy_car"; recipient: Recipient; channel: "email" | "letter" };

const NON_FAULT: PackEntry[] = [
  { key: "initial_tp_insurer", recipient: "tp_insurer", channel: "letter" },
  { key: "draft_own_insurer_notice", recipient: "own_insurer", channel: "letter" },
  { key: "client_welcome", recipient: "client", channel: "email" },
  { key: "draft_client_authority", recipient: "client", channel: "letter" },
];
const FAULT: PackEntry[] = [
  { key: "draft_own_insurer_network", recipient: "own_insurer", channel: "letter" },
  { key: "client_welcome_fault", recipient: "client", channel: "email" },
  { key: "draft_repair_authority", recipient: "client", channel: "letter" },
];
const SPLIT: PackEntry[] = [
  { key: "draft_split_tp", recipient: "tp_insurer", channel: "letter" },
  { key: "draft_own_insurer_network", recipient: "own_insurer", channel: "letter" },
  { key: "draft_split_client", recipient: "client", channel: "letter" },
  { key: "draft_client_authority", recipient: "client", channel: "letter" },
];
const DISPUTED: PackEntry[] = [
  { key: "draft_liability_position", recipient: "tp_insurer", channel: "letter" },
  { key: "draft_own_insurer_notice", recipient: "own_insurer", channel: "letter" },
  { key: "client_welcome", recipient: "client", channel: "email" },
  { key: "draft_client_authority", recipient: "client", channel: "letter" },
];

/** The pack for a liability status. A fault file never gets the initial letter to the third-party insurer. */
export function firstLettersFor(status: string | null | undefined): PackEntry[] {
  const value = normalizeLiabilityStatus(status);
  if (value === "fault") return FAULT;
  if (value === "split") return SPLIT;
  if (value === "non_fault") return NON_FAULT;
  return DISPUTED;
}

/** The supplied templates (already CAS's wording) need no approval; the drafts do. */
export function firstLetterApproved(key: string): boolean {
  return isClientDraftKey(key) ? isDocumentApproved(key) : true;
}

const STEP_EVENTS: Record<string, string> = {
  initial_tp_insurer: "initial_letter_tp_insurer",
  draft_split_tp: "initial_letter_tp_insurer",
  draft_liability_position: "initial_letter_tp_insurer",
  draft_own_insurer_network: "initial_letter_own_insurer",
};

function ready() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS first_letter_actions (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL,
    action TEXT NOT NULL,
    document_id TEXT,
    correspondence_id TEXT,
    recipient TEXT,
    actor_id TEXT NOT NULL,
    at TEXT NOT NULL
  )`);
}

export type FirstLetterDone = { action: "generated" | "sent" | "marked_sent"; at: string; byName: string; documentId: string | null; recipient: string | null };

function latestAction(claimId: string, key: string): FirstLetterDone | null {
  const row = get<{ action: string; at: string; name: string | null; document_id: string | null; recipient: string | null }>(
    `SELECT a.action, a.at, a.document_id, a.recipient, s.name FROM first_letter_actions a LEFT JOIN staff s ON s.id = a.actor_id
     WHERE a.claim_id = ? AND a.template_key = ? ORDER BY CASE a.action WHEN 'generated' THEN 0 ELSE 1 END DESC, a.at DESC LIMIT 1`,
    [claimId, key],
  );
  return row ? { action: row.action as FirstLetterDone["action"], at: String(row.at), byName: String(row.name || "Staff"), documentId: row.document_id, recipient: row.recipient } : null;
}

type Contacts = { tp: { email: string; cc: string; name: string }; own: { email: string; name: string }; client: { email: string; name: string } };

function contacts(claimId: string): Contacts {
  const tp = get<Record<string, string | null>>(
    `SELECT insurer_name, insurer_email, handler_email, agent_name, agent_email, agent_handler_email FROM claim_third_parties WHERE claim_id = ? ORDER BY sequence ASC LIMIT 1`,
    [claimId],
  );
  const insurerEmail = savedText(tp?.handler_email) || savedText(tp?.insurer_email);
  const agentEmail = savedText(tp?.agent_handler_email) || savedText(tp?.agent_email);
  const claim = get<{ client_email: string | null; client_name: string | null; own_insurer_name: string | null }>(
    `SELECT p.email AS client_email, p.full_name AS client_name, c.own_insurer_name FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
  return {
    // R63: with a representative (agent) recorded, the letter goes to the agent and the insurer is copied in.
    tp: agentEmail
      ? { email: agentEmail, cc: insurerEmail, name: savedText(tp?.agent_name) || "Third-party representative" }
      : { email: insurerEmail, cc: "", name: savedText(tp?.insurer_name) || "Third-party insurer" },
    own: { email: savedText(getScreenData(claimId, "insurer").email), name: savedText(claim?.own_insurer_name) || "Client's own insurer" },
    client: { email: savedText(claim?.client_email), name: savedText(claim?.client_name) || "Client" },
  };
}

/** Where to fix a gap the letter shows. */
function gapLink(claimId: string, label: string): string {
  const base = `/claims/${claimId}`;
  const text = label.toLowerCase();
  if (text.includes("third-party") || text.includes("third party")) return `${base}/details/tp1`;
  if (text.includes("own insurer") || text.includes("policy") || text.includes("excess")) return `${base}/details/insurer`;
  if (text.includes("client vehicle") || text.includes("registration") || text.includes("make")) return `${base}/vehicles`;
  if (text.includes("accident")) return `${base}/details/accident`;
  if (text.includes("split")) return `${base}/details/general`;
  if (text.includes("where the vehicle")) return `${base}/heads/recovery`;
  if (text.includes("account")) return `${base}/first-letters#account`;
  if (text.includes("email")) return `${base}/details/client`;
  return `${base}/details/client`;
}

export type FirstLetterItem = {
  key: string;
  title: string;
  recipient: Recipient;
  recipientLabel: string;
  to: string;
  cc: string;
  channel: "email" | "letter";
  approved: boolean;
  waitingWording: boolean;
  signed: boolean;
  subject: string;
  html: string;
  missing: Array<{ label: string; href: string }>;
  done: FirstLetterDone | null;
  error: string | null;
};

function itemFor(claimId: string, entry: PackEntry, people: Contacts): FirstLetterItem {
  const info = clientDraftInfo(entry.key);
  const person = entry.recipient === "tp_insurer" ? people.tp : entry.recipient === "own_insurer" ? people.own : people.client;
  const base = {
    key: entry.key,
    recipient: entry.recipient,
    recipientLabel: person.name,
    to: person.email,
    cc: entry.recipient === "tp_insurer" ? people.tp.cc : "",
    channel: entry.channel,
    approved: firstLetterApproved(entry.key),
    waitingWording: Boolean(info?.outlineOnly),
    signed: Boolean(info?.signed),
    done: latestAction(claimId, entry.key),
  };
  if (entry.key === "draft_courtesy_car") {
    return { ...base, title: info?.title || "Courtesy car agreement", subject: "", html: "", missing: [], error: `${WAITING_FOR_CAS_WORDING}. Nothing is generated.` };
  }
  try {
    const letter = letterPreview(claimId, entry.key);
    const missing = letter.missing.map((label) => ({ label, href: gapLink(claimId, label) }));
    if (!person.email) {
      const who = entry.recipient === "client" ? "Client" : entry.recipient === "own_insurer" ? "Client's own insurer" : "Third-party insurer";
      const label = entry.channel === "email" ? `${who} email` : `${who} email (to send it by email; it can still be posted)`;
      missing.push({ label, href: entry.recipient === "client" ? `/claims/${claimId}/details/client` : entry.recipient === "own_insurer" ? `/claims/${claimId}/details/insurer` : `/claims/${claimId}/details/tp1` });
    }
    return { ...base, title: letter.title, subject: letter.subject, html: letter.html, missing, error: null };
  } catch (error) {
    return { ...base, title: info?.title || entry.key, subject: "", html: "", missing: [], error: error instanceof Error ? error.message : "It could not be prepared." };
  }
}

export type FirstLettersView = { status: string; statusLabel: string; items: FirstLetterItem[]; earlier: FirstLetterItem[] };

/** The page: this status's pack, and any letters already made for an earlier status (kept on the file). */
export function firstLettersView(claimId: string): FirstLettersView | null {
  ready();
  const claim = get<{ claim_type: string | null }>(`SELECT claim_type FROM claims WHERE id = ?`, [claimId]);
  if (!claim) return null;
  const status = normalizeLiabilityStatus(claim.claim_type);
  const people = contacts(claimId);
  const pack = firstLettersFor(status);
  const items = pack.map((entry) => itemFor(claimId, entry, people));
  const inPack = new Set(pack.map((entry) => entry.key));
  const earlierKeys = all<{ template_key: string }>(`SELECT DISTINCT template_key FROM first_letter_actions WHERE claim_id = ?`, [claimId])
    .map((row) => String(row.template_key))
    .filter((key) => !inPack.has(key as PackEntry["key"]));
  const allEntries = [NON_FAULT, FAULT, SPLIT, DISPUTED].flat();
  const earlier = earlierKeys
    .map((key) => allEntries.find((entry) => entry.key === key))
    .filter((entry): entry is PackEntry => Boolean(entry))
    .map((entry) => itemFor(claimId, entry, people));
  return { status, statusLabel: liabilityStatusLabel(status), items, earlier };
}

function logAction(input: { claimId: string; key: string; action: string; actorId: string; documentId?: string | null; correspondenceId?: string | null; recipient?: string | null }) {
  run(
    `INSERT INTO first_letter_actions(id, claim_id, template_key, action, document_id, correspondence_id, recipient, actor_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("fla"), input.claimId, input.key, input.action, input.documentId || null, input.correspondenceId || null, input.recipient || null, input.actorId, nowUtcIso()],
  );
}

function recordStep(claimId: string, key: string, actorId: string, details: string, ids: { documentId?: string; correspondenceId?: string }) {
  const event = STEP_EVENTS[key];
  if (!event) return;
  // The supplied initial letter records its own step when produced as sent; the drafts record it here.
  recordClaimEvent({
    claimId,
    eventType: event as "initial_letter_tp_insurer",
    occurredAt: nowUtcIso(),
    actorId,
    details,
    channel: ids.correspondenceId ? "email" : "letter",
    documentId: ids.documentId,
    correspondenceId: ids.correspondenceId,
    source: "staff",
  });
}

export type FirstLetterIntent = "generate" | "send" | "mark_sent";

/** Generate on the file, send by email (simulated until the mailbox is live), or mark a posted letter as sent. */
export async function actOnFirstLetter(input: { claimId: string; actorId: string; key: string; intent: FirstLetterIntent; to?: string; cc?: string; accountLine?: string }) {
  ready();
  const view = firstLettersView(input.claimId);
  const item = [...(view?.items || []), ...(view?.earlier || [])].find((entry) => entry.key === input.key);
  if (!item) throw new Error("That letter is not one of this file's first letters.");
  if (item.waitingWording) throw new Error(`${item.title}: ${WAITING_FOR_CAS_WORDING}.`);
  if (input.intent !== "generate" && !item.approved) throw new Error(`${item.title} is waiting for Justin's approval. It can be generated and read, but not sent or marked as sent.`);
  const templateKey = input.key as DocumentTemplateKey;
  const supplied = !isClientDraftKey(input.key);
  // The supplied initial letter records its step itself when produced as sent.
  const markOnGenerate = input.intent === "mark_sent" && supplied && STEP_EVENTS[input.key] === "initial_letter_tp_insurer";
  const produced = generateClaimDocument({
    claimId: input.claimId,
    templateKey,
    actorId: input.actorId,
    recordOnFile: markOnGenerate,
    markSent: markOnGenerate,
    accountLine: input.accountLine,
  });
  if (input.intent === "generate") {
    logAction({ claimId: input.claimId, key: input.key, action: "generated", actorId: input.actorId, documentId: produced.documentId });
    return { documentId: produced.documentId, outcome: `${item.title} generated on the file. Not sent.` };
  }
  if (input.intent === "mark_sent") {
    if (!markOnGenerate) recordStep(input.claimId, input.key, input.actorId, `${item.title} marked as sent (posted or sent outside the CRM).`, { documentId: produced.documentId });
    logAction({ claimId: input.claimId, key: input.key, action: "marked_sent", actorId: input.actorId, documentId: produced.documentId });
    return { documentId: produced.documentId, outcome: `${item.title} marked as sent.` };
  }
  const to = String(input.to ?? item.to).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(`Enter an email address for ${item.recipientLabel}.`);
  const cc = String(input.cc ?? item.cc).trim();
  const letterAttached = item.channel === "letter";
  const body = letterAttached
    ? `Please find attached our letter, ${item.title.replace(/ \(draft\)$/, "")}, reference ${produced.letter.subject}.${cc ? `\n\nCopied to ${cc}.` : ""}`
    : produced.letter.text;
  const sent = await sendClaimEmail({
    claimId: input.claimId,
    actorId: input.actorId,
    to,
    subject: produced.letter.subject,
    body,
    templateKey: supplied ? templateKey : undefined,
    attachmentIds: letterAttached ? [produced.documentId] : [],
  });
  if (!sent.ok) throw new Error(sent.error || "It was not sent.");
  if (!supplied || STEP_EVENTS[input.key] !== "initial_letter_tp_insurer") {
    recordStep(input.claimId, input.key, input.actorId, `${item.title} sent to ${to}${cc ? `, copied to ${cc}` : ""}.`, { documentId: produced.documentId, correspondenceId: sent.correspondenceId });
  }
  logAction({ claimId: input.claimId, key: input.key, action: "sent", actorId: input.actorId, documentId: produced.documentId, correspondenceId: sent.correspondenceId, recipient: to });
  return { documentId: produced.documentId, outcome: `${item.title} sent to ${to}${sent.status === "simulated_sent" ? " (simulated: the mailbox is not connected)" : ""}.` };
}

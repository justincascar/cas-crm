import type { DatabaseSync } from "node:sqlite";
import { APPROVE_CHASER_TEMPLATES } from "../auth/roles";
import { CAS_CLAIMS_MAILBOX } from "../constants";
import { addCalendarDaysIso, formatUkDateTime, nowUtcIso } from "../dates";
import { CHASE_KIND_ORDER, chaseDefinition, isPaymentChaseKind, type ChaseKind } from "../domain/chase";
import { paymentDetailsComplete, BANK_DETAILS_MISSING_SETTINGS } from "../domain/payment-details";
import { chaseFileStateFromPosition, chaseStopReason } from "../domain/rules";
import { describeSendingHours, insideSendingHours } from "../domain/sending-hours";
import { sendOutboundEmail } from "../email/gateway";
import { chaseForClaim, listDueChases, pauseChase, type ChaseView } from "./chase";
import { automaticSentDetails, chaseWordingIllustration, markOutstandingChaseSent, prepareOutstandingChase, recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { isLiveOnlyEngineerEmail, ENGINEER_INSTRUCTION_MARKED_SENT, ENGINEER_INSTRUCTION_PREPARED } from "./engineers";
import { getInsurerPaymentDetails } from "./payment-details";
import { paymentRequestCopy } from "../domain/payment-chase";
import { listStaffPermissions } from "./permissions";
import { getSendingHours } from "./sending-hours";

/**
 * The automatic chaser (review notes R30 and R31). The server works through the due chases on its own, every few
 * minutes, whether or not anyone has the CRM open. Email sending is simulated until CAS's mailbox is connected, so each
 * chaser is produced from its template, filed on the claim and in Communications, and marked simulated.
 *
 * Only rules whose wording Justin has approved send. Before each send the file is worked out again: a chase with its
 * answer recorded, a reply on file since the last chase, a pause, or a closed or solicitor file does not go. Nothing goes
 * outside the sending hours. However long a chase has been due, one email goes and its clock restarts from that send,
 * so there is no backlog after the server has been off. Chases due to the same recipient on the same file go in one
 * email that lists each item.
 */

/** The renewal reminder is for staff and sends no email. */
export const AUTO_CHASE_KINDS: ChaseKind[] = CHASE_KIND_ORDER.filter((kind) => kind !== "hire_agreement_renewal");

export const COMBINED_CHASE_TEMPLATE = "combined_chase";
const RUN_EVERY_MS = 5 * 60 * 1000;

export function ensureAutoChaserTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chase_rule_approvals (
      kind TEXT PRIMARY KEY,
      approved INTEGER NOT NULL DEFAULT 0,
      changed_by TEXT,
      changed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chaser_runs (
      id TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL,
      outcome TEXT NOT NULL,
      emails INTEGER NOT NULL DEFAULT 0,
      chases INTEGER NOT NULL DEFAULT 0,
      held_json TEXT
    );
  `);
}

function ready() {
  ensureAutoChaserTables(getDb());
}

export type ChaseRuleApproval = { kind: ChaseKind; title: string; approved: boolean; changedBy: string | null; changedAt: string | null };

export function chaseRuleApprovals(): ChaseRuleApproval[] {
  ready();
  const rows = new Map(
    all<{ kind: string; approved: number; name: string | null; changed_at: string | null }>(
      `SELECT a.kind, a.approved, s.name, a.changed_at FROM chase_rule_approvals a LEFT JOIN staff s ON s.id = a.changed_by`,
    ).map((row) => [row.kind, row]),
  );
  return AUTO_CHASE_KINDS.map((kind) => {
    const row = rows.get(kind);
    return {
      kind,
      title: chaseDefinition(kind).title,
      approved: Number(row?.approved || 0) === 1,
      changedBy: row?.name ? String(row.name) : null,
      changedAt: row?.changed_at ? String(row.changed_at) : null,
    };
  });
}

export function isChaseRuleApproved(kind: string): boolean {
  ready();
  return Number(get<{ approved: number }>(`SELECT approved FROM chase_rule_approvals WHERE kind = ?`, [kind])?.approved || 0) === 1;
}

export function canApproveChasers(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(APPROVE_CHASER_TEMPLATES);
}

/** Justin's switch for one rule. Off until he approves its wording. */
export function setChaseRuleApproval(input: { kind: string; approved: boolean; actorId: string }) {
  ready();
  if (!canApproveChasers(input.actorId)) throw new Error("Only Justin can approve a chaser's wording for automatic sending.");
  if (!AUTO_CHASE_KINDS.includes(input.kind as ChaseKind)) throw new Error("Unknown chaser.");
  run(
    `INSERT INTO chase_rule_approvals(kind, approved, changed_by, changed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET approved = excluded.approved, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
    [input.kind, input.approved ? 1 : 0, input.actorId, nowUtcIso()],
  );
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, 'chase_rule', ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    input.approved ? "chaser_approved" : "chaser_approval_withdrawn",
    input.kind,
    `${chaseDefinition(input.kind as ChaseKind).title}: ${input.approved ? "approved for automatic sending" : "automatic sending switched off"}.`,
  ]);
}

type Held = { file: string; what: string; why: string };

export type ChaserRunResult = { outcome: string; emails: number; chases: number; held: Held[] };

function fileState(claimId: string): string | null {
  const row = get<{ current_position: string | null; lit: number; closed: number; solicitors: number }>(
    `SELECT c.current_position,
            EXISTS(SELECT 1 FROM litigation l WHERE l.claim_id = c.id) AS lit,
            EXISTS(SELECT 1 FROM claim_events e WHERE e.claim_id = c.id AND e.event_type = 'case_closed') AS closed,
            EXISTS(SELECT 1 FROM claim_events e WHERE e.claim_id = c.id AND e.event_type = 'handed_to_solicitors') AS solicitors
     FROM claims c WHERE c.id = ?`,
    [claimId],
  );
  if (!row) return "The file was not found.";
  return chaseStopReason(
    chaseFileStateFromPosition({
      currentPosition: row.current_position,
      hasLitigation: Number(row.lit) > 0,
      paused: false,
      caseClosedEvent: Number(row.closed) > 0,
      handedToSolicitorsEvent: Number(row.solicitors) > 0,
    }),
  );
}

/** A reply from the recipient filed since the chase's clock: a person reads it before anything else goes. */
function replySince(claimId: string, from: string, since: string | null): boolean {
  if (!from) return false;
  return Boolean(
    get<{ id: string }>(
      `SELECT id FROM correspondence WHERE claim_id = ? AND direction = 'incoming' AND lower(from_address) LIKE ? AND created_at >= ? LIMIT 1`,
      [claimId, `%${from.toLowerCase()}%`, since || "0000"],
    ),
  );
}

/** Why a due chase is held back this run, or null when it can go. */
function holdReason(view: ChaseView, asAt: string): string | null {
  const kind = view.kind as ChaseKind;
  if (!isChaseRuleApproved(kind)) return "Waiting for Justin to approve this chaser's wording.";
  const stop = fileState(view.claimId);
  if (stop) return stop;
  const fresh = chaseForClaim(kind, view.claimId, asAt);
  if (!fresh || !fresh.due) return "No longer due when the file was checked again.";
  if (fresh.outcomeOnFile) return "The answer is on the file.";
  if (fresh.handlerState === "paused" || fresh.handlerState === "cancelled") return "Paused on the file.";
  if (fresh.contactMissing || !fresh.contactEmail) return fresh.contactMissingMessage || "No email address for the recipient.";
  if (isLiveOnlyEngineerEmail(fresh.contactEmail)) return "The recipient is CAS's real engineer, kept for live use only.";
  if (replySince(view.claimId, fresh.contactEmail, fresh.clockAt)) return "A reply from the recipient is on file. A person reads it first.";
  if (isPaymentChaseKind(kind) && !paymentDetailsComplete(getInsurerPaymentDetails())) return BANK_DETAILS_MISSING_SETTINGS;
  return null;
}

/** The paragraphs of a chaser between its greeting and its sign-off. */
function chaseParagraphs(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^Dear /.test(line));
  const end = lines.findIndex((line) => /^(Kind regards|Yours (faithfully|sincerely)),?$/.test(line.trim()));
  if (start < 0 || end <= start) return body.trim();
  return lines.slice(start + 1, end).join("\n").trim();
}

function signOff(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((line) => /^(Kind regards|Yours (faithfully|sincerely)),?$/.test(line.trim()));
  return end >= 0 ? lines.slice(end).join("\n").trim() : `Kind regards,\nComplete Accident Solutions Ltd\n${CAS_CLAIMS_MAILBOX}`;
}

/** R31: one email to one recipient listing each outstanding item, built from each approved chaser's own wording. */
export function combinedChaseEmail(fileReference: string, parts: Array<{ title: string; body: string }>) {
  const greeting = parts[0]?.body.replace(/\r\n/g, "\n").split("\n").find((line) => /^Dear /.test(line)) || "Dear Sir / Madam,";
  const items = parts.map((part, index) => `${index + 1}. ${part.title}\n\n${chaseParagraphs(part.body)}`);
  const subject = `Our ref: ${fileReference} — ${parts.length} outstanding items`;
  const body = [greeting, "", `We are still waiting for the following on ${fileReference}:`, "", ...items.flatMap((item) => [item, ""]), signOff(parts[0]?.body || "")].join("\n");
  return { subject, body };
}

async function sendGroup(claimId: string, fileReference: string, views: ChaseView[], at: string): Promise<{ ok: boolean; why?: string }> {
  const prepared = views.map((view) => ({ view, email: prepareOutstandingChase({ claimId, actorId: "", kind: view.kind as ChaseKind }) }));
  const to = prepared[0]!.email.to;
  if (prepared.length === 1) {
    const { view, email } = prepared[0]!;
    const result = await sendOutboundEmail({ to, subject: email.subject, body: email.body });
    if (!result.ok) {
      recordFailure(claimId, email.correspondenceId, to, result.error);
      return { ok: false, why: result.error };
    }
    markOutstandingChaseSent({
      claimId,
      correspondenceId: email.correspondenceId,
      actorId: "",
      kind: view.kind as ChaseKind,
      deliveredByMailbox: true,
      occurredAt: at,
      automatic: { simulated: result.status === "simulated_sent" },
    });
    return { ok: true };
  }
  const combined = combinedChaseEmail(
    fileReference,
    prepared.map(({ view, email }) => ({ title: view.title, body: email.body })),
  );
  const combinedId = newId("corr");
  run(
    `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, template_key, created_at)
     VALUES (?, ?, 'outgoing', 'email', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [combinedId, claimId, combined.subject, combined.body.slice(0, 180), combined.body, to, CAS_CLAIMS_MAILBOX, ENGINEER_INSTRUCTION_PREPARED, COMBINED_CHASE_TEMPLATE, nowUtcIso()],
  );
  const result = await sendOutboundEmail({ to, subject: combined.subject, body: combined.body });
  if (!result.ok) {
    recordFailure(claimId, combinedId, to, result.error);
    return { ok: false, why: result.error };
  }
  const simulated = result.status === "simulated_sent";
  run(`UPDATE correspondence SET sent_status = ? WHERE id = ?`, [simulated ? "simulated_sent" : ENGINEER_INSTRUCTION_MARKED_SENT, combinedId]);
  recordClaimEvent({
    claimId,
    eventType: "outgoing_email",
    occurredAt: at,
    details: `${automaticSentDetails(combined.subject, to, { simulated })} One email for ${prepared.length} items due to the same recipient: ${prepared.map(({ view }) => view.title).join("; ")}.`,
    channel: "email",
    correspondenceId: combinedId,
    source: "system",
  });
  for (const { view, email } of prepared) {
    markOutstandingChaseSent({
      claimId,
      correspondenceId: email.correspondenceId,
      actorId: "",
      kind: view.kind as ChaseKind,
      deliveredByMailbox: true,
      occurredAt: at,
      automatic: { simulated, combinedId },
    });
  }
  return { ok: true };
}

function recordFailure(claimId: string, correspondenceId: string, to: string, error: string) {
  recordClaimEvent({
    claimId,
    eventType: "email_send_failed",
    occurredAt: nowUtcIso(),
    details: `Automatic chaser not sent to ${to}. ${error}`,
    channel: "email",
    correspondenceId,
    source: "system",
  });
}

/** One pass of the automatic chaser. Safe to run at any time: a chase sent restarts its own clock. */
export async function runAutomaticChasers(at: Date = new Date()): Promise<ChaserRunResult> {
  ready();
  const hours = getSendingHours();
  if (!insideSendingHours(at, hours)) {
    return logRun({ outcome: `Outside the sending hours (${describeSendingHours(hours)}). Nothing was sent.`, emails: 0, chases: 0, held: [] });
  }
  const held: Held[] = [];
  const groups = new Map<string, { claimId: string; fileReference: string; views: ChaseView[] }>();
  for (const view of listDueChases(at.toISOString())) {
    if (!AUTO_CHASE_KINDS.includes(view.kind as ChaseKind)) continue;
    const why = holdReason(view, at.toISOString());
    if (why) {
      held.push({ file: String(view.fileReference || view.claimId), what: view.title, why });
      continue;
    }
    const key = `${view.claimId}|${view.contactEmail.trim().toLowerCase()}`;
    const group = groups.get(key) || { claimId: view.claimId, fileReference: String(view.fileReference || ""), views: [] };
    group.views.push(view);
    groups.set(key, group);
  }
  let emails = 0;
  let chases = 0;
  for (const group of groups.values()) {
    try {
      const sent = await sendGroup(group.claimId, group.fileReference, group.views, at.toISOString());
      if (sent.ok) {
        emails += 1;
        chases += group.views.length;
      } else {
        for (const view of group.views) held.push({ file: group.fileReference, what: view.title, why: `Not sent: ${sent.why}` });
      }
    } catch (error) {
      for (const view of group.views) held.push({ file: group.fileReference, what: view.title, why: error instanceof Error ? error.message : "Not sent." });
    }
  }
  const outcome = emails ? `${emails} chaser ${emails === 1 ? "email" : "emails"} produced (${chases} ${chases === 1 ? "chase" : "chases"}).` : "No chaser was due to go.";
  return logRun({ outcome, emails, chases, held });
}

function logRun(result: ChaserRunResult): ChaserRunResult {
  run(`INSERT INTO chaser_runs(id, ran_at, outcome, emails, chases, held_json) VALUES (?, ?, ?, ?, ?, ?)`, [
    newId("run"),
    nowUtcIso(),
    result.outcome,
    result.emails,
    result.chases,
    JSON.stringify(result.held.slice(0, 200)),
  ]);
  // Keep a fortnight of runs.
  run(`DELETE FROM chaser_runs WHERE ran_at < ?`, [addCalendarDaysIso(nowUtcIso(), -14)]);
  return result;
}

export type ChaserRunView = { ranAt: string; outcome: string; emails: number; held: Held[] };

/** The latest pass, and the latest pass that produced an email, for Settings and Automations. */
export function lastChaserRuns(): { latest: ChaserRunView | null; lastSent: ChaserRunView | null } {
  ready();
  const map = (row: { ran_at: string; outcome: string; emails: number; held_json: string | null } | undefined): ChaserRunView | null => {
    if (!row) return null;
    let held: Held[] = [];
    try {
      held = row.held_json ? (JSON.parse(row.held_json) as Held[]) : [];
    } catch {
      held = [];
    }
    return { ranAt: String(row.ran_at), outcome: String(row.outcome), emails: Number(row.emails), held };
  };
  return {
    latest: map(get(`SELECT ran_at, outcome, emails, held_json FROM chaser_runs ORDER BY ran_at DESC, rowid DESC LIMIT 1`)),
    lastSent: map(get(`SELECT ran_at, outcome, emails, held_json FROM chaser_runs WHERE emails > 0 ORDER BY ran_at DESC, rowid DESC LIMIT 1`)),
  };
}

export function describeRun(run: ChaserRunView | null): string {
  return run ? `${formatUkDateTime(run.ranAt)}: ${run.outcome}` : "Not run yet.";
}

/**
 * R34: the fictional files had chases due since September. Once, each one due more than a fortnight is paused with a
 * note, so the lists show what is genuinely due and the automatic chaser does not pick them up. Nothing is sent, and
 * a person can resume any of them. Real files are never touched.
 */
export function tidyLongOverdueDemoChases(asAt: string = nowUtcIso()) {
  ready();
  const key = "demo_chases_paused_r34";
  if (get(`SELECT value FROM settings WHERE key = ?`, [key])) return 0;
  const cutoff = addCalendarDaysIso(asAt, -14);
  let tidied = 0;
  for (const view of listDueChases(asAt)) {
    if (!String(view.fileReference || "").startsWith("TEST-")) continue;
    if (!view.dueAt || view.dueAt >= cutoff || !AUTO_CHASE_KINDS.includes(view.kind as ChaseKind)) continue;
    pauseChase(view.kind as ChaseKind, view.claimId, "Fictional demonstration data: long past due, paused when the automatic chaser was added. Resume it to chase again.");
    recordClaimEvent({
      claimId: view.claimId,
      eventType: "other",
      occurredAt: asAt,
      details: `Fictional demonstration data tidied: ${view.title} had been due since ${formatUkDateTime(view.dueAt)}. It is paused. Nothing was sent. Resume it on the file to chase again.`,
      source: "system",
    });
    tidied += 1;
  }
  run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [key, asAt]);
  return tidied;
}

let started = false;

/** Started with the server (instrumentation). The page check sets CAS_PAGE_CHECK so this does not run then. */
export function startAutomaticChasers() {
  if (started) return;
  if (process.env.CAS_PAGE_CHECK === "1") return;
  started = true;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      tidyLongOverdueDemoChases();
      await runAutomaticChasers();
    } catch {
      /* A failed pass sends nothing; the next pass tries again. */
    } finally {
      running = false;
    }
  };
  void pass();
  const timer = setInterval(() => void pass(), RUN_EVERY_MS);
  timer.unref?.();
}

/**
 * A payment chaser when no TEST file has one that could go: the same wording with example figures, clearly labelled.
 * The first request and the reminder are both shown, because the chaser sends whichever stage the file has reached.
 */
function paymentIllustration(kind: ChaseKind, fileReference: string): { subject: string; body: string; note: string } | null {
  const head = chaseDefinition(kind).paymentHead;
  if (!isPaymentChaseKind(kind) || !head) return null;
  const at = nowUtcIso();
  const copy = (stage: "first" | "reminder") =>
    paymentRequestCopy({
      stage,
      fileReference,
      theirRef: "[their reference]",
      head,
      agreedPence: 100000,
      claimedPence: 100000,
      receivedPence: 0,
      outstandingPence: 100000,
      bank: getInsurerPaymentDetails(),
      paymentTerm: null,
      asAt: at,
      hirePackSentOn: null,
      firstChaseOn: stage === "reminder" ? at : null,
      handlerName: "[handler's name]",
    });
  const first = copy("first");
  const reminder = copy("reminder");
  return {
    subject: first.subject,
    body: `First request:

${first.body}

────────

Reminder (Subject: ${reminder.subject}):

${reminder.body}`,
    note: "Illustration with example figures (£1,000.00 agreed and outstanding), because no TEST file has this chaser due to a recipient with an email address. On a real file the figures, references and dates are that file's.",
  };
}

export type ChaserPreview = { kind: ChaseKind; title: string; fileReference: string | null; to: string | null; subject: string | null; body: string | null; note: string | null };

/**
 * R46: exactly what each chaser would send, made by the same code the automatic chaser uses, on a TEST file. It runs
 * inside a savepoint that is rolled back, so making a preview files nothing, sends nothing and changes no clock.
 */
function previewOn(claimId: string, kind: ChaseKind): { to: string; subject: string; body: string } | null {
  const db = getDb();
  db.exec("SAVEPOINT chaser_preview");
  try {
    const email = prepareOutstandingChase({ claimId, actorId: "", kind });
    return { to: email.to, subject: email.subject, body: email.body };
  } catch {
    return null;
  } finally {
    db.exec("ROLLBACK TO chaser_preview");
    db.exec("RELEASE chaser_preview");
  }
}

type ChaserWordingPreviews = { previews: ChaserPreview[]; combined: { fileReference: string; subject: string; body: string; sameFile: boolean } | null };

export function chaserWordingPreviews(): ChaserWordingPreviews {
  ready();
  // Working out a file's chases can tidy its records; all of it is rolled back, so a preview changes nothing.
  const db = getDb();
  db.exec("SAVEPOINT chaser_previews");
  try {
    return buildChaserWordingPreviews();
  } finally {
    db.exec("ROLLBACK TO chaser_previews");
    db.exec("RELEASE chaser_previews");
  }
}

function buildChaserWordingPreviews(): ChaserWordingPreviews {
  const claims = all<{ id: string; file_reference: string }>(
    `SELECT id, file_reference FROM claims WHERE file_reference LIKE 'TEST-%' ORDER BY file_reference LIMIT 60`,
  );
  const byClaim = new Map<string, Array<{ title: string; to: string; body: string }>>();
  const previews = AUTO_CHASE_KINDS.map((kind): ChaserPreview => {
    const title = chaseDefinition(kind).title;
    for (const claim of claims) {
      if (!chaseForClaim(kind, claim.id)) continue;
      const email = previewOn(claim.id, kind);
      if (!email) continue;
      const list = byClaim.get(claim.file_reference) || [];
      list.push({ title, to: email.to, body: email.body });
      byClaim.set(claim.file_reference, list);
      return { kind, title, fileReference: claim.file_reference, to: email.to, subject: email.subject, body: email.body, note: null };
    }
    const illustration = paymentIllustration(kind, claims[0]?.file_reference || "TEST-0001");
    if (illustration) return { kind, title, fileReference: null, to: null, ...illustration };
    const fallback = claims[0] ? chaseWordingIllustration(kind, claims[0].id) : null;
    if (fallback && claims[0]) {
      return {
        kind,
        title,
        fileReference: null,
        to: null,
        ...fallback,
        note: `Illustration with example figures on ${claims[0].file_reference}'s details, because no TEST file has this chaser due to a recipient with an email address. On a real file the names, references and dates are that file's.`,
      };
    }
    return { kind, title, fileReference: null, to: null, subject: null, body: null, note: "No TEST file has this chaser due to a recipient with an email address, so there is no example to show yet." };
  });
  // The combined email: two chasers on one TEST file to the same recipient, or else the first two examples together.
  for (const [fileReference, parts] of byClaim) {
    const same = parts.filter((part) => part.to === parts[0]!.to);
    if (same.length >= 2) return { previews, combined: { ...combinedChaseEmail(fileReference, same), fileReference, sameFile: true } };
  }
  const shown = previews.filter((preview) => preview.body);
  if (shown.length < 2) return { previews, combined: null };
  const fileReference = shown[0]!.fileReference!;
  const combined = combinedChaseEmail(
    fileReference,
    shown.slice(0, 2).map((preview) => ({ title: preview.title, body: preview.body! })),
  );
  return { previews, combined: { ...combined, fileReference, sameFile: false } };
}

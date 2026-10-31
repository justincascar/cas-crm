import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * R34: "Sent" is shown only with evidence from a real mailbox. Early prototype rows were stored as "sent" although
 * email has always been simulated here, and no code writes that status now (a real send is recorded with the mailbox's
 * confirmation). Each such row is corrected to simulated, once, with a note on its file.
 */
export function correctUnprovenSentEmails(db: DatabaseSync) {
  let rows: Array<{ id: string; claim_id: string; subject: string | null; created_at: string }> = [];
  try {
    rows = db
      .prepare(`SELECT id, claim_id, subject, created_at FROM correspondence WHERE sent_status = 'sent' AND direction = 'outgoing'`)
      .all() as typeof rows;
  } catch {
    return;
  }
  const now = new Date().toISOString();
  for (const row of rows) {
    db.prepare(`UPDATE correspondence SET sent_status = 'simulated_sent' WHERE id = ? AND sent_status = 'sent'`).run(row.id);
    db.prepare(
      `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, correspondence_id, source)
       VALUES (?, ?, 'other', 'Other', ?, ?, ?, ?, 'system')`,
    ).run(
      `event_${randomUUID()}`,
      row.claim_id,
      `Correction: the email "${row.subject || "email"}" of ${row.created_at.slice(0, 10).split("-").reverse().join("/")} was recorded as sent, but email sending has always been simulated in this prototype and no mailbox confirmed it. Its status is now simulated. Nothing was sent.`,
      now,
      now,
      row.id,
    );
  }
}

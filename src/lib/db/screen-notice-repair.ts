import type { DatabaseSync } from "node:sqlite";
import { containsScreenNotice, withoutScreenNotices, withoutScreenNoticesText } from "../documents/screen-notices";

/**
 * R42: letters made before R42 carried notes for staff ("Wording is taken from CAS's supplied letter and email
 * templates…") inside the letter, so they would have printed and gone out. Those notes are taken out of unsigned
 * generated documents and of emails not yet sent. Signed documents and anything already sent are left as they were
 * (their record must not change); they are cleaned whenever they are shown, printed or attached.
 */
export function removeScreenNoticesFromStoredLetters(db: DatabaseSync) {
  let docs: Array<{ id: string; body_html: string }> = [];
  try {
    docs = db
      .prepare(
        `SELECT id, body_html FROM documents
         WHERE COALESCE(signed, 0) = 0 AND body_html LIKE '%<p class="text-xs">%'
           AND id NOT IN (SELECT document_id FROM esign_requests WHERE document_id IS NOT NULL)`,
      )
      .all() as typeof docs;
  } catch {
    return;
  }
  for (const doc of docs) {
    if (!containsScreenNotice(doc.body_html)) continue;
    const cleaned = withoutScreenNotices(doc.body_html);
    if (cleaned !== doc.body_html) db.prepare(`UPDATE documents SET body_html = ? WHERE id = ?`).run(cleaned, doc.id);
  }

  let emails: Array<{ id: string; body: string }> = [];
  try {
    emails = db
      .prepare(`SELECT id, body FROM correspondence WHERE direction = 'outgoing' AND sent_status = 'prepared_not_sent' AND body IS NOT NULL`)
      .all() as typeof emails;
  } catch {
    return;
  }
  for (const email of emails) {
    if (!containsScreenNotice(email.body)) continue;
    db.prepare(`UPDATE correspondence SET body = ? WHERE id = ?`).run(withoutScreenNoticesText(email.body), email.id);
  }
}

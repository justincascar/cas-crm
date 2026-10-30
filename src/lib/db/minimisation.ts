import type { DatabaseSync } from "node:sqlite";

/**
 * Data repair for J15 licence-check minimisation. Free-text notes on licence checks, and free-text conviction details
 * on the client screen, are criminal offence data the CRM does not need. They are removed; a conviction answer
 * becomes "yes", and the history says the details were removed. Runs once per row.
 */
export function minimiseConvictionText(db: DatabaseSync) {
  const licenceColumns = new Set((db.prepare(`PRAGMA table_info(licence_checks)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (licenceColumns.has("notes")) db.exec(`UPDATE licence_checks SET notes = NULL WHERE notes IS NOT NULL`);
  const rows = db.prepare(`SELECT claim_id, data_json FROM claim_screen_data WHERE screen_key = 'client' AND data_json LIKE '%"convictions"%'`).all() as Array<{
    claim_id: string;
    data_json: string;
  }>;
  const at = new Date().toISOString();
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!("convictions" in data)) continue;
    const had = String(data.convictions ?? "").trim();
    delete data.convictions;
    if (had && !data.convictionsDeclared) data.convictionsDeclared = "yes";
    db.prepare(`UPDATE claim_screen_data SET data_json = ? WHERE claim_id = ? AND screen_key = 'client'`).run(JSON.stringify(data), row.claim_id);
    if (had) {
      db.prepare(
        `INSERT OR IGNORE INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES (?, ?, 'other', 'Conviction details removed', ?, ?, ?, NULL, 'system')`,
      ).run(
        `ev-convictions-minimised-${row.claim_id}`,
        row.claim_id,
        "Free-text conviction details on the Client screen were removed: the CRM keeps only whether there are motoring convictions, and points and endorsement codes on the licence check.",
        at,
        at,
      );
    }
  }
}

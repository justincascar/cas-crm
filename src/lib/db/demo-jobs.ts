import type { DatabaseSync } from "node:sqlite";
import { londonTodayIso, nowUtcIso } from "../dates";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * TEST-0003 once showed a hire car collected on 03/10/2026 with no hire end.
 * That date was not written by the seed or by the Hire car collection job, which records the collection and the hire end together.
 * Only that stray date is removed, and only when no hire end, no completed collection job, and no hire-collected handover exist.
 * Any other collection date is left as it is. The renewal chase still treats a real collection date as hire ended.
 */
export function clearFalseDemonstrationHireCollection(db: DatabaseSync) {
  const episode = db.prepare(`SELECT collection_at, billing_end_at FROM hire_episodes WHERE id = 'h-c3'`).get() as
    | { collection_at: string | null; billing_end_at: string | null }
    | undefined;
  if (!episode?.collection_at || episode.billing_end_at) return;
  if (!String(episode.collection_at).startsWith("2026-10-03")) return;
  let job: unknown;
  let handover: unknown;
  try {
    job = db
      .prepare(
        `SELECT id FROM day_assignments WHERE claim_id = 'c3' AND job_kind = 'hire_collection' AND completed_at IS NOT NULL LIMIT 1`,
      )
      .get();
  } catch {
    job = undefined;
  }
  try {
    handover = db
      .prepare(`SELECT id FROM vehicle_handovers WHERE claim_id = 'c3' AND event_kind = 'hire_collected' LIMIT 1`)
      .get();
  } catch {
    handover = undefined;
  }
  if (job || handover) return;
  db.prepare(`UPDATE hire_episodes SET collection_at = NULL WHERE id = 'h-c3' AND billing_end_at IS NULL`).run();
}

/** Demonstration driver and mechanic always have TEST-0003 for today, so a phone trial has a job. */
export function ensureDemoDayJobs(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_assignments (
      id TEXT PRIMARY KEY,
      assignee_id TEXT REFERENCES staff(id),
      job_kind TEXT NOT NULL,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      hire_episode_id TEXT REFERENCES hire_episodes(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      created_by TEXT REFERENCES staff(id),
      created_at TEXT NOT NULL
    );
  `);
  let claim: { id: string } | undefined;
  try {
    claim = db.prepare("SELECT id FROM claims WHERE id = ?").get("c3") as { id: string } | undefined;
  } catch {
    return;
  }
  const episode = db.prepare("SELECT id FROM hire_episodes WHERE id = ?").get("h-c3") as { id: string } | undefined;
  const driver = db.prepare("SELECT id FROM staff WHERE id = ?").get("staff-driver") as { id: string } | undefined;
  const mechanic = db.prepare("SELECT id FROM staff WHERE id = ?").get("staff-mechanic") as { id: string } | undefined;
  if (!claim || !driver || !mechanic) return;
  const workDate = londonTodayIso();
  const at = nowUtcIso();
  if (episode) {
    const existing = db
      .prepare(
        "SELECT id FROM day_assignments WHERE assignee_id = ? AND job_kind = 'handover' AND claim_id = ? AND work_date = ?",
      )
      .get(driver.id, claim.id, workDate);
    if (!existing) {
      db.prepare(
        `INSERT INTO day_assignments(id, assignee_id, job_kind, claim_id, hire_episode_id, work_date, created_by, created_at)
         VALUES (?, ?, 'handover', ?, ?, ?, 'staff-justin', ?)`,
      ).run(id("job"), driver.id, claim.id, episode.id, workDate, at);
    }
  }
  const repair = db
    .prepare("SELECT id FROM day_assignments WHERE assignee_id = ? AND job_kind = 'repair' AND claim_id = ? AND work_date = ?")
    .get(mechanic.id, claim.id, workDate);
  if (!repair) {
    db.prepare(
      `INSERT INTO day_assignments(id, assignee_id, job_kind, claim_id, hire_episode_id, work_date, created_by, created_at)
       VALUES (?, ?, 'repair', ?, NULL, ?, 'staff-justin', ?)`,
    ).run(id("job"), mechanic.id, claim.id, workDate, at);
  }
}

/**
 * A delivery job whose hire has already started is done. Close any left open, with a history note, so it does not
 * show as overdue. TEST-0004's fictional September collection, booked for a car that was never collected, is
 * cancelled with a note.
 */
export function closeDeliveriesForStartedHires(db: DatabaseSync) {
  let open: Array<{ id: string; claim_id: string; started_at: string; assignee_id: string | null }> = [];
  try {
    open = db
      .prepare(
        `SELECT a.id, a.claim_id, he.started_at, a.assignee_id
         FROM day_assignments a JOIN hire_episodes he ON he.id = a.hire_episode_id
         WHERE a.job_kind = 'hire_delivery' AND a.completed_at IS NULL AND a.cancelled_at IS NULL AND he.started_at IS NOT NULL`,
      )
      .all() as typeof open;
  } catch {
    return;
  }
  const now = new Date().toISOString();
  for (const job of open) {
    db.prepare(
      `UPDATE day_assignments SET completed_at = ?, actual_occurred_at = COALESCE(actual_occurred_at, ?), actual_driver_id = COALESCE(actual_driver_id, assignee_id)
       WHERE id = ? AND completed_at IS NULL`,
    ).run(now, job.started_at, job.id);
    db.prepare(
      `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
       VALUES (?, ?, 'other', 'Delivery job closed', ?, ?, ?, NULL, 'system')`,
    ).run(
      `ev-close-${job.id}`,
      job.claim_id,
      "Data repair: the hire had already started, so the delivery job was closed. It was left open by mistake.",
      now,
      now,
    );
  }
  try {
    const stale = db
      .prepare(
        `SELECT a.id FROM day_assignments a JOIN hire_episodes he ON he.id = a.hire_episode_id
         WHERE a.claim_id = 'c4' AND a.job_kind = 'hire_collection' AND a.completed_at IS NULL AND a.cancelled_at IS NULL
           AND a.work_date < '2026-10-15' AND he.collection_at IS NULL`,
      )
      .all() as Array<{ id: string }>;
    for (const job of stale) {
      db.prepare(`UPDATE day_assignments SET cancelled_at = ? WHERE id = ?`).run(now, job.id);
      db.prepare(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES (?, 'c4', 'other', 'Collection job cancelled', ?, ?, ?, NULL, 'system')`,
      ).run(`ev-cancel-${job.id}`, "Demonstration data tidied: an old collection booking for a car still on hire was cancelled.", now, now);
    }
  } catch {
    /* Older databases without these columns have nothing to tidy. */
  }
}

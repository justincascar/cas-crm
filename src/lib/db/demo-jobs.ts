import type { DatabaseSync } from "node:sqlite";
import { londonTodayIso, nowUtcIso } from "../dates";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Demonstration driver and mechanic always have TEST-0003 for today, so a phone trial has a job. */
export function ensureDemoDayJobs(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_assignments (
      id TEXT PRIMARY KEY,
      assignee_id TEXT NOT NULL REFERENCES staff(id),
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

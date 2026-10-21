import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso, utcFromLondonDateTime } from "../dates";
import { eventLabel } from "../domain/events";

/**
 * Demonstration history so a stored flag is not the only sign a step happened.
 * Dates are taken from values already on the file. Nothing is invented, and
 * money, offers and TEST-0005's storage end are left alone.
 */
export function ensureStepHistoryDemonstration(db: DatabaseSync) {
  const now = nowUtcIso();
  for (const claimId of ["c8", "c9"]) {
    const claim = one<{
      recovery_status: string | null;
      roadworthiness_assessed_at: string | null;
    }>(
      db,
      `SELECT recovery_status, roadworthiness_assessed_at FROM claims WHERE id = ?`,
      [claimId],
    );
    if (!claim) continue;
    const complete = claim.recovery_status === "complete" || claim.recovery_status === "completed";
    const assessed = String(claim.roadworthiness_assessed_at || "").trim();
    if (complete && assessed && !hasEvent(db, claimId, "recovery_completed")) {
      insertEvent(db, {
        id: `ev-${claimId}-rec-demo`,
        claimId,
        type: "recovery_completed",
        at: assessed,
        now,
        details:
          "Demonstration data. Recovery is marked complete on this file and there was no recovery event. The date is the roadworthiness assessment already stored, because no separate recovery date is on the file.",
      });
    }
  }

  const booked = one<{ occurred_at: string }>(
    db,
    `SELECT occurred_at FROM claim_events WHERE claim_id = 'c8' AND event_type = 'engineer_inspection_booked' ORDER BY occurred_at ASC LIMIT 1`,
  );
  if (booked?.occurred_at && !hasEvent(db, "c8", "engineer_instructed")) {
    insertEvent(db, {
      id: "ev-c8-eng-demo",
      claimId: "c8",
      type: "engineer_instructed",
      at: booked.occurred_at,
      now,
      details:
        "Demonstration data. Engineer inspections are already on this file and there was no engineer-instructed event. The date is the inspection booking already stored.",
    });
  }

  const storage = one<{ storage_status: string | null; storage_billing_end_on: string | null }>(
    db,
    `SELECT storage_status, storage_billing_end_on FROM claims WHERE id = 'c8'`,
  );
  const endDay = calendarDay(storage?.storage_billing_end_on);
  if (storage?.storage_status === "ended" && endDay && !hasEvent(db, "c8", "storage_ended")) {
    insertEvent(db, {
      id: "ev-c8-storage-demo",
      claimId: "c8",
      type: "storage_ended",
      at: utcFromLondonDateTime(`${endDay}T09:00`),
      now,
      details:
        "Demonstration data. Storage is marked ended on this file and there was no storage-ended event. The date is the storage end already stored.",
    });
  }
}

function hasEvent(db: DatabaseSync, claimId: string, eventType: string): boolean {
  return Boolean(one(db, `SELECT id FROM claim_events WHERE claim_id = ? AND event_type = ? LIMIT 1`, [claimId, eventType]));
}

function insertEvent(
  db: DatabaseSync,
  input: { id: string; claimId: string; type: string; at: string; now: string; details: string },
) {
  if (one(db, `SELECT id FROM claim_events WHERE id = ?`, [input.id])) return;
  db.prepare(
    `INSERT INTO claim_events(
      id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'staff-megan', 'system', 'staff')`,
  ).run(input.id, input.claimId, input.type, eventLabel(input.type), input.details, input.at, input.now);
}

function calendarDay(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function one<T>(db: DatabaseSync, sql: string, params: Array<string | number> = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

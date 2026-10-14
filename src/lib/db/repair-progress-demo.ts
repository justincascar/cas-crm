import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, londonDateIso, nowUtcIso, utcFromLondonDateTime } from "../dates";
import { eventLabel } from "../domain/events";
import {
  REPAIR_PROGRESS_GAP_DAYS_DEFAULT,
  REPAIR_PROGRESS_GAP_SETTING,
  inclusiveLondonDays,
} from "../domain/repair-progress";

/**
 * Demonstration dates for TEST-0008 and an unexplained gap on TEST-0007.
 * Dates are taken from events already stored on those files. Nothing is inferred
 * for any other claim, and hire money is not touched.
 */
export function ensureRepairProgressDemonstration(db: DatabaseSync) {
  ensureRepairGapSetting(db);
  ensureTest0008RepairHistory(db);
  ensureTest0007UnexplainedGap(db);
}

export function ensureRepairGapSetting(db: DatabaseSync) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(REPAIR_PROGRESS_GAP_SETTING) as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(
      REPAIR_PROGRESS_GAP_SETTING,
      String(REPAIR_PROGRESS_GAP_DAYS_DEFAULT),
    );
  }
}

function ensureTest0008RepairHistory(db: DatabaseSync) {
  const started = one<{ occurred_at: string }>(db, `SELECT occurred_at FROM claim_events WHERE id = 'ev-c8-start'`);
  const done = one<{ occurred_at: string }>(db, `SELECT occurred_at FROM claim_events WHERE id = 'ev-c8-done'`);
  const claim = one<{ accident_at: string | null; storage_billing_end_on: string | null; own_insurer_name: string | null }>(
    db,
    `SELECT accident_at, storage_billing_end_on, own_insurer_name FROM claims WHERE id = 'c8'`,
  );
  if (!started?.occurred_at || !done?.occurred_at || !claim) return;
  const startDay = londonDateIso(new Date(started.occurred_at));
  const accidentDay = claim.accident_at ? londonDateIso(new Date(claim.accident_at)) : shiftDay(startDay, -8);
  const storageEnd = calendarDay(claim.storage_billing_end_on);
  const authDay = storageEnd || shiftDay(startDay, -3);
  let reportSentDay = shiftDay(authDay, -13);
  if (reportSentDay < accidentDay) reportSentDay = accidentDay;
  const reportDay = dayOnOrAfter(shiftDay(reportSentDay, -1), accidentDay);
  const attendedDay = dayOnOrAfter(shiftDay(reportSentDay, -2), accidentDay);
  const bookedDay = dayOnOrAfter(shiftDay(reportSentDay, -3), accidentDay);
  let vehicleDay = shiftDay(startDay, -2);
  let partsDay = shiftDay(startDay, -1);
  if (inclusiveLondonDays(`${authDay}T12:00:00.000Z`, `${vehicleDay}T12:00:00.000Z`) >= REPAIR_PROGRESS_GAP_DAYS_DEFAULT) {
    const closer = shiftDay(startDay, -1);
    vehicleDay = closer;
    partsDay = closer;
  }
  const insurer = String(claim.own_insurer_name || "").trim() || "the insurer already named on this file";
  const now = nowUtcIso();
  const steps: Array<{ id: string; type: string; day: string; hour: number; details: string }> = [
    {
      id: "ev-c8-book",
      type: "engineer_inspection_booked",
      day: bookedDay,
      hour: 11,
      details: "Demonstration test data. Inspection booked. Recorded by Megan Price.",
    },
    {
      id: "ev-c8-attend",
      type: "engineer_inspection_attended",
      day: attendedDay,
      hour: 11,
      details: "Demonstration test data. The engineer attended. Recorded by Megan Price.",
    },
    {
      id: "ev-c8-report",
      type: "engineer_report_received",
      day: reportDay,
      hour: 14,
      details: "Demonstration test data. Engineer's report received. Recorded by Megan Price.",
    },
    {
      id: "ev-c8-sent",
      type: "engineer_report_sent_to_insurer",
      day: reportSentDay,
      hour: 15,
      details: `Sent to ${insurer}. Demonstration test data. Recorded by hand because it was not a live send from this CRM. Recorded by Megan Price.`,
    },
    {
      id: "ev-c8-auth",
      type: "repairs_authorised",
      day: authDay,
      hour: 10,
      details: "Demonstration test data. Repair authorisation received. Recorded by Megan Price.",
    },
    {
      id: "ev-c8-recv",
      type: "vehicle_received_for_repair",
      day: vehicleDay,
      hour: 9,
      details: "Demonstration test data. The customer's vehicle was received for repair. Recorded by Megan Price.",
    },
    {
      id: "ev-c8-parts",
      type: "parts_ordered",
      day: partsDay,
      hour: 9,
      details: `Demonstration test data. Expected delivery ${uk(shiftDay(partsDay, 3))}. Recorded by Megan Price.`,
    },
    {
      id: "ev-c8-delay",
      type: "parts_delayed",
      day: partsDay,
      hour: 15,
      details: `Demonstration test data. Supplier revised the date. New expected date ${uk(shiftDay(partsDay, 5))}. Recorded by Megan Price.`,
    },
  ];
  for (const step of steps) {
    if (one(db, `SELECT id FROM claim_events WHERE id = ?`, [step.id])) continue;
    if (one(db, `SELECT id FROM claim_events WHERE claim_id = 'c8' AND event_type = ? LIMIT 1`, [step.type])) continue;
    db.prepare(
      `INSERT INTO claim_events(
        id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
      ) VALUES (?, 'c8', ?, ?, ?, ?, ?, 'staff-megan', 'system', 'staff')`,
    ).run(step.id, step.type, eventLabel(step.type), step.details, atHour(step.day, step.hour), now);
  }
  if (one(db, `SELECT id FROM repair_gap_explanations WHERE id = 'gap-c8-parts'`)) return;
  const span = inclusiveLondonDays(started.occurred_at, done.occurred_at);
  if (span < REPAIR_PROGRESS_GAP_DAYS_DEFAULT) return;
  db.prepare(
    `INSERT INTO repair_gap_explanations(
      id, claim_id, from_event_id, to_event_id, inclusive_days, note, actor_id, recorded_at
    ) VALUES ('gap-c8-parts', 'c8', 'ev-c8-start', 'ev-c8-done', ?, 'awaiting parts', 'staff-megan', ?)`,
  ).run(span, now);
}

function ensureTest0007UnexplainedGap(db: DatabaseSync) {
  const instructed = one<{ occurred_at: string }>(db, `SELECT occurred_at FROM claim_events WHERE id = 'ev-c7-eng'`);
  if (!instructed?.occurred_at) return;
  const bookedDay = londonDateIso(new Date(instructed.occurred_at));
  const attendedDay = shiftDay(bookedDay, 14);
  const now = nowUtcIso();
  const steps = [
    {
      id: "ev-c7-book",
      type: "engineer_inspection_booked",
      day: bookedDay,
      hour: 15,
      details: "Demonstration test data. Inspection booked. Recorded by Tom Davies.",
    },
    {
      id: "ev-c7-attend",
      type: "engineer_inspection_attended",
      day: attendedDay,
      hour: 10,
      details: "Demonstration test data. The engineer attended. Recorded by Tom Davies.",
    },
  ];
  for (const step of steps) {
    if (one(db, `SELECT id FROM claim_events WHERE id = ?`, [step.id])) continue;
    if (one(db, `SELECT id FROM claim_events WHERE claim_id = 'c7' AND event_type = ? LIMIT 1`, [step.type])) continue;
    db.prepare(
      `INSERT INTO claim_events(
        id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, channel, source
      ) VALUES (?, 'c7', ?, ?, ?, ?, ?, 'staff-tom', 'system', 'staff')`,
    ).run(step.id, step.type, eventLabel(step.type), step.details, atHour(step.day, step.hour), now);
  }
}

function one<T>(db: DatabaseSync, sql: string, params: Array<string | number> = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function calendarDay(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

function shiftDay(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function dayOnOrAfter(day: string, earliest: string): string {
  return day < earliest ? earliest : day;
}

function atHour(day: string, hour: number): string {
  return utcFromLondonDateTime(`${day}T${String(hour).padStart(2, "0")}:00`);
}

function uk(day: string): string {
  return formatUkDate(`${day}T12:00:00.000Z`);
}

import type { DatabaseSync } from "node:sqlite";
import { londonDateIso, nowUtcIso } from "../dates";

/**
 * TEST-0008 keeps its stored hire money. This adds a handover, a signed agreement with that
 * booking's rate, one signed renewal at a different rate, and one later handover as a vehicle swap.
 * Renewal alerts start on day 80 and are overdue on day 88. The agreement is 89 days.
 */
export function ensureTest0008HireDemonstration(db: DatabaseSync) {
  const episode = db
    .prepare(`SELECT id, started_at, rate_pence_per_day, billing_end_at FROM hire_episodes WHERE id = 'h-c8'`)
    .get() as { id: string; started_at: string | null; rate_pence_per_day: number | null; billing_end_at: string | null } | undefined;
  if (!episode?.started_at) return;
  const moneyBefore = hireMoney(db);
  const storageBefore = storageEnds(db);
  const offersBefore = offerCount(db);
  const handoverDay = londonDay(episode.started_at);
  if (!handoverDay) return;
  const renewalDay = shiftDay(handoverDay, 14);
  const swapDay = shiftDay(handoverDay, 7);
  const now = nowUtcIso();
  const megan = db.prepare(`SELECT id FROM staff WHERE id = 'staff-megan'`).get();
  if (!megan) return;

  const delivered = db
    .prepare(`SELECT id FROM vehicle_handovers WHERE claim_id = 'c8' AND event_kind = 'hire_delivered' LIMIT 1`)
    .get();
  if (!delivered) {
    insertHandover(db, "vh-c8-out", episode.started_at, "Hire car handed over. This is the hire start.", now);
  }
  const swap = db
    .prepare(
      `SELECT id FROM vehicle_handovers WHERE claim_id = 'c8' AND event_kind = 'hire_delivered' AND occurred_at >= ? LIMIT 1`,
    )
    .get(`${swapDay}T00:00:00.000Z`);
  if (!swap) {
    insertHandover(
      db,
      "vh-c8-swap",
      `${swapDay}T10:00:00.000Z`,
      "Vehicle swap. The replacement was changed. This does not start a new hire and does not change the agreement rate.",
      now,
    );
  }

  const first = db.prepare(`SELECT id FROM agreements WHERE id = 'ag-c8'`).get();
  if (!first) {
    db.prepare(
      `INSERT INTO agreements(
        id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note, rate_pence_per_day
      ) VALUES ('ag-c8', 'h-c8', 1, ?, ?, 88, 80, 1, ?, 'signed', ?, ?)`,
    ).run(
      handoverDay,
      shiftDay(handoverDay, 88),
      episode.started_at,
      "Signed hire agreement. Daily rate taken from the rate already stored on this hire.",
      Number(episode.rate_pence_per_day) || 7900,
    );
  }
  const renewal = db.prepare(`SELECT id FROM agreements WHERE id = 'ag-c8b'`).get();
  if (!renewal) {
    db.prepare(
      `INSERT INTO agreements(
        id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note, rate_pence_per_day
      ) VALUES ('ag-c8b', 'h-c8', 2, ?, ?, 88, 80, 1, ?, 'signed', ?, 8500)`,
    ).run(
      renewalDay,
      shiftDay(renewalDay, 88),
      `${renewalDay}T09:00:00.000Z`,
      "Signed renewal at a different daily rate. The hire stays one continuous period. The changeover day is not counted twice.",
    );
  }

  if (hireMoney(db) !== moneyBefore) {
    throw new Error("Preparing TEST-0008 changed stored hire money. That must not happen.");
  }
  if (storageEnds(db) !== storageBefore) {
    throw new Error("Preparing TEST-0008 changed a storage end. That must not happen.");
  }
  if (offerCount(db) !== offersBefore) {
    throw new Error("Preparing TEST-0008 changed an offer. That must not happen.");
  }
}

function insertHandover(db: DatabaseSync, id: string, occurredAt: string, note: string, now: string) {
  db.prepare(
    `INSERT INTO vehicle_handovers(
      id, claim_id, hire_episode_id, event_kind, occurred_at, recorded_by, mileage, fuel_level,
      spare_wheel, tools_present, warning_lights_off, tyres_legal, condition_note, created_at, finished_at, shot_set
    ) VALUES (?, 'c8', 'h-c8', 'hire_delivered', ?, 'staff-megan', 12000, 'half', 'yes', 'yes', 'yes', 'yes', ?, ?, ?, 'seven')`,
  ).run(id, occurredAt, note, now, now);
}

function londonDay(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

function shiftDay(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function hireMoney(db: DatabaseSync): string {
  return JSON.stringify(
    db
      .prepare(
        `SELECT id, claimed_pence, agreed_pence, received_pence, offered_pence FROM financial_lines
         WHERE head_of_loss IN ('hire', 'credit_hire') ORDER BY id`,
      )
      .all(),
  );
}

function storageEnds(db: DatabaseSync): string {
  return JSON.stringify(db.prepare(`SELECT id, storage_billing_end_on FROM claims ORDER BY id`).all());
}

function offerCount(db: DatabaseSync): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM insurer_offers`).get() as { c: number } | undefined;
  return Number(row?.c || 0);
}

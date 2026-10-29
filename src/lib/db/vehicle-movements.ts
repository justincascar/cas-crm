import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";

/** Why a car was moved: because of the accident, or for convenience (the workshop's or a business reason). */
export const MOVEMENT_NECESSITY = [
  { value: "accident", label: "Required by the accident" },
  { value: "workshop", label: "Convenience – workshop" },
  { value: "business", label: "Convenience – business" },
] as const;
export type MovementNecessity = (typeof MOVEMENT_NECESSITY)[number]["value"];

/** Why the client's car could not be driven when it was recovered. */
export const NOT_DRIVEABLE_REASONS = [
  { value: "unsafe", label: "Unsafe to drive" },
  { value: "obstructing", label: "Obstructing the road" },
  { value: "further_damage", label: "At risk of further damage" },
] as const;

export function notDriveableLabel(value: string | null | undefined): string {
  return NOT_DRIVEABLE_REASONS.find((item) => item.value === value)?.label || "";
}

export type VehicleMovement = {
  id: string;
  movedOn: string;
  from: string;
  to: string;
  purpose: string;
  necessity: MovementNecessity;
  necessityLabel: string;
  recordedByName: string;
};

export function ensureVehicleMovements(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_movements (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      moved_on TEXT NOT NULL,
      from_place TEXT NOT NULL,
      to_place TEXT NOT NULL,
      purpose TEXT NOT NULL,
      necessity TEXT NOT NULL,
      recorded_by TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_movements_claim ON vehicle_movements(claim_id, moved_on);
  `);
}

export function listVehicleMovements(claimId: string): VehicleMovement[] {
  return all<{
    id: string;
    moved_on: string;
    from_place: string;
    to_place: string;
    purpose: string;
    necessity: string;
    recorded_by_name: string | null;
  }>(
    `SELECT m.id, m.moved_on, m.from_place, m.to_place, m.purpose, m.necessity, s.name AS recorded_by_name
     FROM vehicle_movements m LEFT JOIN staff s ON s.id = m.recorded_by
     WHERE m.claim_id = ? ORDER BY m.moved_on, m.recorded_at`,
    [claimId],
  ).map((row) => {
    const necessity = (MOVEMENT_NECESSITY.find((item) => item.value === row.necessity)?.value || "accident") as MovementNecessity;
    return {
      id: row.id,
      movedOn: row.moved_on,
      from: row.from_place,
      to: row.to_place,
      purpose: row.purpose,
      necessity,
      necessityLabel: MOVEMENT_NECESSITY.find((item) => item.value === necessity)?.label || "",
      recordedByName: String(row.recorded_by_name || ""),
    };
  });
}

/** Each movement of the client's car is its own record: from, to, date, purpose, and whether the accident required it. */
export function recordVehicleMovement(input: {
  claimId: string;
  actorId: string;
  movedOn: string;
  from: string;
  to: string;
  purpose: string;
  necessity: string;
}) {
  const day = input.movedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Enter the date the car was moved.");
  if (day > londonTodayIso()) throw new Error("The date cannot be in the future.");
  const from = input.from.trim();
  const to = input.to.trim();
  const purpose = input.purpose.trim();
  if (!from || !to) throw new Error("Enter where the car was moved from and to.");
  if (!purpose) throw new Error("Enter why the car was moved.");
  const necessity = MOVEMENT_NECESSITY.find((item) => item.value === input.necessity.trim());
  if (!necessity) throw new Error("Choose whether the move was required by the accident or for convenience.");
  const id = newId("move");
  run(
    `INSERT INTO vehicle_movements(id, claim_id, moved_on, from_place, to_place, purpose, necessity, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, day, from, to, purpose, necessity.value, input.actorId, nowUtcIso()],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "vehicle_moved",
    occurredAt: `${day}T12:00:00.000Z`,
    actorId: input.actorId,
    details: `Car moved on ${formatUkDate(day)} from ${from} to ${to}. Purpose: ${purpose}. ${necessity.label}.`,
    source: "staff",
  });
  return id;
}

/** The recovery itself is the first movement. Recorded once, when the recovery is recorded. */
export function recordRecoveryMovement(input: { claimId: string; actorId: string; movedOn: string; from: string; to: string }) {
  const existing = get<{ id: string }>(
    `SELECT id FROM vehicle_movements WHERE claim_id = ? AND purpose = 'Recovery after the accident' LIMIT 1`,
    [input.claimId],
  );
  if (existing) return existing.id;
  return recordVehicleMovement({ ...input, purpose: "Recovery after the accident", necessity: "accident", from: input.from || "Accident scene" });
}

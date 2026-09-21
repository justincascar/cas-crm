import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_VEHICLE_LOCATION, SETTING_DEFAULT_VEHICLE_LOCATION } from "../constants";
import {
  isBlankVehicleLocation,
  joinVehicleLocationParts,
  resolveVehicleLocation,
} from "../domain/vehicle-location";
import { get, run } from "./connection";

export function ensureDefaultVehicleLocationSetting(db: DatabaseSync) {
  const existing = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTING_DEFAULT_VEHICLE_LOCATION) as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)`).run(
      SETTING_DEFAULT_VEHICLE_LOCATION,
      DEFAULT_VEHICLE_LOCATION,
    );
  }
}

export function getDefaultVehicleLocation(): string {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SETTING_DEFAULT_VEHICLE_LOCATION]);
  return resolveVehicleLocation(row?.value, DEFAULT_VEHICLE_LOCATION);
}

export function setDefaultVehicleLocation(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter the default vehicle location.");
  const existing = get<{ key: string }>(`SELECT key FROM settings WHERE key = ?`, [SETTING_DEFAULT_VEHICLE_LOCATION]);
  if (existing) {
    run(`UPDATE settings SET value = ? WHERE key = ?`, [trimmed, SETTING_DEFAULT_VEHICLE_LOCATION]);
  } else {
    run(`INSERT INTO settings(key, value) VALUES (?, ?)`, [SETTING_DEFAULT_VEHICLE_LOCATION, trimmed]);
  }
}

function vehicleScreenLocation(claimId: string): string {
  const row = get<{ data_json: string }>(
    `SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = 'vehicle'`,
    [claimId],
  );
  if (!row?.data_json) return "";
  try {
    const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
    return joinVehicleLocationParts([
      parsed.clientLocation1 == null ? "" : String(parsed.clientLocation1),
      parsed.clientLocationPostcode == null ? "" : String(parsed.clientLocationPostcode),
    ]);
  } catch {
    return "";
  }
}

/** Location staff have actually saved on this file. Empty means letters should use the Settings default. */
export function recordedVehicleLocationForClaim(claimId: string): string {
  const fromVehicleScreen = vehicleScreenLocation(claimId);
  if (fromVehicleScreen) return fromVehicleScreen;
  const recovery = get<{ location: string | null }>(`SELECT location FROM recovery_jobs WHERE claim_id = ? LIMIT 1`, [
    claimId,
  ]);
  if (!isBlankVehicleLocation(recovery?.location)) return String(recovery?.location).trim();
  return "";
}

export function vehicleLocationForClaim(claimId: string): string {
  return resolveVehicleLocation(recordedVehicleLocationForClaim(claimId), getDefaultVehicleLocation());
}

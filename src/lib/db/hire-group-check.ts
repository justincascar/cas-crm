import type { DatabaseSync } from "node:sqlite";
import { GTA_NOT_CLASSIFIED, groupChargedAboveClient, gtaGroupLabel, normaliseGtaGroup } from "../documents/gta";
import { nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { get, getDb, run } from "./connection";
import { gtaTableFor } from "./gta-rates";

/**
 * The group checks insurers challenge (review note R27), made before an agreement is produced:
 *   - the client's own car group is on the file, or a reason it cannot be classified is;
 *   - when the group charged is above the group of the car actually supplied, a written reason is on the file.
 * The rate stays on the group charged. The agreement wording is not changed.
 */

export function ensureHireGroupCheckColumns(db: DatabaseSync) {
  const columns = new Set((db.prepare(`PRAGMA table_info(hire_pack_data)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("above_supplied_reason")) db.exec(`ALTER TABLE hire_pack_data ADD COLUMN above_supplied_reason TEXT`);
  // The reason is for one pair of groups. A different car or group charged needs its own reason.
  if (!columns.has("above_supplied_for")) db.exec(`ALTER TABLE hire_pack_data ADD COLUMN above_supplied_for TEXT`);
  // Why the client's own car cannot be classified is a fact about that car, kept with it.
  const vehicleColumns = new Set((db.prepare(`PRAGMA table_info(vehicles)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!vehicleColumns.has("gta_unclassified_reason")) db.exec(`ALTER TABLE vehicles ADD COLUMN gta_unclassified_reason TEXT`);
}

function ready() {
  ensureHireGroupCheckColumns(getDb());
}

export type GroupGap = { key: string; label: string; href: string };

export type HireGroupCheck = {
  clientGroup: string | null;
  /** Why the client's own car cannot be classified, when it has no group. */
  clientGroupReason: string;
  suppliedGroup: string | null;
  groupCharged: string | null;
  chargedAboveSupplied: boolean;
  aboveSuppliedReason: string;
  gaps: GroupGap[];
};

function aboveKey(charged: string | null, supplied: string | null) {
  return `${charged || ""}>${supplied || ""}`;
}

export function chargedAboveSupplied(charged: string | null | undefined, supplied: string | null | undefined): boolean {
  return groupChargedAboveClient(charged, supplied, gtaTableFor()?.rates || {});
}

type Facts = { client_group: string | null; client_group_reason: string | null; group_charged: string | null; above_supplied_reason: string | null; above_supplied_for: string | null };

function facts(claimId: string): Facts | undefined {
  ready();
  return get<Facts>(
    `SELECT v.gta_group AS client_group, v.gta_unclassified_reason AS client_group_reason, hp.group_charged, hp.above_supplied_reason, hp.above_supplied_for
     FROM claims c
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     LEFT JOIN hire_pack_data hp ON hp.claim_id = c.id
     WHERE c.id = ?`,
    [claimId],
  );
}

function suppliedGroupNow(claimId: string): string | null {
  const row = get<{ gta_group: string | null }>(
    `SELECT v.gta_group FROM hire_episodes he
     JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ? AND he.collection_at IS NULL AND he.billing_end_at IS NULL
     ORDER BY CASE WHEN he.started_at IS NULL THEN 0 ELSE 1 END, he.started_at DESC LIMIT 1`,
    [claimId],
  );
  return normaliseGtaGroup(row?.gta_group);
}

/**
 * The checks for this file. `supplied` is the car being supplied (the current hire car unless a swap names another).
 * A missing supplied group is not reported here: the car's own details are required separately.
 */
export function hireGroupCheck(claimId: string, options: { suppliedGroup?: string | null; aboveSuppliedReason?: string } = {}): HireGroupCheck {
  const row = facts(claimId);
  const clientGroup = normaliseGtaGroup(row?.client_group);
  const groupCharged = normaliseGtaGroup(row?.group_charged) || clientGroup;
  const suppliedGroup = options.suppliedGroup !== undefined ? normaliseGtaGroup(options.suppliedGroup) : suppliedGroupNow(claimId);
  const above = chargedAboveSupplied(groupCharged, suppliedGroup);
  const storedReason = row?.above_supplied_for === aboveKey(groupCharged, suppliedGroup) ? String(row?.above_supplied_reason || "").trim() : "";
  const aboveSuppliedReason = options.aboveSuppliedReason !== undefined ? options.aboveSuppliedReason.trim() : storedReason;
  const clientGroupReason = String(row?.client_group_reason || "").trim();
  const href = `/claims/${claimId}/hire#group-check`;
  const gaps: GroupGap[] = [];
  if (!clientGroup && !clientGroupReason) gaps.push({ key: "client-group", label: "Client's own car group, or why it cannot be classified", href });
  if (above && !aboveSuppliedReason) {
    gaps.push({
      key: "above-supplied",
      label: `Reason for charging group ${groupCharged} when the car supplied is group ${suppliedGroup}`,
      href,
    });
  }
  return { clientGroup, clientGroupReason, suppliedGroup, groupCharged, chargedAboveSupplied: above, aboveSuppliedReason, gaps };
}

/** One line for the Hire tab once the checks are met. */
export function groupCheckLine(check: HireGroupCheck): string {
  const client = check.clientGroup ? `client's own car group ${check.clientGroup}` : `client's own car not classified (${check.clientGroupReason || "no reason yet"})`;
  const supplied = check.suppliedGroup ? `car supplied group ${check.suppliedGroup}` : "car supplied: group not recorded";
  const charged = `group charged ${check.groupCharged || GTA_NOT_CLASSIFIED}`;
  return [client, supplied, charged].join(" · ");
}

/**
 * Saves the client's own car group (or the reason it cannot be classified) and the reason for charging above the
 * supplied car's group. Each is kept on the file and shown in the history.
 */
export function saveHireGroupCheck(input: { claimId: string; actorId: string; clientGroup: string; clientGroupReason: string; aboveSuppliedReason: string }) {
  ready();
  const row = facts(input.claimId);
  if (!row) throw new Error("File not found.");
  const vehicle = get<{ client_vehicle_id: string | null }>(`SELECT client_vehicle_id FROM claims WHERE id = ?`, [input.claimId]);
  const now = nowUtcIso();
  const notes: string[] = [];
  const existing = normaliseGtaGroup(row.client_group);
  const chosen = input.clientGroup.trim() ? normaliseGtaGroup(input.clientGroup) : null;
  if (input.clientGroup.trim() && !chosen) throw new Error("Choose the client's own car group from the list.");
  const reason = input.clientGroupReason.trim().slice(0, 1000);
  if (!existing) {
    if (chosen) {
      if (!vehicle?.client_vehicle_id) throw new Error("Add the client's own car on the vehicle details first.");
      run(`UPDATE vehicles SET gta_group = ? WHERE id = ?`, [chosen, vehicle.client_vehicle_id]);
      notes.push(`Client's own car group recorded as ${chosen}.`);
    } else if (reason && reason !== String(row.client_group_reason || "").trim()) {
      notes.push(`Client's own car cannot be classified. Reason: ${reason}.`);
    } else if (!reason && !String(row.client_group_reason || "").trim()) {
      throw new Error("Choose the client's own car group, or say why it cannot be classified.");
    }
  }
  run(`INSERT INTO hire_pack_data(claim_id, updated_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM hire_pack_data WHERE claim_id = ?)`, [input.claimId, now, input.claimId]);
  if (!existing && !chosen && reason) {
    if (!vehicle?.client_vehicle_id) throw new Error("Add the client's own car on the vehicle details first.");
    run(`UPDATE vehicles SET gta_unclassified_reason = ? WHERE id = ?`, [reason, vehicle.client_vehicle_id]);
  }

  const check = hireGroupCheck(input.claimId);
  if (check.chargedAboveSupplied) {
    const above = input.aboveSuppliedReason.trim().slice(0, 1000);
    if (!above && !check.aboveSuppliedReason) {
      throw new Error(`Write the reason for charging group ${check.groupCharged} when the car supplied is group ${check.suppliedGroup}.`);
    }
    if (above && above !== check.aboveSuppliedReason) {
      run(`UPDATE hire_pack_data SET above_supplied_reason = ?, above_supplied_for = ?, updated_at = ? WHERE claim_id = ?`, [
        above,
        aboveKey(check.groupCharged, check.suppliedGroup),
        now,
        input.claimId,
      ]);
      notes.push(`Group charged ${check.groupCharged} is above the group of the car supplied (${check.suppliedGroup}). Reason: ${above}. The rate stays on group ${check.groupCharged}.`);
    }
  }
  if (!notes.length) return { changed: false };
  recordClaimEvent({ claimId: input.claimId, eventType: "hire_group_check", occurredAt: now, actorId: input.actorId, details: notes.join(" "), source: "staff" });
  return { changed: true };
}

export { gtaGroupLabel };

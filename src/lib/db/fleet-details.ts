import type { DatabaseSync } from "node:sqlite";
import { formatUkDate, nowUtcIso } from "../dates";
import { GTA_GROUPS, normaliseGtaGroup } from "../documents/gta";
import { all, get, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { touchFleetVersion } from "./fleet";
import { settingsGtaGroups } from "./gta-rates";
import { sectionVersion, withImmediateTransaction } from "./record-version";

/**
 * What staff need to know about a fleet car when it is chosen for a hire (R22). Read once from the fleet record and
 * carried into the hire screen, the hire pack, the agreement, the handover and the driver job. A detail missing on the
 * fleet record is entered once and saved there. Gearbox, seats and GTA group are never guessed.
 */

export const FLEET_DETAIL_FIELDS = ["make", "model", "transmission", "fuel", "seats", "colour", "gtaGroup", "mileage", "location"] as const;
export type FleetDetailField = (typeof FLEET_DETAIL_FIELDS)[number];

export const FLEET_DETAIL_LABELS: Record<FleetDetailField, string> = {
  make: "Make",
  model: "Model",
  transmission: "Gearbox",
  fuel: "Fuel",
  seats: "Seats",
  colour: "Colour",
  gtaGroup: "GTA group",
  mileage: "Current mileage",
  location: "Where it is",
};

/** Printed on the agreement the client signs, so they are needed before it is produced. Gearbox has its own gap. */
export const AGREEMENT_FLEET_FIELDS: FleetDetailField[] = ["fuel", "seats", "colour", "gtaGroup"];

/** What a swap's new agreement prints about the replacement car, so the swap form asks for any of it that is missing (R28). */
export const SWAP_AGREEMENT_FIELDS: FleetDetailField[] = ["transmission", ...AGREEMENT_FLEET_FIELDS];

export const GEARBOXES = ["Manual", "Automatic"] as const;

export type FleetGtaSuggestion = { group: string; rule: string };

export type FleetCarDetails = {
  fleetVehicleId: string;
  vehicleId: string;
  registration: string;
  make: string;
  model: string;
  /** "Manual" or "Automatic", or blank when not recorded. */
  transmission: string;
  fuel: string;
  seats: number | null;
  colour: string;
  gtaGroup: string | null;
  mileage: number | null;
  /** When the mileage was read (ISO). */
  mileageOn: string | null;
  location: string;
  vehicleClass: string;
  missing: FleetDetailField[];
  suggestedGroup: FleetGtaSuggestion | null;
  version: string;
};

export function ensureFleetGtaRulesTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_gta_rules (
      id TEXT PRIMARY KEY,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      gta_group TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      removed_at TEXT,
      removed_by TEXT
    );
  `);
}

function text(value: unknown): string {
  const t = String(value ?? "").trim();
  return /^unknown$/i.test(t) ? "" : t;
}

/** A model saved as "— model unconfirmed …" is a note that the model is not known, not a model. */
function realModel(value: unknown): string {
  const t = text(value);
  return t.startsWith("—") ? "" : t;
}

export function gearbox(value: unknown): string {
  const t = text(value).toLowerCase();
  if (t === "manual") return "Manual";
  if (t === "automatic") return "Automatic";
  return "";
}

function upper(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export type FleetGtaRule = { id: string; make: string; model: string; gtaGroup: string; createdAt: string; createdByName: string | null };

export function listFleetGtaRules(): FleetGtaRule[] {
  return all<{ id: string; make: string; model: string; gta_group: string; created_at: string; name: string | null }>(
    `SELECT r.id, r.make, r.model, r.gta_group, r.created_at, s.name
     FROM fleet_gta_rules r LEFT JOIN staff s ON s.id = r.created_by
     WHERE r.removed_at IS NULL ORDER BY upper(r.make), upper(r.model)`,
  ).map((row) => ({
    id: String(row.id),
    make: String(row.make),
    model: String(row.model),
    gtaGroup: String(row.gta_group),
    createdAt: String(row.created_at),
    createdByName: row.name ? String(row.name) : null,
  }));
}

/** The rule's model matches the whole model or its first words, so "C220" does not match "C2200". */
function modelMatches(ruleModel: string, model: string): boolean {
  const rule = upper(ruleModel);
  const car = upper(model);
  if (!rule || !car) return false;
  return car === rule || car.startsWith(`${rule} `);
}

/**
 * A group suggested only when Settings has a clear rule: rules for this make whose model matches, all giving the same
 * group. No rule, or rules that disagree, means staff choose.
 */
export function suggestFleetGtaGroup(make: string, model: string, rules = listFleetGtaRules()): FleetGtaSuggestion | null {
  const wantMake = upper(make);
  if (!wantMake || !realModel(model)) return null;
  const matches = rules.filter((rule) => upper(rule.make) === wantMake && modelMatches(rule.model, model));
  const groups = [...new Set(matches.map((rule) => rule.gtaGroup))];
  if (groups.length !== 1) return null;
  const longest = [...matches].sort((a, b) => b.model.length - a.model.length)[0];
  return { group: groups[0], rule: `${longest.make} ${longest.model} → ${groups[0]}` };
}

export function saveFleetGtaRule(input: { make: string; model: string; group: string; actorId: string }) {
  const make = upper(input.make);
  const model = upper(input.model);
  if (!make) throw new Error("Enter the make, as on the V5C.");
  if (!model) throw new Error("Enter the model, or the first words of it, as on the V5C.");
  if (make.length > 60 || model.length > 120) throw new Error("Keep the make and model short.");
  const group = normaliseGtaGroup(input.group);
  if (!group) throw new Error("Choose the GTA group from the list.");
  const same = listFleetGtaRules().find((rule) => upper(rule.make) === make && upper(rule.model) === model);
  if (same) throw new Error(`There is already a rule for ${make} ${model} (${same.gtaGroup}). Remove it first to change it.`);
  run(`INSERT INTO fleet_gta_rules(id, make, model, gta_group, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    newId("gtarule"),
    make,
    model,
    group,
    input.actorId,
    nowUtcIso(),
  ]);
}

export function removeFleetGtaRule(input: { id: string; actorId: string }) {
  const row = get<{ id: string }>(`SELECT id FROM fleet_gta_rules WHERE id = ? AND removed_at IS NULL`, [input.id]);
  if (!row) throw new Error("That rule was not found.");
  run(`UPDATE fleet_gta_rules SET removed_at = ?, removed_by = ? WHERE id = ?`, [nowUtcIso(), input.actorId, input.id]);
}

/** The latest reading: a handover of this car, or a figure staff entered on the fleet record, whichever is later. */
function currentMileage(fleetVehicleId: string, stored: number | null, storedOn: string | null): { mileage: number | null; on: string | null } {
  const handover = get<{ mileage: number; occurred_at: string }>(
    `SELECT h.mileage, h.occurred_at FROM vehicle_handovers h
     JOIN hire_episodes he ON he.id = h.hire_episode_id
     WHERE he.fleet_vehicle_id = ? AND h.event_kind IN ('hire_delivered', 'hire_collected')
     ORDER BY h.occurred_at DESC LIMIT 1`,
    [fleetVehicleId],
  );
  if (handover && (stored == null || !storedOn || String(handover.occurred_at) >= storedOn)) {
    return { mileage: Number(handover.mileage), on: String(handover.occurred_at) };
  }
  return { mileage: stored, on: storedOn };
}

type DetailRow = {
  id: string;
  vehicle_id: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  transmission: string | null;
  fuel: string | null;
  seats: number | null;
  colour: string | null;
  gta_group: string | null;
  vehicle_class: string | null;
  location: string | null;
  current_mileage: number | null;
  current_mileage_on: string | null;
};

const DETAIL_SELECT = `SELECT fv.id, fv.vehicle_id, v.registration, v.make, v.model, v.transmission, v.fuel, v.seats, v.colour,
            v.gta_group, v.vehicle_class, fv.location, fv.current_mileage, fv.current_mileage_on
     FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id`;

function toDetails(row: DetailRow, rules: FleetGtaRule[]): FleetCarDetails {
  const id = String(row.id);
  const reading = currentMileage(id, row.current_mileage == null ? null : Number(row.current_mileage), row.current_mileage_on ? String(row.current_mileage_on) : null);
  const details = {
    fleetVehicleId: id,
    vehicleId: String(row.vehicle_id),
    registration: text(row.registration),
    make: text(row.make),
    model: realModel(row.model),
    transmission: gearbox(row.transmission),
    fuel: text(row.fuel),
    seats: row.seats == null || Number(row.seats) <= 0 ? null : Number(row.seats),
    colour: text(row.colour),
    gtaGroup: normaliseGtaGroup(row.gta_group),
    mileage: reading.mileage,
    mileageOn: reading.on,
    location: text(row.location),
    vehicleClass: text(row.vehicle_class),
  };
  const missing = FLEET_DETAIL_FIELDS.filter((field) => {
    if (field === "seats") return details.seats == null;
    if (field === "gtaGroup") return !details.gtaGroup;
    if (field === "mileage") return details.mileage == null;
    return !details[field];
  });
  return {
    ...details,
    missing,
    suggestedGroup: details.gtaGroup ? null : suggestFleetGtaGroup(details.make, details.model, rules),
    version: sectionVersion("fleet", id),
  };
}

export function fleetCarDetails(fleetVehicleId: string): FleetCarDetails | null {
  const row = get<DetailRow>(`${DETAIL_SELECT} WHERE fv.id = ?`, [fleetVehicleId]);
  return row ? toDetails(row, listFleetGtaRules()) : null;
}

/** Every car on the fleet, keyed by fleet id. One read of the rules for the lot. */
export function allFleetCarDetails(): Map<string, FleetCarDetails> {
  const rules = listFleetGtaRules();
  const rows = all<DetailRow>(`${DETAIL_SELECT} WHERE fv.removed_at IS NULL`);
  return new Map(rows.map((row) => [String(row.id), toDetails(row, rules)]));
}

/** The real CAS fleet cars with something missing, for "Fleet details to complete" on Hire / Fleet. */
export function listFleetDetailsToComplete(): FleetCarDetails[] {
  const real = new Set(all<{ id: string }>(`SELECT id FROM fleet_vehicles WHERE is_real = 1 AND removed_at IS NULL`).map((row) => String(row.id)));
  return [...allFleetCarDetails().values()]
    .filter((car) => real.has(car.fleetVehicleId) && car.missing.length > 0)
    .sort((a, b) => a.registration.localeCompare(b.registration, "en-GB", { numeric: true }));
}

export function formatMileage(miles: number): string {
  return `${miles.toLocaleString("en-GB")} miles`;
}

/** One line for a list or a driver job, leaving out what is not recorded. */
export function fleetDetailLine(car: FleetCarDetails, opts: { location?: boolean } = {}): string {
  return [
    car.transmission,
    car.fuel,
    car.seats != null ? `${car.seats} seats` : "",
    car.colour,
    car.gtaGroup ? `GTA group ${car.gtaGroup}` : "",
    car.mileage != null ? `${formatMileage(car.mileage)}${car.mileageOn ? ` (${formatUkDate(car.mileageOn)})` : ""}` : "",
    opts.location !== false && car.location ? `at ${car.location}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function missingWords(fields: FleetDetailField[]): string {
  return fields.map((field) => (field === "gtaGroup" ? "GTA group" : FLEET_DETAIL_LABELS[field].toLowerCase())).join(", ");
}

/** Groups for the GTA group box: the table in force in Settings, or the supplied list when none is. */
export function fleetGroupChoices(): string[] {
  const groups = settingsGtaGroups();
  return groups.length ? groups : GTA_GROUPS;
}

const TEXT_LIMITS: Partial<Record<FleetDetailField, number>> = { make: 60, model: 120, fuel: 40, colour: 40, location: 200 };

/**
 * Saves the details entered for a car where the fleet record has none. A detail already on the record is not changed
 * here (that is done on the fleet record itself), so a box filled by someone else in the meantime is kept.
 */
export function saveMissingFleetDetails(input: {
  fleetVehicleId: string;
  actorId: string;
  values: Partial<Record<FleetDetailField, string>>;
  claimId?: string;
  expectedVersion?: string;
}): { saved: FleetDetailField[]; details: FleetCarDetails } {
  return withImmediateTransaction(() => saveMissingFleetDetailsNow(input));
}

/** The same, inside a transaction the caller already holds. */
export function saveMissingFleetDetailsNow(input: Parameters<typeof saveMissingFleetDetails>[0]): { saved: FleetDetailField[]; details: FleetCarDetails } {
  const car = fleetCarDetails(input.fleetVehicleId);
  if (!car) throw new Error("That car is not on the fleet.");
  const entered = FLEET_DETAIL_FIELDS.filter((field) => car.missing.includes(field) && text(input.values[field]));
  if (!entered.length) {
    // Everything entered is already on the record (a second click, or someone else saved it first).
    if (FLEET_DETAIL_FIELDS.some((field) => text(input.values[field]))) return { saved: [], details: car };
    throw new Error(car.missing.length ? "Enter at least one of the missing details." : "Nothing is missing on this car's fleet record.");
  }
  const vehicleSets: Array<[string, string | number]> = [];
  const fleetSets: Array<[string, string | number]> = [];
  const words: string[] = [];
  for (const field of entered) {
    const raw = text(input.values[field]);
    if (field === "transmission") {
      const value = gearbox(raw);
      if (!value) throw new Error("Choose manual or automatic for the gearbox.");
      vehicleSets.push(["transmission", value]);
      words.push(`gearbox ${value.toLowerCase()}`);
    } else if (field === "seats") {
      if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 20) throw new Error("Enter the number of seats, from 1 to 20.");
      vehicleSets.push(["seats", Number(raw)]);
      words.push(`${Number(raw)} seats`);
    } else if (field === "gtaGroup") {
      const group = normaliseGtaGroup(raw);
      if (!group) throw new Error("Choose the GTA group from the list.");
      vehicleSets.push(["gta_group", group]);
      words.push(`GTA group ${group}`);
    } else if (field === "mileage") {
      const miles = raw.replace(/[,\s]/g, "");
      if (!/^\d{1,7}$/.test(miles)) throw new Error("Enter the current mileage as a whole number.");
      fleetSets.push(["current_mileage", Number(miles)], ["current_mileage_on", nowUtcIso()]);
      words.push(`mileage ${formatMileage(Number(miles))}`);
    } else {
      const limit = TEXT_LIMITS[field] || 100;
      if (raw.length > limit) throw new Error(`Keep the ${FLEET_DETAIL_LABELS[field].toLowerCase()} short.`);
      if (field === "location") fleetSets.push(["location", raw]);
      else vehicleSets.push([field, raw]);
      words.push(`${FLEET_DETAIL_LABELS[field].toLowerCase()} ${raw}`);
    }
  }
  touchFleetVersion({
    fleetVehicleId: input.fleetVehicleId,
    actorId: input.actorId,
    expected: input.expectedVersion,
    change: `Details completed: ${words.join(", ")}`,
  });
  if (vehicleSets.length) {
    run(`UPDATE vehicles SET ${vehicleSets.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [
      ...vehicleSets.map(([, value]) => value),
      car.vehicleId,
    ]);
  }
  if (fleetSets.length) {
    run(`UPDATE fleet_vehicles SET ${fleetSets.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`, [
      ...fleetSets.map(([, value]) => value),
      input.fleetVehicleId,
    ]);
  }
  if (input.claimId) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "hire_car_details_saved",
      occurredAt: nowUtcIso(),
      actorId: input.actorId,
      details: `Saved to the fleet record for ${car.registration || "the hire car"}: ${words.join(", ")}. The next hire of this car has them.`,
      source: "staff",
    });
  }
  return { saved: entered, details: fleetCarDetails(input.fleetVehicleId) as FleetCarDetails };
}

/** A mileage read from the car (before signing) is its current mileage. */
export function noteFleetMileage(fleetVehicleId: string, miles: number) {
  run(`UPDATE fleet_vehicles SET current_mileage = ?, current_mileage_on = ? WHERE id = ?`, [miles, nowUtcIso(), fleetVehicleId]);
}

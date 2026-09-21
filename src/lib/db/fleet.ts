import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { DEFAULT_VEHICLE_LOCATION } from "../constants";
import { nowUtcIso } from "../dates";
import { isVehicleClass, type VehicleClass } from "../fleet/classes";
import { storedFileExists, storeFileCopy } from "../storage/files";
import { formatVehicleRegistration } from "../text";
import { get, getDb, newId, run } from "./connection";
import {
  DOCUMENT_TYPE_V5C,
  findFleetDocumentOn,
  insertStoredDocumentOn,
  listDocumentsForFleetVehicleOn,
} from "./documents-store";

export const DEFAULT_V5C_SOURCE_DIR =
  "C:\\Users\\Justinroberts2\\Desktop\\CRM\\V5c\\For the system V5c";

export type RealFleetCatalogRow = {
  sourceFile: string;
  registration: string;
  make: string;
  model: string;
  colour: string;
  engineCc: number | null;
  fuel: string;
  firstRegisteredOn: string;
  vehicleClass: VehicleClass | string;
  missing: string[];
};

export type FleetVehicleInput = {
  registration: string;
  make: string;
  model: string;
  colour: string;
  engineCc?: number | null;
  fuel: string;
  firstRegisteredOn: string;
  vehicleClass: string;
  transmission: string;
  seats?: number | null;
  location: string;
  notes: string;
  isReal?: boolean;
};

export type FleetReservationWarning = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  kind: string;
  file_reference: string | null;
};

export class FleetRemoveBlockedError extends Error {
  reservations: FleetReservationWarning[];
  constructor(reservations: FleetReservationWarning[]) {
    super(
      "This vehicle has an active or future reservation. Removing it would leave those bookings against a vehicle taken off the fleet. Tick the confirmation to remove it anyway — booking history is kept.",
    );
    this.name = "FleetRemoveBlockedError";
    this.reservations = reservations;
  }
}

function blank(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function registrationKey(value: string): string {
  return formatVehicleRegistration(value).replace(/\s+/g, "");
}

export function v5cSourceDir(): string {
  return process.env.CAS_V5C_SOURCE_DIR || DEFAULT_V5C_SOURCE_DIR;
}

export function loadRealFleetCatalog(): RealFleetCatalogRow[] {
  const file = path.join(process.cwd(), "src", "lib", "fleet", "cas-real-fleet.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as RealFleetCatalogRow[];
}

function sourceKey(sourceFile: string): string {
  return sourceFile
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function parseSeats(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseEngineCc(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function requireClass(value: string): VehicleClass {
  const trimmed = value.trim();
  if (!isVehicleClass(trimmed)) {
    throw new Error("Choose a vehicle class (car, van, motorcycle, campervan, or wheelchair-accessible taxi).");
  }
  return trimmed;
}

function existingFleetByRegistrationOn(
  db: DatabaseSync,
  registration: string,
  exceptFleetId?: string,
): { id: string } | undefined {
  const key = registrationKey(registration);
  if (!key) return undefined;
  const rows = db
    .prepare(
      `SELECT fv.id, v.registration
       FROM fleet_vehicles fv
       JOIN vehicles v ON v.id = fv.vehicle_id
       WHERE fv.removed_at IS NULL AND v.registration IS NOT NULL AND trim(v.registration) != ''`,
    )
    .all() as Array<{ id: string; registration: string }>;
  return rows.find((row) => registrationKey(row.registration) === key && row.id !== exceptFleetId);
}

export function listBlockingReservationsOn(db: DatabaseSync, fleetVehicleId: string): FleetReservationWarning[] {
  const now = nowUtcIso();
  return db
    .prepare(
      `SELECT r.id, r.start_at, r.end_at, r.status, r.kind, c.file_reference
       FROM reservations r
       LEFT JOIN claims c ON c.id = r.claim_id
       WHERE r.fleet_vehicle_id = ?
         AND r.status IN ('reserved', 'active')
         AND r.end_at >= ?
       ORDER BY r.start_at`,
    )
    .all(fleetVehicleId, now) as FleetReservationWarning[];
}

export function listBlockingReservations(fleetVehicleId: string): FleetReservationWarning[] {
  return listBlockingReservationsOn(getDb(), fleetVehicleId);
}

function attachV5cOn(
  db: DatabaseSync,
  input: {
    fleetVehicleId: string;
    vehicleId: string;
    sourceFile: string;
    sourcePath: string;
    missing: string[];
  },
) {
  if (!fs.existsSync(input.sourcePath)) return;
  const existing = findFleetDocumentOn(db, input.fleetVehicleId, DOCUMENT_TYPE_V5C);
  if (existing?.stored_relpath && storedFileExists(existing.stored_relpath)) return;
  const stored = storeFileCopy({
    relDir: `fleet/${input.fleetVehicleId}/v5c`,
    originalFilename: input.sourceFile,
    sourcePath: input.sourcePath,
  });
  if (existing) {
    db.prepare(
      `UPDATE documents SET stored_relpath = ?, original_filename = ?, mime_type = ?, byte_size = ?, missing_json = ? WHERE id = ?`,
    ).run(
      stored.storedRelpath,
      input.sourceFile,
      "application/pdf",
      stored.byteSize,
      input.missing.length ? JSON.stringify(input.missing) : null,
      existing.id,
    );
    return;
  }
  insertStoredDocumentOn(db, {
    title: `V5C — ${input.sourceFile}`,
    documentType: DOCUMENT_TYPE_V5C,
    kind: "file",
    vehicleId: input.vehicleId,
    fleetVehicleId: input.fleetVehicleId,
    originalFilename: input.sourceFile,
    storedRelpath: stored.storedRelpath,
    mimeType: "application/pdf",
    byteSize: stored.byteSize,
    missing: input.missing,
    simulated: 0,
  });
}

export function ensureRealFleet(db: DatabaseSync) {
  const catalog = loadRealFleetCatalog();
  const sourceDir = v5cSourceDir();
  const sourceAvailable = fs.existsSync(sourceDir);
  const location = DEFAULT_VEHICLE_LOCATION;

  for (const row of catalog) {
    const key = sourceKey(row.sourceFile);
    const fleetId = `fv-real-${key}`;
    const vehicleId = `v-real-${key}`;
    const registration = blank(row.registration) ? formatVehicleRegistration(String(row.registration)) : null;
    const make = blank(row.make);
    const model = blank(row.model);
    const colour = blank(row.colour);
    const fuel = blank(row.fuel);
    const firstRegisteredOn = blank(row.firstRegisteredOn);
    const engineCc = parseEngineCc(row.engineCc);
    const vehicleClass = isVehicleClass(String(row.vehicleClass || "")) ? row.vehicleClass : null;
    const missing = Array.isArray(row.missing) ? row.missing : [];
    const missingJson = missing.length ? JSON.stringify(missing) : null;

    const bySource = db
      .prepare(`SELECT id, vehicle_id FROM fleet_vehicles WHERE v5c_source_file = ?`)
      .get(row.sourceFile) as { id: string; vehicle_id: string } | undefined;
    const existing = bySource
      || (db
        .prepare(`SELECT id, vehicle_id FROM fleet_vehicles WHERE id = ?`)
        .get(fleetId) as { id: string; vehicle_id: string } | undefined);

    if (!existing) {
      db.prepare(
        `INSERT INTO vehicles(
          id, usage, registration, make, model, transmission, fuel, body_type, seats, colour,
          lookup_source, lookup_incomplete, provenance, engine_cc, first_registered_on, vehicle_class, v5c_missing_json
        ) VALUES (?, 'fleet', ?, ?, ?, NULL, ?, NULL, NULL, ?, 'v5c', ?, 'v5c', ?, ?, ?, ?)`,
      ).run(
        ...(
          [
            vehicleId,
            registration,
            make,
            model,
            fuel,
            colour,
            missing.includes("registration") || !registration ? 1 : 0,
            engineCc,
            firstRegisteredOn,
            vehicleClass,
            missingJson,
          ] as SQLInputValue[]
        ),
      );
      db.prepare(
        `INSERT INTO fleet_vehicles(id, vehicle_id, status, location, notes, is_real, removed_at, removed_reason, v5c_source_file)
         VALUES (?, ?, 'available', ?, ?, 1, NULL, NULL, ?)`,
      ).run(
        fleetId,
        vehicleId,
        location,
        missing.length ? `V5C fields left blank (not guessed): ${missing.join(", ")}.` : null,
        row.sourceFile,
      );
    }

    const fleetVehicleId = existing?.id || fleetId;
    const linkedVehicleId = existing?.vehicle_id || vehicleId;
    if (sourceAvailable) {
      attachV5cOn(db, {
        fleetVehicleId,
        vehicleId: linkedVehicleId,
        sourceFile: row.sourceFile,
        sourcePath: path.join(sourceDir, row.sourceFile),
        missing,
      });
    }
  }
}

export function attachV5cBuffer(input: {
  fleetVehicleId: string;
  vehicleId: string;
  originalFilename: string;
  buffer: Buffer;
  createdBy?: string;
}): string {
  const stored = storeFileCopy({
    relDir: `fleet/${input.fleetVehicleId}/v5c`,
    originalFilename: input.originalFilename,
    buffer: input.buffer,
  });
  const db = getDb();
  const existing = findFleetDocumentOn(db, input.fleetVehicleId, DOCUMENT_TYPE_V5C);
  if (existing) {
    run(
      `UPDATE documents SET stored_relpath = ?, original_filename = ?, mime_type = ?, byte_size = ?, simulated = 0 WHERE id = ?`,
      [stored.storedRelpath, input.originalFilename, "application/pdf", stored.byteSize, existing.id],
    );
    return existing.id;
  }
  return insertStoredDocumentOn(db, {
    title: `V5C — ${input.originalFilename}`,
    documentType: DOCUMENT_TYPE_V5C,
    kind: "file",
    vehicleId: input.vehicleId,
    fleetVehicleId: input.fleetVehicleId,
    originalFilename: input.originalFilename,
    storedRelpath: stored.storedRelpath,
    mimeType: "application/pdf",
    byteSize: stored.byteSize,
    createdBy: input.createdBy,
    simulated: 0,
  });
}

function normalizeInput(input: FleetVehicleInput): FleetVehicleInput {
  const registration = blank(input.registration) ? formatVehicleRegistration(input.registration) : "";
  return {
    registration,
    make: blank(input.make) || "",
    model: blank(input.model) || "",
    colour: blank(input.colour) || "",
    engineCc: parseEngineCc(input.engineCc),
    fuel: blank(input.fuel) || "",
    firstRegisteredOn: blank(input.firstRegisteredOn) || "",
    vehicleClass: requireClass(input.vehicleClass),
    transmission: blank(input.transmission) || "",
    seats: parseSeats(input.seats),
    location: blank(input.location) || DEFAULT_VEHICLE_LOCATION,
    notes: blank(input.notes) || "",
    isReal: input.isReal !== false,
  };
}

export function createFleetVehicle(input: FleetVehicleInput): string {
  const data = normalizeInput(input);
  if (!data.registration) throw new Error("Registration is required for a new fleet vehicle.");
  const duplicate = existingFleetByRegistrationOn(getDb(), data.registration);
  if (duplicate) throw new Error("A fleet vehicle with that registration is already on the list.");
  const vehicleId = newId("v");
  const fleetId = newId("fv");
  run(
    `INSERT INTO vehicles(
      id, usage, registration, make, model, transmission, fuel, body_type, seats, colour,
      lookup_source, lookup_incomplete, provenance, engine_cc, first_registered_on, vehicle_class, v5c_missing_json
    ) VALUES (?, 'fleet', ?, ?, ?, ?, ?, NULL, ?, ?, 'staff', 0, 'staff', ?, ?, ?, NULL)`,
    [
      vehicleId,
      data.registration,
      blank(data.make),
      blank(data.model),
      blank(data.transmission),
      blank(data.fuel),
      data.seats,
      blank(data.colour),
      data.engineCc,
      blank(data.firstRegisteredOn),
      data.vehicleClass,
    ],
  );
  run(
    `INSERT INTO fleet_vehicles(id, vehicle_id, status, location, notes, is_real, removed_at, removed_reason, v5c_source_file)
     VALUES (?, ?, 'available', ?, ?, 1, NULL, NULL, NULL)`,
    [fleetId, vehicleId, data.location, blank(data.notes)],
  );
  return fleetId;
}

export function updateFleetVehicle(id: string, input: FleetVehicleInput) {
  const existing = getFleetVehicle(id);
  if (!existing) throw new Error("Vehicle not found.");
  const data = normalizeInput({ ...input, isReal: Number(existing.is_real) === 1 });
  if (data.registration) {
    const duplicate = existingFleetByRegistrationOn(getDb(), data.registration, id);
    if (duplicate) throw new Error("A fleet vehicle with that registration is already on the list.");
  }
  run(
    `UPDATE vehicles SET
      registration = ?, make = ?, model = ?, transmission = ?, fuel = ?, seats = ?, colour = ?,
      engine_cc = ?, first_registered_on = ?, vehicle_class = ?
     WHERE id = ?`,
    [
      blank(data.registration),
      blank(data.make),
      blank(data.model),
      blank(data.transmission),
      blank(data.fuel),
      data.seats,
      blank(data.colour),
      data.engineCc,
      blank(data.firstRegisteredOn),
      data.vehicleClass,
      existing.vehicle_id,
    ],
  );
  run(`UPDATE fleet_vehicles SET location = ?, notes = ? WHERE id = ?`, [
    data.location,
    blank(data.notes),
    id,
  ]);
}

export function removeFleetVehicle(
  id: string,
  opts?: { confirmDespiteReservations?: boolean; reason?: string },
) {
  const existing = getFleetVehicle(id);
  if (!existing) throw new Error("Vehicle not found.");
  if (existing.removed_at) throw new Error("This vehicle is already removed from the fleet.");
  const blocking = listBlockingReservations(id);
  if (blocking.length && !opts?.confirmDespiteReservations) {
    throw new FleetRemoveBlockedError(blocking);
  }
  run(`UPDATE fleet_vehicles SET status = 'removed', removed_at = ?, removed_reason = ? WHERE id = ?`, [
    nowUtcIso(),
    blank(opts?.reason) || (blocking.length ? "Removed with active or future reservation confirmed." : null),
    id,
  ]);
}

export function getFleetVehicle(id: string) {
  return get<Record<string, string | number | null>>(
    `SELECT fv.*, v.registration, v.make, v.model, v.transmission, v.seats, v.body_type, v.fuel,
            v.colour, v.engine_cc, v.first_registered_on, v.vehicle_class, v.v5c_missing_json
     FROM fleet_vehicles fv
     JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE fv.id = ?`,
    [id],
  );
}

export function listFleetVehicleDocuments(fleetVehicleId: string) {
  return listDocumentsForFleetVehicleOn(getDb(), fleetVehicleId);
}

export function fleetSearchMatches(registration: string | null | undefined, query: string): boolean {
  const q = formatVehicleRegistration(query);
  if (!q) return true;
  const stored = formatVehicleRegistration(registration || "");
  if (stored.includes(q)) return true;
  return registrationKey(stored).includes(registrationKey(q));
}

import { isOfficeRole } from "../auth/roles";
import { nowUtcIso } from "../dates";
import { assertCanRecordHandover } from "./jobs";
import { storeFileCopy } from "../storage/files";
import { all, get, getDb, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { insertStoredDocument } from "./documents-store";

export const HANDOVER_EVENTS = [
  { kind: "hire_delivered", label: "Hire car — handed to the customer", needsBooking: true },
  { kind: "hire_collected", label: "Hire car — collected from the customer", needsBooking: true },
  { kind: "client_recovered", label: "Customer's vehicle — collected for repair", needsBooking: false },
  { kind: "client_returned", label: "Customer's vehicle — returned after repair", needsBooking: false },
] as const;

export type HandoverEventKind = (typeof HANDOVER_EVENTS)[number]["kind"];

export const FUEL_LEVELS = [
  { value: "empty", label: "Empty" },
  { value: "quarter", label: "¼" },
  { value: "half", label: "½" },
  { value: "three_quarters", label: "¾" },
  { value: "full", label: "Full" },
] as const;

export type FuelLevel = (typeof FUEL_LEVELS)[number]["value"];

const CHECKS = [
  ["spare_wheel", "Spare wheel present"],
  ["tools_present", "Tools present"],
  ["warning_lights_off", "Warning lights off"],
  ["tyres_legal", "Tyres visibly legal"],
] as const;

export const HANDOVER_CHECKS = CHECKS.map(([key, label]) => ({ key, label }));

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_DAMAGE_PHOTOS = 6;
const MAX_SCAN_BYTES = 12 * 1024 * 1024;

export const SCAN_SLOTS = [
  { slot: "pre", label: "Pre-diagnostic scan" },
  { slot: "post", label: "Post-diagnostic scan" },
] as const;

export type HandoverScanSlot = (typeof SCAN_SLOTS)[number]["slot"];

export const STANDARD_SHOTS = [
  { slot: "front", label: "Front" },
  { slot: "rear", label: "Rear" },
  { slot: "driver_side", label: "Driver's side" },
  { slot: "passenger_side", label: "Passenger's side" },
  { slot: "interior", label: "Interior" },
] as const;

export type StandardShotSlot = (typeof STANDARD_SHOTS)[number]["slot"];
export const DAMAGE_SHOT = "damage";

export type HandoverFileInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export type HandoverPhotoInput = HandoverFileInput & {
  slot: string;
};

export type HandoverInput = {
  claimId: string;
  eventKind: string;
  hireEpisodeId: string;
  mileage: string;
  fuelLevel: string;
  spareWheel?: string;
  toolsPresent?: string;
  warningLightsOff?: string;
  tyresLegal?: string;
  conditionNote: string;
  actorId: string;
  photos: HandoverPhotoInput[];
  preScan?: HandoverFileInput | null;
  postScan?: HandoverFileInput | null;
};

export type HandoverReading = {
  mileage: number;
  fuelLabel: string;
  occurredAt: string;
};

export type HandoverPhoto = {
  id: string;
  slot: string;
  documentId: string;
  takenAt: string;
  title: string;
};

export type HandoverScan = {
  id: string;
  slot: HandoverScanSlot;
  documentId: string;
  attachedAt: string;
  title: string;
  filename: string;
  mimeType: string;
};

export type HandoverRecord = {
  id: string;
  claimId: string;
  hireEpisodeId: string | null;
  eventKind: HandoverEventKind;
  eventLabel: string;
  occurredAt: string;
  recordedBy: string;
  recordedByName: string;
  mileage: number;
  fuelLevel: FuelLevel;
  fuelLabel: string;
  spareWheel: "yes" | "no";
  toolsPresent: "yes" | "no";
  warningLightsOff: "yes" | "no";
  tyresLegal: "yes" | "no";
  conditionNote: string;
  bookingLabel: string;
  photos: HandoverPhoto[];
  scans: HandoverScan[];
  incomplete: boolean;
  finishedAt: string | null;
};

export function handoverEvent(kind: string) {
  return HANDOVER_EVENTS.find((event) => event.kind === kind);
}

export function fuelLevelLabel(value: string | null | undefined): string {
  return FUEL_LEVELS.find((level) => level.value === value)?.label || "";
}

export function formatHandoverMileage(mileage: number): string {
  return mileage.toLocaleString("en-GB");
}

export function missingStandardShots(slots: Iterable<string>): Array<(typeof STANDARD_SHOTS)[number]> {
  const have = new Set(slots);
  return STANDARD_SHOTS.filter((shot) => !have.has(shot.slot));
}

/** Incomplete until Front, Rear, both sides and Interior are present. Damage photographs do not count. */
export function handoverIncomplete(slots: Iterable<string>): boolean {
  return missingStandardShots(slots).length > 0;
}

/** Where to put the driver after a photograph is stored. Standard shots run Front through Interior, then Finish. */
export function focusAfterShot(savedSlot: string, slotsAfter: Iterable<string>): string {
  if (savedSlot !== DAMAGE_SHOT) {
    const next = missingStandardShots(slotsAfter)[0];
    if (next) return next.slot;
  }
  return missingStandardShots(slotsAfter).length === 0 ? "finish" : DAMAGE_SHOT;
}

export function photoSlot(value: string): string {
  const slot = value.trim();
  if (slot === DAMAGE_SHOT) return DAMAGE_SHOT;
  const shot = STANDARD_SHOTS.find((item) => item.slot === slot);
  if (!shot) throw new Error("Choose which photograph this is.");
  return shot.slot;
}

function shotLabel(slot: string): string {
  return STANDARD_SHOTS.find((shot) => shot.slot === slot)?.label || "Damage";
}

export function assertPhotosFit(existingSlots: string[], incoming: HandoverPhotoInput[]) {
  const have = new Set(existingSlots);
  let damage = existingSlots.filter((slot) => slot === DAMAGE_SHOT).length;
  for (const photo of incoming) {
    const slot = photoSlot(photo.slot);
    if (slot === DAMAGE_SHOT) {
      damage += 1;
      if (damage > MAX_DAMAGE_PHOTOS) {
        throw new Error(`A handover can hold ${MAX_DAMAGE_PHOTOS} damage photographs.`);
      }
    } else if (have.has(slot)) {
      throw new Error(`${shotLabel(slot)} is already photographed.`);
    } else {
      have.add(slot);
    }
  }
}

function photoProgress(slots: Iterable<string>): string {
  const missing = missingStandardShots(slots);
  if (missing.length === STANDARD_SHOTS.length) return "No standard photographs yet — incomplete.";
  if (missing.length === 0) return "Front, Rear, Driver's side, Passenger's side and Interior are photographed.";
  return `Still needed: ${missing.map((shot) => shot.label).join(", ")}.`;
}

export function scanSlot(value: string): HandoverScanSlot {
  const slot = SCAN_SLOTS.find((item) => item.slot === value.trim());
  if (!slot) throw new Error("Choose a pre-scan or a post-scan.");
  return slot.slot;
}

export function scanSlotLabel(slot: string): string {
  return SCAN_SLOTS.find((item) => item.slot === slot)?.label || "Diagnostic scan";
}

function storedCheck(value: string | undefined): string {
  const text = (value || "").trim().toLowerCase();
  if (!text) return "";
  if (text === "yes" || text === "no") return text;
  return "";
}

function parseMileage(raw: string): number {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) throw new Error("Enter the mileage as a whole number.");
  const mileage = Number(text);
  if (mileage > 2_000_000) throw new Error("Enter a mileage that can be on the vehicle.");
  return mileage;
}

function parseFuel(raw: string): FuelLevel {
  const level = FUEL_LEVELS.find((item) => item.value === raw.trim());
  if (!level) throw new Error("Choose a fuel level: Empty, ¼, ½, ¾ or Full.");
  return level.value;
}

function imageMime(filename: string, mimeType: string, buffer?: Buffer): string {
  const mime = mimeType.toLowerCase();
  if (mime === "image/jpg" || mime === "image/pjpeg" || mime === "image/jpeg") return "image/jpeg";
  if (mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (buffer && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  throw new Error("Photographs must be JPEG, PNG, WebP or GIF.");
}

function storePhotos(claimId: string, handoverId: string, actorId: string, photos: HandoverPhotoInput[], takenAt: string) {
  assertPhotosFit(slotsFor(handoverId), photos);
  for (const photo of photos) {
    const slot = photoSlot(photo.slot);
    if (photo.buffer.length > MAX_PHOTO_BYTES) throw new Error("Each photograph must be 12 MB or smaller.");
    const mime = imageMime(photo.filename, photo.mimeType, photo.buffer);
    const label = shotLabel(slot);
    const stored = storeFileCopy({
      relDir: `claims/${claimId}/handover/${handoverId}`,
      originalFilename: `${newId("photo")}-${photo.filename || "photo.jpg"}`,
      buffer: photo.buffer,
    });
    const documentId = insertStoredDocument({
      title: slot === DAMAGE_SHOT ? "Damage photograph" : `${label} photograph`,
      documentType: "handover_photo",
      kind: "photograph",
      claimId,
      originalFilename: photo.filename || "photo.jpg",
      storedRelpath: stored.storedRelpath,
      mimeType: mime,
      byteSize: stored.byteSize,
      createdBy: actorId,
      simulated: 0,
    });
    run(
      `INSERT INTO vehicle_handover_photos(id, handover_id, document_id, slot, taken_at) VALUES (?, ?, ?, ?, ?)`,
      [newId("hop"), handoverId, documentId, slot, takenAt],
    );
  }
}

function slotsFor(handoverId: string): string[] {
  return (all(`SELECT slot FROM vehicle_handover_photos WHERE handover_id = ?`, [handoverId]) as Array<{ slot: string | null }>).map(
    (row) => row.slot || DAMAGE_SHOT,
  );
}

function scanMime(filename: string, mimeType: string): string {
  const mime = mimeType.toLowerCase();
  const lower = filename.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (mime === "application/xml" || mime === "text/xml") return "text/xml";
  if (mime.startsWith("text/")) return mime === "text/csv" ? "text/csv" : mime.startsWith("text/html") ? "text/html" : "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xml")) return "text/xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".json") || mime === "application/json") return "application/json";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  throw new Error("A diagnostic scan must be a PDF, an image, or a text export from the tool.");
}

function storeScan(claimId: string, handoverId: string, actorId: string, slot: HandoverScanSlot, file: HandoverFileInput, attachedAt: string) {
  if (file.buffer.length < 1) throw new Error(`Choose a file for the ${scanSlotLabel(slot).toLowerCase()}.`);
  if (file.buffer.length > MAX_SCAN_BYTES) throw new Error("A diagnostic scan must be 12 MB or smaller.");
  const existing = get<{ id: string }>(
    `SELECT id FROM vehicle_handover_scans WHERE handover_id = ? AND slot = ?`,
    [handoverId, slot],
  );
  if (existing) throw new Error(`A ${scanSlotLabel(slot).toLowerCase()} is already on this locked record. Record a new handover if a different file is needed.`);
  const mime = scanMime(file.filename, file.mimeType);
  const label = scanSlotLabel(slot);
  const stored = storeFileCopy({
    relDir: `claims/${claimId}/handover/${handoverId}`,
    originalFilename: `${newId("scan")}-${file.filename || "scan.pdf"}`,
    buffer: file.buffer,
  });
  const documentId = insertStoredDocument({
    title: label,
    documentType: "handover_scan",
    kind: "file",
    claimId,
    originalFilename: file.filename || "scan.pdf",
    storedRelpath: stored.storedRelpath,
    mimeType: mime,
    byteSize: stored.byteSize,
    createdBy: actorId,
    simulated: 0,
  });
  run(
    `INSERT INTO vehicle_handover_scans(id, handover_id, slot, document_id, attached_at) VALUES (?, ?, ?, ?, ?)`,
    [newId("hos"), handoverId, slot, documentId, attachedAt],
  );
}

export function recordVehicleHandover(input: HandoverInput): { id: string; incomplete: boolean } {
  const event = handoverEvent(input.eventKind);
  if (!event) throw new Error("Choose which handover this is.");
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const staff = get<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  let hireEpisodeId: string | null = null;
  let bookingLabel = "Customer's vehicle";
  if (event.needsBooking) {
    const episodeId = input.hireEpisodeId.trim();
    if (!episodeId) throw new Error("Choose the hire booking this handover belongs to.");
    const episode = get<{ id: string; registration: string | null; make: string | null; model: string | null }>(
      `SELECT he.id, v.registration, v.make, v.model
       FROM hire_episodes he
       LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
       LEFT JOIN vehicles v ON v.id = fv.vehicle_id
       WHERE he.id = ? AND he.claim_id = ?`,
      [episodeId, input.claimId],
    );
    if (!episode) throw new Error("That hire booking is not on this file.");
    hireEpisodeId = episode.id;
    bookingLabel = [episode.make, episode.model, episode.registration].filter(Boolean).join(" ") || "Hire car";
  }
  assertCanRecordHandover(staff, input.claimId, hireEpisodeId);
  const mileage = parseMileage(input.mileage);
  const fuel = parseFuel(input.fuelLevel);
  const checks = {
    spare_wheel: storedCheck(input.spareWheel),
    tools_present: storedCheck(input.toolsPresent),
    warning_lights_off: storedCheck(input.warningLightsOff),
    tyres_legal: storedCheck(input.tyresLegal),
  };
  const note = input.conditionNote.trim().slice(0, 4000);
  const occurredAt = nowUtcIso();
  const id = newId("vh");
  const db = getDb();
  db.exec("BEGIN");
  try {
    run(
      `INSERT INTO vehicle_handovers(
        id, claim_id, hire_episode_id, event_kind, occurred_at, recorded_by, mileage, fuel_level,
        spare_wheel, tools_present, warning_lights_off, tyres_legal, condition_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.claimId,
        hireEpisodeId,
        event.kind,
        occurredAt,
        staff.id,
        mileage,
        fuel,
        checks.spare_wheel,
        checks.tools_present,
        checks.warning_lights_off,
        checks.tyres_legal,
        note,
        occurredAt,
      ],
    );
    storePhotos(input.claimId, id, staff.id, input.photos, occurredAt);
    const attachedScans: string[] = [];
    if (input.preScan) {
      storeScan(input.claimId, id, staff.id, "pre", input.preScan, occurredAt);
      attachedScans.push("pre-scan");
    }
    if (input.postScan) {
      storeScan(input.claimId, id, staff.id, "post", input.postScan, occurredAt);
      attachedScans.push("post-scan");
    }
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "vehicle_handover_recorded",
      occurredAt,
      actorId: staff.id,
      details: `${event.label} (${bookingLabel}). Mileage ${formatHandoverMileage(mileage)}. Fuel ${fuelLevelLabel(fuel)}. Recorded by ${staff.name}. ${photoProgress(input.photos.map((photo) => photo.slot))}${attachedScans.length ? ` Diagnostic ${attachedScans.join(" and ")} attached.` : ""}${note ? ` Note: ${note}` : ""}`,
      source: "staff",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id, incomplete: handoverIncomplete(input.photos.map((photo) => photo.slot)) };
}

export function addHandoverPhotographs(input: {
  claimId: string;
  handoverId: string;
  actorId: string;
  photos: HandoverPhotoInput[];
}): { incomplete: boolean } {
  if (input.photos.length < 1) throw new Error("Choose at least one photograph.");
  const row = get<{ id: string; event_kind: string; mileage: number; hire_episode_id: string | null }>(
    `SELECT id, event_kind, mileage, hire_episode_id FROM vehicle_handovers WHERE id = ? AND claim_id = ?`,
    [input.handoverId, input.claimId],
  );
  if (!row) throw new Error("That handover record was not found on this file.");
  const staff = get<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  assertCanRecordHandover(staff, input.claimId, row.hire_episode_id);
  const takenAt = nowUtcIso();
  const mileageBefore = row.mileage;
  const db = getDb();
  db.exec("BEGIN");
  try {
    storePhotos(input.claimId, row.id, staff.id, input.photos, takenAt);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "vehicle_handover_photos_added",
      occurredAt: takenAt,
      actorId: staff.id,
      details: `Photographs added to the locked handover by ${staff.name}. ${photoProgress(slotsFor(row.id))} Mileage was not changed.`,
      source: "staff",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const after = get<{ mileage: number }>(`SELECT mileage FROM vehicle_handovers WHERE id = ?`, [row.id]);
  if (after && after.mileage !== mileageBefore) {
    throw new Error("The locked handover was changed. That should not happen.");
  }
  return { incomplete: handoverIncomplete(slotsFor(row.id)) };
}

export function attachHandoverScan(input: {
  claimId: string;
  handoverId: string;
  actorId: string;
  slot: string;
  file: HandoverFileInput;
}): { incomplete: boolean } {
  const slot = scanSlot(input.slot);
  const row = get<{ id: string; mileage: number }>(
    `SELECT id, mileage FROM vehicle_handovers WHERE id = ? AND claim_id = ?`,
    [input.handoverId, input.claimId],
  );
  if (!row) throw new Error("That handover record was not found on this file.");
  const staff = get<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  if (!isOfficeRole(staff.role)) throw new Error("You cannot attach a diagnostic scan.");
  const attachedAt = nowUtcIso();
  const mileageBefore = row.mileage;
  const db = getDb();
  db.exec("BEGIN");
  try {
    storeScan(input.claimId, row.id, staff.id, slot, input.file, attachedAt);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "vehicle_handover_scan_added",
      occurredAt: attachedAt,
      actorId: staff.id,
      details: `${scanSlotLabel(slot)} attached to the locked handover by ${staff.name}. Mileage, the checklist and the incomplete flag were not changed.`,
      source: "staff",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const after = get<{ mileage: number }>(`SELECT mileage FROM vehicle_handovers WHERE id = ?`, [row.id]);
  if (after && after.mileage !== mileageBefore) {
    throw new Error("The locked handover was changed. That should not happen.");
  }
  return { incomplete: handoverIncomplete(slotsFor(row.id)) };
}

export function finishVehicleHandover(input: { claimId: string; handoverId: string; actorId: string }): { finishedAt: string } {
  const row = get<{ id: string; hire_episode_id: string | null; event_kind: string; finished_at: string | null }>(
    `SELECT id, hire_episode_id, event_kind, finished_at FROM vehicle_handovers WHERE id = ? AND claim_id = ?`,
    [input.handoverId, input.claimId],
  );
  if (!row) throw new Error("That handover record was not found on this file.");
  const staff = get<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  assertCanRecordHandover(staff, input.claimId, row.hire_episode_id);
  const missing = missingStandardShots(slotsFor(row.id));
  if (missing.length > 0) {
    throw new Error(`Take ${missing.map((shot) => shot.label).join(", ")} before finishing. Damage photographs are optional.`);
  }
  if (row.finished_at) return { finishedAt: row.finished_at };
  const finishedAt = nowUtcIso();
  const event = handoverEvent(row.event_kind);
  run(`UPDATE vehicle_handovers SET finished_at = ? WHERE id = ?`, [finishedAt, row.id]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "vehicle_handover_finished",
    occurredAt: finishedAt,
    actorId: staff.id,
    details: `${event?.label || "Handover"} finished by ${staff.name}. The five standard photographs are saved.`,
    source: "staff",
  });
  return { finishedAt };
}

type HandoverRow = {
  id: string;
  claim_id: string;
  hire_episode_id: string | null;
  event_kind: string;
  occurred_at: string;
  recorded_by: string;
  recorded_by_name: string | null;
  mileage: number;
  fuel_level: string;
  spare_wheel: string;
  tools_present: string;
  warning_lights_off: string;
  tyres_legal: string;
  condition_note: string;
  finished_at: string | null;
  booking_make: string | null;
  booking_model: string | null;
  booking_reg: string | null;
};

function asYesNo(value: string): "yes" | "no" {
  return value === "no" ? "no" : "yes";
}

function toRecord(row: HandoverRow, photos: HandoverPhoto[], scans: HandoverScan[]): HandoverRecord {
  const event = handoverEvent(row.event_kind);
  const fuel = (FUEL_LEVELS.some((level) => level.value === row.fuel_level) ? row.fuel_level : "empty") as FuelLevel;
  const booking = [row.booking_make, row.booking_model, row.booking_reg].filter(Boolean).join(" ");
  return {
    id: row.id,
    claimId: row.claim_id,
    hireEpisodeId: row.hire_episode_id,
    eventKind: (event?.kind || "hire_delivered") as HandoverEventKind,
    eventLabel: event?.label || row.event_kind,
    occurredAt: row.occurred_at,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name || "Unknown staff",
    mileage: Number(row.mileage),
    fuelLevel: fuel,
    fuelLabel: fuelLevelLabel(fuel),
    spareWheel: asYesNo(row.spare_wheel),
    toolsPresent: asYesNo(row.tools_present),
    warningLightsOff: asYesNo(row.warning_lights_off),
    tyresLegal: asYesNo(row.tyres_legal),
    conditionNote: row.condition_note || "",
    bookingLabel: booking || (event?.needsBooking ? "Hire car" : "Customer's vehicle"),
    photos,
    scans,
    incomplete: handoverIncomplete(photos.map((photo) => photo.slot)),
    finishedAt: row.finished_at || null,
  };
}

export function listVehicleHandovers(claimId: string): HandoverRecord[] {
  const rows = listRows(claimId);
  return rows.map((row) => toRecord(row, photosFor(row.id), scansFor(row.id)));
}

function listRows(claimId: string): HandoverRow[] {
  return all(
    `SELECT h.*, s.name AS recorded_by_name,
            CASE WHEN h.hire_episode_id IS NULL THEN own.make ELSE v.make END AS booking_make,
            CASE WHEN h.hire_episode_id IS NULL THEN own.model ELSE v.model END AS booking_model,
            CASE WHEN h.hire_episode_id IS NULL THEN own.registration ELSE v.registration END AS booking_reg
     FROM vehicle_handovers h
     LEFT JOIN staff s ON s.id = h.recorded_by
     LEFT JOIN claims cl ON cl.id = h.claim_id
     LEFT JOIN vehicles own ON own.id = cl.client_vehicle_id
     LEFT JOIN hire_episodes he ON he.id = h.hire_episode_id
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE h.claim_id = ?
     ORDER BY h.occurred_at DESC, h.id DESC`,
    [claimId],
  ) as HandoverRow[];
}

function photosFor(handoverId: string): HandoverPhoto[] {
  const rows = all(
    `SELECT p.id, p.slot, p.document_id, p.taken_at, d.title
     FROM vehicle_handover_photos p
     JOIN documents d ON d.id = p.document_id
     WHERE p.handover_id = ?
     ORDER BY p.taken_at ASC, p.id ASC`,
    [handoverId],
  ) as Array<{ id: string; slot: string | null; document_id: string; taken_at: string; title: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    slot: row.slot || DAMAGE_SHOT,
    documentId: row.document_id,
    takenAt: row.taken_at,
    title: row.title || "Condition photograph",
  }));
}

function scansFor(handoverId: string): HandoverScan[] {
  const rows = all(
    `SELECT s.id, s.slot, s.document_id, s.attached_at, d.title, d.original_filename, d.mime_type
     FROM vehicle_handover_scans s
     JOIN documents d ON d.id = s.document_id
     WHERE s.handover_id = ?
     ORDER BY s.attached_at ASC, s.id ASC`,
    [handoverId],
  ) as Array<{
    id: string;
    slot: string;
    document_id: string;
    attached_at: string;
    title: string | null;
    original_filename: string | null;
    mime_type: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    slot: row.slot === "post" ? "post" : "pre",
    documentId: row.document_id,
    attachedAt: row.attached_at,
    title: row.title || scanSlotLabel(row.slot),
    filename: row.original_filename || "scan",
    mimeType: row.mime_type || "",
  }));
}

function reading(claimId: string, kind: HandoverEventKind, hireEpisodeId: string | null): HandoverReading | null {
  const row = hireEpisodeId
    ? get<{ mileage: number; fuel_level: string; occurred_at: string }>(
        `SELECT mileage, fuel_level, occurred_at FROM vehicle_handovers
         WHERE claim_id = ? AND event_kind = ? AND hire_episode_id = ?
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [claimId, kind, hireEpisodeId],
      )
    : get<{ mileage: number; fuel_level: string; occurred_at: string }>(
        `SELECT mileage, fuel_level, occurred_at FROM vehicle_handovers
         WHERE claim_id = ? AND event_kind = ? AND hire_episode_id IS NULL
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [claimId, kind],
      );
  if (!row) return null;
  return {
    mileage: Number(row.mileage),
    fuelLabel: fuelLevelLabel(row.fuel_level),
    occurredAt: row.occurred_at,
  };
}

export function handoverReadingsForClaim(claimId: string, hireEpisodeId: string | null) {
  return {
    hireDelivery: hireEpisodeId ? reading(claimId, "hire_delivered", hireEpisodeId) : null,
    hireCollection: hireEpisodeId ? reading(claimId, "hire_collected", hireEpisodeId) : null,
    clientRecovery: reading(claimId, "client_recovered", null),
  };
}

export function listHireBookings(claimId: string) {
  return all(
    `SELECT he.id, he.started_at, v.registration, v.make, v.model
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ?
     ORDER BY he.started_at DESC`,
    [claimId],
  ) as Array<{ id: string; started_at: string | null; registration: string | null; make: string | null; model: string | null }>;
}

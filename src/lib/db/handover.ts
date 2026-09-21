import { nowUtcIso } from "../dates";
import { storeFileCopy } from "../storage/files";
import { all, get, getDb, newId, run } from "./connection";
import { recordClaimEvent } from "./chronology";
import { insertStoredDocument } from "./documents-store";

export const HANDOVER_EVENTS = [
  { kind: "hire_delivered", label: "Hire vehicle delivered to client", needsBooking: true },
  { kind: "hire_collected", label: "Hire vehicle collected from client", needsBooking: true },
  { kind: "client_recovered", label: "Client's own vehicle recovered", needsBooking: false },
  { kind: "client_returned", label: "Client's own vehicle returned", needsBooking: false },
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
const MAX_PHOTOS = 12;

export type HandoverPhotoInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export type HandoverInput = {
  claimId: string;
  eventKind: string;
  hireEpisodeId: string;
  mileage: string;
  fuelLevel: string;
  spareWheel: string;
  toolsPresent: string;
  warningLightsOff: string;
  tyresLegal: string;
  conditionNote: string;
  actorId: string;
  photos: HandoverPhotoInput[];
};

export type HandoverReading = {
  mileage: number;
  fuelLabel: string;
  occurredAt: string;
};

export type HandoverPhoto = {
  id: string;
  documentId: string;
  takenAt: string;
  title: string;
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
  incomplete: boolean;
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

export function handoverIncomplete(photoCount: number): boolean {
  return photoCount < 1;
}

function yesNo(value: string, label: string): "yes" | "no" {
  const text = value.trim().toLowerCase();
  if (text === "yes" || text === "no") return text;
  throw new Error(`Choose yes or no for ${label}.`);
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

function imageMime(filename: string, mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" || mime === "image/gif") return mime;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  throw new Error("Photographs must be JPEG, PNG, WebP or GIF.");
}

function storePhotos(claimId: string, handoverId: string, actorId: string, eventLabel: string, photos: HandoverPhotoInput[], takenAt: string) {
  if (photos.length > MAX_PHOTOS) throw new Error("Attach up to 12 photographs at a time.");
  for (const photo of photos) {
    if (photo.buffer.length > MAX_PHOTO_BYTES) throw new Error("Each photograph must be 12 MB or smaller.");
    const mime = imageMime(photo.filename, photo.mimeType);
    const stored = storeFileCopy({
      relDir: `claims/${claimId}/handover/${handoverId}`,
      originalFilename: `${newId("photo")}-${photo.filename || "photo.jpg"}`,
      buffer: photo.buffer,
    });
    const documentId = insertStoredDocument({
      title: `${eventLabel} photograph`,
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
      `INSERT INTO vehicle_handover_photos(id, handover_id, document_id, taken_at) VALUES (?, ?, ?, ?)`,
      [newId("hop"), handoverId, documentId, takenAt],
    );
  }
}

export function recordVehicleHandover(input: HandoverInput): { id: string; incomplete: boolean } {
  const event = handoverEvent(input.eventKind);
  if (!event) throw new Error("Choose which handover this is.");
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const staff = get<{ id: string; name: string }>(`SELECT id, name FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  let hireEpisodeId: string | null = null;
  let bookingLabel = "Client's own vehicle";
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
    bookingLabel = [episode.make, episode.model, episode.registration].filter(Boolean).join(" ") || "Hire vehicle";
  }
  const mileage = parseMileage(input.mileage);
  const fuel = parseFuel(input.fuelLevel);
  const checks = {
    spare_wheel: yesNo(input.spareWheel, "spare wheel present"),
    tools_present: yesNo(input.toolsPresent, "tools present"),
    warning_lights_off: yesNo(input.warningLightsOff, "warning lights off"),
    tyres_legal: yesNo(input.tyresLegal, "tyres visibly legal"),
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
    storePhotos(input.claimId, id, staff.id, event.label, input.photos, occurredAt);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "vehicle_handover_recorded",
      occurredAt,
      actorId: staff.id,
      details: `${event.label} (${bookingLabel}). Mileage ${formatHandoverMileage(mileage)}. Fuel ${fuelLevelLabel(fuel)}. Recorded by ${staff.name}. ${input.photos.length ? `${input.photos.length} photograph(s).` : "No photographs yet — incomplete."}${note ? ` Note: ${note}` : ""}`,
      source: "staff",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id, incomplete: handoverIncomplete(input.photos.length) };
}

export function addHandoverPhotographs(input: {
  claimId: string;
  handoverId: string;
  actorId: string;
  photos: HandoverPhotoInput[];
}): { incomplete: boolean } {
  if (input.photos.length < 1) throw new Error("Choose at least one photograph.");
  const row = get<{ id: string; event_kind: string; mileage: number }>(
    `SELECT id, event_kind, mileage FROM vehicle_handovers WHERE id = ? AND claim_id = ?`,
    [input.handoverId, input.claimId],
  );
  if (!row) throw new Error("That handover record was not found on this file.");
  const event = handoverEvent(row.event_kind);
  const staff = get<{ id: string; name: string }>(`SELECT id, name FROM staff WHERE id = ?`, [input.actorId]);
  if (!staff) throw new Error("The signed-in staff member could not be recorded.");
  const takenAt = nowUtcIso();
  const mileageBefore = row.mileage;
  const db = getDb();
  db.exec("BEGIN");
  try {
    storePhotos(input.claimId, row.id, staff.id, event?.label || "Handover", input.photos, takenAt);
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "vehicle_handover_photos_added",
      occurredAt: takenAt,
      actorId: staff.id,
      details: `${input.photos.length} condition photograph(s) added to the locked handover by ${staff.name}. Mileage and the checklist were not changed.`,
      source: "staff",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const after = get<{ mileage: number; photos: number }>(
    `SELECT h.mileage AS mileage, (SELECT COUNT(*) FROM vehicle_handover_photos p WHERE p.handover_id = h.id) AS photos
     FROM vehicle_handovers h WHERE h.id = ?`,
    [row.id],
  );
  if (after && after.mileage !== mileageBefore) {
    throw new Error("The locked handover was changed. That should not happen.");
  }
  return { incomplete: handoverIncomplete(Number(after?.photos || 0)) };
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
  booking_make: string | null;
  booking_model: string | null;
  booking_reg: string | null;
};

function asYesNo(value: string): "yes" | "no" {
  return value === "no" ? "no" : "yes";
}

function toRecord(row: HandoverRow, photos: HandoverPhoto[]): HandoverRecord {
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
    bookingLabel: booking || (event?.needsBooking ? "Hire vehicle" : "Client's own vehicle"),
    photos,
    incomplete: handoverIncomplete(photos.length),
  };
}

export function listVehicleHandovers(claimId: string): HandoverRecord[] {
  const rows = listRows(claimId);
  return rows.map((row) => toRecord(row, photosFor(row.id)));
}

function listRows(claimId: string): HandoverRow[] {
  return all(
    `SELECT h.*, s.name AS recorded_by_name, v.make AS booking_make, v.model AS booking_model, v.registration AS booking_reg
     FROM vehicle_handovers h
     LEFT JOIN staff s ON s.id = h.recorded_by
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
    `SELECT p.id, p.document_id, p.taken_at, d.title
     FROM vehicle_handover_photos p
     JOIN documents d ON d.id = p.document_id
     WHERE p.handover_id = ?
     ORDER BY p.taken_at ASC, p.id ASC`,
    [handoverId],
  ) as Array<{ id: string; document_id: string; taken_at: string; title: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    takenAt: row.taken_at,
    title: row.title || "Condition photograph",
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

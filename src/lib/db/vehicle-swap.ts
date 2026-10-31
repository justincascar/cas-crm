import type { DatabaseSync } from "node:sqlite";
import { OVERRIDE_UNSIGNED_SWAP } from "../auth/roles";
import { AGREEMENT_ALERT_FROM_DAY, AGREEMENT_LENGTH_DAYS } from "../constants";
import { formatUkDate, formatUkDateTime, londonDateIso, nowUtcIso, requireLondonDateTime } from "../dates";
import { carNotFreeMessage } from "../domain/fleet-availability";
import { agreementHoldEndDay } from "../domain/hire-availability";
import { agreementDayNumber } from "../domain/rules";
import { insertStoredDocument } from "./documents-store";
import { storeFileCopy } from "../storage/files";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { fleetAvailability } from "./fleet-availability";
import { fleetCarDetails, missingWords, SWAP_AGREEMENT_FIELDS, type FleetDetailField } from "./fleet-details";
import { hireGroupCheck } from "./hire-group-check";
import { describeHireAgreementParts } from "../documents/hire-agreement-parts";
import { FUEL_LEVELS } from "./handover";
import {
  buildHireAgreementView,
  HIRE_AGREEMENT_DOCUMENT_TYPE,
  HIRE_AGREEMENT_TEMPLATE_KEY,
  hireAgreementMissing,
  renderHireAgreement,
  takeNextHireAgreementNumber,
} from "./hire-agreement";
import { getHirePack } from "./hire-pack";
import { readSignedUpload, SIGNED_HIRE_AGREEMENT_TYPE } from "./hire-readiness";
import { listStaffPermissions } from "./permissions";

/**
 * A vehicle swap mid-hire (review note R26). The client signs a complete new hire agreement for the replacement car,
 * produced from the supplied Hire Pack with the new car's details, mileage and fuel out and the date and time. The old
 * car's return (mileage and fuel in, condition) is recorded at the same time. The swap is completed only when the new
 * agreement is signed (on screen or a photographed paper copy), or when Justin overrides it with a reason.
 *
 * It stays one continuous hire for billing and chasing: the hire start date and day count do not change. The earlier
 * signed agreement stays on the file, marked superseded and linked to the new one. The terms run the Rental Period
 * and Credit Period from the date of the agreement, so the renewal alerts follow the latest signed agreement.
 */

export function ensureVehicleSwapTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hire_swaps (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      hire_episode_id TEXT NOT NULL,
      old_fleet_vehicle_id TEXT NOT NULL,
      new_fleet_vehicle_id TEXT NOT NULL,
      reservation_id TEXT,
      swap_at TEXT NOT NULL,
      old_mileage_in INTEGER NOT NULL,
      old_fuel_in TEXT NOT NULL,
      old_condition TEXT NOT NULL,
      new_mileage_out INTEGER NOT NULL,
      new_fuel_out TEXT NOT NULL,
      new_condition TEXT NOT NULL,
      agreement_document_id TEXT,
      signed_document_id TEXT,
      superseded_document_id TEXT,
      agreement_id TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_signature',
      override_reason TEXT,
      override_by TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);
  const columns = new Set((db.prepare(`PRAGMA table_info(documents)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("superseded_by_document_id")) db.exec(`ALTER TABLE documents ADD COLUMN superseded_by_document_id TEXT`);
  const swapColumns = new Set((db.prepare(`PRAGMA table_info(hire_swaps)`).all() as Array<{ name: string }>).map((c) => c.name));
  // R29: the new agreement has its own number, linked to the one it replaces.
  if (!swapColumns.has("agreement_number")) db.exec(`ALTER TABLE hire_swaps ADD COLUMN agreement_number TEXT`);
  if (!swapColumns.has("replaces_agreement_number")) db.exec(`ALTER TABLE hire_swaps ADD COLUMN replaces_agreement_number TEXT`);
  // R27: the reason for charging above the replacement car's group.
  if (!swapColumns.has("above_supplied_reason")) db.exec(`ALTER TABLE hire_swaps ADD COLUMN above_supplied_reason TEXT`);
}

function ready() {
  ensureVehicleSwapTables(getDb());
}

export { SWAP_AGREEMENT_FIELDS };

export type SwapReadings = {
  oldMileageIn: string;
  oldFuelIn: string;
  oldCondition: string;
  newMileageOut: string;
  newFuelOut: string;
  newCondition: string;
};

type SwapRow = {
  id: string;
  claim_id: string;
  hire_episode_id: string;
  old_fleet_vehicle_id: string;
  new_fleet_vehicle_id: string;
  reservation_id: string | null;
  swap_at: string;
  old_mileage_in: number;
  old_fuel_in: string;
  old_condition: string;
  new_mileage_out: number;
  new_fuel_out: string;
  new_condition: string;
  agreement_document_id: string | null;
  signed_document_id: string | null;
  agreement_number: string | null;
  replaces_agreement_number: string | null;
  above_supplied_reason: string | null;
  status: string;
  override_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

type RunningEpisode = { id: string; fleet_vehicle_id: string; started_at: string; credit_hire: number; rate_pence_per_day: number | null };

function runningEpisode(claimId: string): RunningEpisode | undefined {
  return get<RunningEpisode>(
    `SELECT id, fleet_vehicle_id, started_at, credit_hire, rate_pence_per_day FROM hire_episodes
     WHERE claim_id = ? AND started_at IS NOT NULL AND collection_at IS NULL AND billing_end_at IS NULL AND fleet_vehicle_id IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`,
    [claimId],
  );
}

function miles(value: string, what: string): number {
  const text = String(value || "").replace(/[,\s]/g, "");
  if (!/^\d{1,7}$/.test(text)) throw new Error(`Enter ${what} in miles.`);
  return Number(text);
}

function fuel(value: string, what: string): string {
  if (!FUEL_LEVELS.some((level) => level.value === value)) throw new Error(`Choose ${what}.`);
  return value;
}

function fuelLabel(value: string): string {
  return FUEL_LEVELS.find((level) => level.value === value)?.label || value;
}

function condition(value: string, what: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Describe ${what}. Write "No new damage" if there is none.`);
  return text.slice(0, 1000);
}

function carLabel(fleetVehicleId: string): string {
  const car = fleetCarDetails(fleetVehicleId);
  return car ? [car.make, car.model, car.registration].filter(Boolean).join(" ") : "the car";
}

/** The swap waiting for its signed agreement, if any. */
export function openSwap(claimId: string): SwapRow | null {
  ready();
  return get<SwapRow>(`SELECT * FROM hire_swaps WHERE claim_id = ? AND status = 'awaiting_signature' ORDER BY created_at DESC LIMIT 1`, [claimId]) || null;
}

export function canOverrideUnsignedSwap(staffId: string): boolean {
  return listStaffPermissions(staffId).includes(OVERRIDE_UNSIGNED_SWAP);
}

/**
 * Starts the swap: records both cars' readings, holds the new car, and produces the new hire agreement for signature.
 * The car on the hire does not change until the agreement is signed. A courtesy car has no agreement, so its swap
 * completes straight away.
 */
export function startVehicleSwap(
  input: {
    claimId: string;
    actorId: string;
    newFleetVehicleId: string;
    date: string;
    time: string;
    /** Details missing on the replacement car's fleet record (R28). Saved to the fleet record. */
    details?: Partial<Record<FleetDetailField, string>>;
    /** Why the group charged is above the replacement car's group (R27). */
    aboveSuppliedReason?: string;
  } & SwapReadings,
) {
  ready();
  const episode = runningEpisode(input.claimId);
  if (!episode) throw new Error("A swap is for a car already on hire. Choose a car on the Hire tab instead.");
  if (openSwap(input.claimId)) throw new Error("A swap is already waiting for its signed agreement. Finish or cancel that one first.");
  if (!input.newFleetVehicleId) throw new Error("Choose the replacement car.");
  if (input.newFleetVehicleId === episode.fleet_vehicle_id) throw new Error("Choose a different car. That one is already on this hire.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new Error("Enter the date and time of the swap.");
  const swapAt = requireLondonDateTime(`${input.date}T${input.time}`);
  if (swapAt < String(episode.started_at)) throw new Error("The swap cannot be before the hire started.");
  const readings = {
    oldMileageIn: miles(input.oldMileageIn, "the old car's mileage in"),
    oldFuelIn: fuel(input.oldFuelIn, "the old car's fuel in"),
    oldCondition: condition(input.oldCondition, "the old car's condition when returned"),
    newMileageOut: miles(input.newMileageOut, "the new car's mileage out"),
    newFuelOut: fuel(input.newFuelOut, "the new car's fuel out"),
    newCondition: condition(input.newCondition, "the new car's condition when it goes out"),
  };
  const endAt = requireLondonDateTime(`${agreementHoldEndDay(input.date)}T23:59`);
  const availability = fleetAvailability({ startAt: swapAt, endAt, ignoreClaimId: input.claimId }).find((row) => row.carId === input.newFleetVehicleId);
  if (!availability || availability.state === "removed") throw new Error("That car is not on the fleet.");
  if (!availability.free) throw new Error(carNotFreeMessage(availability));
  const creditHire = Number(episode.credit_hire) === 1;
  const aboveReason = creditHire ? swapAgreementChecks(input) : "";
  const now = nowUtcIso();
  const reservationId = newId("res");
  run(
    `INSERT INTO reservations(id, fleet_vehicle_id, claim_id, start_at, end_at, kind, status, charges_started, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'reserved', 0, ?, ?)`,
    [reservationId, input.newFleetVehicleId, input.claimId, swapAt, endAt, creditHire ? "hire" : "courtesy", input.actorId, now],
  );
  run(`UPDATE fleet_vehicles SET status = 'reserved' WHERE id = ? AND status = 'available'`, [input.newFleetVehicleId]);
  const id = newId("swap");
  run(
    `INSERT INTO hire_swaps(id, claim_id, hire_episode_id, old_fleet_vehicle_id, new_fleet_vehicle_id, reservation_id, swap_at,
       old_mileage_in, old_fuel_in, old_condition, new_mileage_out, new_fuel_out, new_condition, created_by, created_at, above_supplied_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      episode.id,
      episode.fleet_vehicle_id,
      input.newFleetVehicleId,
      reservationId,
      swapAt,
      readings.oldMileageIn,
      readings.oldFuelIn,
      readings.oldCondition,
      readings.newMileageOut,
      readings.newFuelOut,
      readings.newCondition,
      input.actorId,
      now,
      aboveReason || null,
    ],
  );
  const oldLabel = carLabel(episode.fleet_vehicle_id);
  const newLabel = carLabel(input.newFleetVehicleId);
  // The condition is kept as typed; only a closing full stop is dropped so the sentence does not end "..".
  const noStop = (text: string) => text.replace(/[.\s]+$/, "");
  const returned = `${oldLabel} returned: ${readings.oldMileageIn.toLocaleString("en-GB")} miles, fuel ${fuelLabel(readings.oldFuelIn)}, condition: ${noStop(readings.oldCondition)}`;
  const out = `${newLabel} out: ${readings.newMileageOut.toLocaleString("en-GB")} miles, fuel ${fuelLabel(readings.newFuelOut)}, condition: ${noStop(readings.newCondition)}`;
  if (!creditHire) {
    recordClaimEvent({
      claimId: input.claimId,
      eventType: "other",
      occurredAt: now,
      actorId: input.actorId,
      details: `Courtesy car swap on ${formatUkDateTime(swapAt)}. ${returned}. ${out}.`,
      source: "staff",
    });
    completeSwap({ swapId: id, actorId: input.actorId, signedDocumentId: null, overrideReason: null });
    return { swapId: id, agreementDocumentId: null, completed: true };
  }
  const produced = produceSwapAgreement({ claimId: input.claimId, actorId: input.actorId, swapId: id });
  const agreementDocumentId = produced.documentId;
  const charged = hireGroupCheck(input.claimId).groupCharged;
  const car = fleetCarDetails(input.newFleetVehicleId);
  const aboveWords = aboveReason
    ? ` Group charged ${charged} is above the replacement car's group (${car?.gtaGroup}). Reason: ${aboveReason}. The rate stays on group ${charged}.`
    : "";
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_swap_started",
    occurredAt: now,
    actorId: input.actorId,
    documentId: agreementDocumentId,
    details: `Vehicle swap to ${newLabel} on ${formatUkDateTime(swapAt)}. ${returned}. ${out}. New hire agreement ${produced.agreementNumber} for ${newLabel} was produced from the Hire Pack for the client to sign${produced.replaces ? `. It replaces agreement ${produced.replaces}` : ""}. The swap is completed when it is signed. Until then ${oldLabel} stays on the hire.${aboveWords}`,
    source: "staff",
  });
  return { swapId: id, agreementDocumentId, completed: false };
}

/**
 * Before a credit-hire swap: the replacement car's gearbox, seats, fuel, colour and group are on its fleet record
 * (entered on the swap form if not, R28), the client's own car group is on the file (R27), and a reason is given when
 * the group charged is above the replacement car's group. Returns that reason.
 */
function swapAgreementChecks(input: {
  claimId: string;
  actorId: string;
  newFleetVehicleId: string;
  details?: Partial<Record<FleetDetailField, string>>;
  aboveSuppliedReason?: string;
}): string {
  // R60: the replacement car's details are on its fleet record, entered once in Fleet. They are not typed on the swap.
  void input.details;
  const car = fleetCarDetails(input.newFleetVehicleId);
  if (!car) throw new Error("That car is not on the fleet.");
  const missing = SWAP_AGREEMENT_FIELDS.filter((field) => car.missing.includes(field));
  if (missing.length) throw new Error(`The replacement car's fleet record has no ${missingWords(missing)}. Complete it in Fleet (Complete fleet details), then choose it.`);
  const check = hireGroupCheck(input.claimId, { suppliedGroup: car.gtaGroup, aboveSuppliedReason: input.aboveSuppliedReason || "" });
  if (check.gaps.some((gap) => gap.key === "client-group")) {
    throw new Error("Record the client's own car group, or why it cannot be classified, before the new agreement (group check on the Hire tab).");
  }
  if (check.chargedAboveSupplied && !check.aboveSuppliedReason) {
    throw new Error(`Write the reason for charging group ${check.groupCharged} when the replacement car is group ${car.gtaGroup}.`);
  }
  return check.chargedAboveSupplied ? check.aboveSuppliedReason.slice(0, 1000) : "";
}

/** The agreement the new one replaces: the last swap's, otherwise the file's own agreement number. */
function currentAgreementNumber(claimId: string): string | null {
  const swapped = get<{ agreement_number: string | null }>(
    `SELECT agreement_number FROM hire_swaps
     WHERE claim_id = ? AND status = 'completed' AND signed_document_id IS NOT NULL AND agreement_number IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1`,
    [claimId],
  );
  if (swapped?.agreement_number) return String(swapped.agreement_number);
  const claim = get<{ hire_agreement_number: string | null }>(`SELECT hire_agreement_number FROM claims WHERE id = ?`, [claimId]);
  return claim?.hire_agreement_number ? String(claim.hire_agreement_number) : null;
}

/**
 * The new agreement, from the supplied Hire Pack, with the replacement car's details and readings. No wording is
 * changed. It has the next agreement number, linked to the one it replaces (R29): a new car is a new agreement.
 */
function produceSwapAgreement(input: { claimId: string; actorId: string; swapId: string }): { documentId: string; agreementNumber: string; replaces: string | null } {
  const swap = get<SwapRow>(`SELECT * FROM hire_swaps WHERE id = ?`, [input.swapId])!;
  const pack = getHirePack(input.claimId);
  if (!pack) throw new Error("File not found.");
  const car = fleetCarDetails(swap.new_fleet_vehicle_id);
  if (!car) throw new Error("That car is not on the fleet.");
  const episode = runningEpisode(input.claimId);
  const rate = Number(episode?.rate_pence_per_day) > 0 ? Number(episode?.rate_pence_per_day) : null;
  const replaces = swap.replaces_agreement_number || currentAgreementNumber(input.claimId);
  const agreementNumber = swap.agreement_number || takeNextHireAgreementNumber();
  run(`UPDATE hire_swaps SET agreement_number = ?, replaces_agreement_number = ? WHERE id = ?`, [agreementNumber, replaces, input.swapId]);
  const base = buildHireAgreementView(pack, agreementNumber, rate);
  const newCar = [car.make, car.model, car.registration].filter(Boolean).join(" ");
  const view = {
    ...base,
    // The CRM's own note names the car this agreement is for, never the car it replaces.
    hireReason: describeHireAgreementParts({
      hireAllocated: true,
      hireDescription: newCar,
      recoveryStatus: null,
      storageStatus: null,
      storageStartedOn: null,
      recoveryRecoveredAt: null,
      hasReservation: true,
    }).hire.reason,
    hireMake: car.make,
    hireModel: car.model,
    hireRegistration: car.registration,
    hireTransmission: car.transmission,
    hireFuel: car.fuel,
    hireColour: car.colour,
    hireSeats: car.seats != null ? String(car.seats) : "",
    suppliedGroup: car.gtaGroup,
    dateOut: swap.swap_at,
    hireMileage: `${Number(swap.new_mileage_out).toLocaleString("en-GB")} miles`,
    hireFuelLevel: fuelLabel(swap.new_fuel_out),
  };
  const html = renderHireAgreement(view);
  const missing = hireAgreementMissing(view);
  // A new agreement, so its first version.
  const version = 1;
  const documentId = newId("doc");
  const title = `Hire Agreement ${agreementNumber} (replacement car ${car.registration}${replaces ? `, replaces ${replaces}` : ""})`;
  run(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, body_html, template_key, missing_json, created_by, created_at)
     VALUES (?, ?, ?, 'agreement', ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    [documentId, input.claimId, title, HIRE_AGREEMENT_DOCUMENT_TYPE, version, html, HIRE_AGREEMENT_TEMPLATE_KEY, JSON.stringify(missing), input.actorId, nowUtcIso()],
  );
  run(`UPDATE hire_swaps SET agreement_document_id = ? WHERE id = ?`, [documentId, input.swapId]);
  return { documentId, agreementNumber, replaces };
}

/** A photographed or scanned signed copy of the swap agreement. Its signed date is the upload, never earlier. */
export function storeSignedSwapAgreement(input: { claimId: string; actorId: string; file: { buffer: Buffer; filename: string; mimeType: string } }) {
  const swap = openSwap(input.claimId);
  if (!swap) throw new Error("There is no swap waiting for a signed agreement.");
  const file = readSignedUpload(input.file);
  const stored = storeFileCopy({ relDir: `claims/${input.claimId}/documents`, originalFilename: `${newId("file")}-${file.filename}`, buffer: file.buffer });
  const documentId = insertStoredDocument({
    title: "Signed hire agreement (replacement car)",
    documentType: SIGNED_HIRE_AGREEMENT_TYPE,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: swap.new_fleet_vehicle_id,
    originalFilename: file.filename,
    storedRelpath: stored.storedRelpath,
    mimeType: file.mimeType,
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1 WHERE id = ?`, [documentId]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    documentId,
    details: "Signed hire agreement for the replacement car uploaded and filed. Signed date is the day it was filed. Nothing was attached to an email.",
    source: "staff",
  });
  completeSwap({ swapId: swap.id, actorId: input.actorId, signedDocumentId: documentId, overrideReason: null });
  return { documentId };
}

/** Called after an on-screen or link signature: completes the swap if the signed version is the swap agreement. */
export function completeSwapAfterSigning(input: { claimId: string; agreementDocumentId: string; signedDocumentId: string; actorId: string | null }) {
  const swap = openSwap(input.claimId);
  if (!swap || swap.agreement_document_id !== input.agreementDocumentId) return false;
  run(`UPDATE documents SET fleet_vehicle_id = ?, title = 'Signed hire agreement (replacement car)' WHERE id = ?`, [swap.new_fleet_vehicle_id, input.signedDocumentId]);
  completeSwap({ swapId: swap.id, actorId: input.actorId, signedDocumentId: input.signedDocumentId, overrideReason: null });
  return true;
}

/** Justin lets the swap complete without the new signed agreement. Kept on the file with the reason. */
export function overrideUnsignedSwap(input: { claimId: string; actorId: string; reason: string }) {
  if (!canOverrideUnsignedSwap(input.actorId)) throw new Error("Only Justin can complete a swap without the new signed agreement.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter the reason the swap goes ahead without the new signed agreement.");
  const swap = openSwap(input.claimId);
  if (!swap) throw new Error("There is no swap waiting for a signed agreement.");
  completeSwap({ swapId: swap.id, actorId: input.actorId, signedDocumentId: null, overrideReason: reason.slice(0, 1000) });
}

/** Cancels a swap that has not happened. The new car is released; the old car stays on the hire. */
export function cancelVehicleSwap(input: { claimId: string; actorId: string }) {
  const swap = openSwap(input.claimId);
  if (!swap) return;
  run(`UPDATE hire_swaps SET status = 'cancelled', completed_at = ? WHERE id = ?`, [nowUtcIso(), swap.id]);
  if (swap.reservation_id) run(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`, [swap.reservation_id]);
  freeIfIdle(swap.new_fleet_vehicle_id);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Vehicle swap to ${carLabel(swap.new_fleet_vehicle_id)} cancelled before it happened. ${carLabel(swap.old_fleet_vehicle_id)} stays on the hire. The unsigned agreement produced for it is kept on the file and not used.`,
    source: "staff",
  });
}

function freeIfIdle(fleetVehicleId: string) {
  const held = get(`SELECT id FROM reservations WHERE fleet_vehicle_id = ? AND status IN ('reserved', 'active') LIMIT 1`, [fleetVehicleId]);
  const live = get(
    `SELECT id FROM hire_episodes WHERE fleet_vehicle_id = ? AND started_at IS NOT NULL AND billing_end_at IS NULL AND collection_at IS NULL LIMIT 1`,
    [fleetVehicleId],
  );
  if (!held && !live) run(`UPDATE fleet_vehicles SET status = 'available' WHERE id = ? AND status IN ('reserved', 'on_hire')`, [fleetVehicleId]);
}

/**
 * The car changes on the hire. The hire, its start date and its day count are untouched. A signed swap agreement
 * becomes the latest signed agreement, so the 80/88-day alerts follow it; the earlier one is marked superseded.
 */
function completeSwap(input: { swapId: string; actorId: string | null; signedDocumentId: string | null; overrideReason: string | null }) {
  const swap = get<SwapRow>(`SELECT * FROM hire_swaps WHERE id = ?`, [input.swapId])!;
  const now = nowUtcIso();
  const episode = get<{ id: string; started_at: string; credit_hire: number; rate_pence_per_day: number | null }>(
    `SELECT id, started_at, credit_hire, rate_pence_per_day FROM hire_episodes WHERE id = ?`,
    [swap.hire_episode_id],
  )!;
  run(`UPDATE hire_episodes SET fleet_vehicle_id = ? WHERE id = ?`, [swap.new_fleet_vehicle_id, episode.id]);
  // The reason given at the swap now belongs to the car on the hire, so the Hire tab's group check stays met.
  if (swap.above_supplied_reason) {
    const check = hireGroupCheck(swap.claim_id);
    run(`UPDATE hire_pack_data SET above_supplied_reason = ?, above_supplied_for = ? WHERE claim_id = ?`, [
      swap.above_supplied_reason,
      `${check.groupCharged || ""}>${check.suppliedGroup || ""}`,
      swap.claim_id,
    ]);
  }
  run(`UPDATE reservations SET status = 'cancelled' WHERE claim_id = ? AND fleet_vehicle_id = ? AND status IN ('reserved', 'active')`, [swap.claim_id, swap.old_fleet_vehicle_id]);
  if (swap.reservation_id) run(`UPDATE reservations SET status = 'active' WHERE id = ?`, [swap.reservation_id]);
  run(`UPDATE fleet_vehicles SET status = 'on_hire', current_mileage = ?, current_mileage_on = ? WHERE id = ?`, [swap.new_mileage_out, now, swap.new_fleet_vehicle_id]);
  run(`UPDATE fleet_vehicles SET current_mileage = ?, current_mileage_on = ? WHERE id = ?`, [swap.old_mileage_in, now, swap.old_fleet_vehicle_id]);
  freeIfIdle(swap.old_fleet_vehicle_id);

  let agreementWords = "";
  let agreementId: string | null = null;
  let superseded: string | null = null;
  if (input.signedDocumentId) {
    superseded =
      get<{ id: string }>(
        `SELECT id FROM documents WHERE claim_id = ? AND document_type = ? AND id != ? AND superseded_by_document_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        [swap.claim_id, SIGNED_HIRE_AGREEMENT_TYPE, input.signedDocumentId],
      )?.id || null;
    if (superseded) run(`UPDATE documents SET superseded_by_document_id = ? WHERE id = ?`, [input.signedDocumentId, superseded]);
    const startOn = londonDateIso(new Date(now));
    const sequence = Number(get<{ m: number | null }>(`SELECT MAX(sequence) AS m FROM agreements WHERE hire_episode_id = ?`, [episode.id])?.m || 0) + 1;
    const [year, month, day] = startOn.split("-").map(Number);
    const plannedEnd = new Date(Date.UTC(year, month - 1, day + AGREEMENT_LENGTH_DAYS - 1)).toISOString().slice(0, 10);
    agreementId = newId("ag");
    run(
      `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note, rate_pence_per_day)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'signed', ?, ?)`,
      [
        agreementId,
        episode.id,
        sequence,
        startOn,
        plannedEnd,
        AGREEMENT_LENGTH_DAYS,
        AGREEMENT_ALERT_FROM_DAY,
        now,
        "New agreement signed for a vehicle swap. Signed date is when it was signed or filed. The earlier agreement is superseded and kept.",
        Number(episode.rate_pence_per_day) > 0 ? Number(episode.rate_pence_per_day) : null,
      ],
    );
    // The new agreement is now the file's agreement. A later version of it keeps its number.
    if (swap.agreement_number) run(`UPDATE claims SET hire_agreement_number = ? WHERE id = ?`, [swap.agreement_number, swap.claim_id]);
    const newNumber = swap.agreement_number ? ` ${swap.agreement_number}` : "";
    const oldNumber = swap.replaces_agreement_number ? ` ${swap.replaces_agreement_number}` : "";
    agreementWords = ` New hire agreement${newNumber} was signed on ${formatUkDate(now)}. The earlier agreement${oldNumber} is kept on the file, marked superseded. The renewal alerts now follow the new agreement (day ${AGREEMENT_ALERT_FROM_DAY} and day 88 from ${formatUkDate(startOn)}).`;
  } else if (input.overrideReason) {
    agreementWords = ` Completed without the new signed agreement, on Justin's override. Reason: ${input.overrideReason}. The renewal alerts still follow the earlier signed agreement.`;
  }
  run(
    `UPDATE hire_swaps SET status = 'completed', completed_at = ?, signed_document_id = ?, superseded_document_id = ?, agreement_id = ?, override_reason = ?, override_by = ? WHERE id = ?`,
    [now, input.signedDocumentId, superseded, agreementId, input.overrideReason, input.overrideReason ? input.actorId : null, swap.id],
  );
  recordClaimEvent({
    claimId: swap.claim_id,
    eventType: "hire_vehicle_changed",
    occurredAt: now,
    actorId: input.actorId || undefined,
    documentId: input.signedDocumentId || undefined,
    details: `Hire car changed from ${carLabel(swap.old_fleet_vehicle_id)} to ${carLabel(swap.new_fleet_vehicle_id)} (swap on ${formatUkDateTime(swap.swap_at)}). One continuous hire: the hire start date and day count do not change.${agreementWords}`,
    source: "staff",
  });
}

export type SwapView = {
  open: {
    newCar: string;
    oldCar: string;
    swapAt: string;
    agreementDocumentId: string | null;
  } | null;
  /** "Hire day 47 · current agreement day 12 (signed 18/11/2026)", once a later agreement has been signed. */
  agreementClock: string | null;
  history: Array<{ at: string; from: string; to: string; how: string }>;
};

/** For the Hire tab: a swap waiting for its signature, the two clocks, and past swaps. */
export function swapView(claimId: string, todayYmd: string): SwapView {
  ready();
  const swap = openSwap(claimId);
  const episode = runningEpisode(claimId);
  let agreementClock: string | null = null;
  if (episode && Number(episode.credit_hire) === 1) {
    const latest = get<{ start_on: string; signed_at: string | null; sequence: number }>(
      `SELECT start_on, signed_at, sequence FROM agreements WHERE hire_episode_id = ? AND signed = 1 ORDER BY sequence DESC LIMIT 1`,
      [episode.id],
    );
    if (latest && Number(latest.sequence) > 1) {
      const hireDay = agreementDayNumber(londonDateIso(new Date(episode.started_at)), todayYmd);
      const agreementDay = agreementDayNumber(String(latest.start_on), todayYmd);
      agreementClock = `Hire day ${hireDay} · current agreement day ${agreementDay} (signed ${formatUkDate(latest.signed_at || latest.start_on)})`;
    }
  }
  return {
    open: swap
      ? { newCar: carLabel(swap.new_fleet_vehicle_id), oldCar: carLabel(swap.old_fleet_vehicle_id), swapAt: swap.swap_at, agreementDocumentId: swap.agreement_document_id }
      : null,
    agreementClock,
    history: all<SwapRow>(`SELECT * FROM hire_swaps WHERE claim_id = ? AND status = 'completed' ORDER BY completed_at`, [claimId]).map((row) => ({
      at: row.swap_at,
      from: carLabel(row.old_fleet_vehicle_id),
      to: carLabel(row.new_fleet_vehicle_id),
      how: row.signed_document_id ? "new agreement signed" : row.override_reason ? `Justin's override: ${row.override_reason}` : "courtesy car, no agreement",
    })),
  };
}

export type SwapAgreementLine = { documentId: string; title: string; createdAt: string; state: string; awaiting: boolean; signed: boolean };

/**
 * Hire step 4: each replacement car's agreement on its own line with its own signature state (R29). The signature on
 * the earlier agreement is never shown against the new car.
 */
export function swapAgreementLines(claimId: string): SwapAgreementLine[] {
  ready();
  const rows = all<{
    agreement_document_id: string;
    status: string;
    signed_document_id: string | null;
    override_reason: string | null;
    completed_at: string | null;
    title: string | null;
    created_at: string;
  }>(
    `SELECT s.agreement_document_id, s.status, s.signed_document_id, s.override_reason, s.completed_at, d.title, d.created_at
     FROM hire_swaps s JOIN documents d ON d.id = s.agreement_document_id
     WHERE s.claim_id = ? ORDER BY d.created_at`,
    [claimId],
  );
  return rows.map((row) => {
    const signedBy = row.signed_document_id
      ? get<{ signer_name: string | null; signed_at: string | null }>(
          `SELECT signer_name, signed_at FROM esign_requests WHERE signed_document_id = ? LIMIT 1`,
          [row.signed_document_id],
        )
      : undefined;
    let state = "awaiting signature";
    if (row.status === "cancelled") state = "not used: the swap was cancelled";
    else if (row.signed_document_id && signedBy?.signer_name) state = `signed electronically by ${signedBy.signer_name} on ${formatUkDateTime(String(signedBy.signed_at))}`;
    else if (row.signed_document_id) state = `signed copy filed ${formatUkDateTime(String(row.completed_at))}`;
    else if (row.override_reason) state = `not signed: completed on Justin's override (${row.override_reason})`;
    return {
      documentId: String(row.agreement_document_id),
      title: String(row.title || "Hire agreement (replacement car)"),
      createdAt: String(row.created_at),
      state,
      awaiting: row.status === "awaiting_signature",
      signed: row.status === "completed" && Boolean(row.signed_document_id),
    };
  });
}

/** Days a completed swap happened, for the hire charge's "does not add a day" note. */
export function completedSwapDays(claimId: string): string[] {
  ready();
  return all<{ swap_at: string }>(`SELECT swap_at FROM hire_swaps WHERE claim_id = ? AND status = 'completed'`, [claimId]).map((row) =>
    londonDateIso(new Date(String(row.swap_at))),
  );
}

import { londonTodayIso, nowUtcIso } from "../dates";
import { recordClaimEvent } from "./chronology";
import { get, run } from "./connection";
import { noteFleetMileage, saveMissingFleetDetails, type FleetDetailField } from "./fleet-details";
import { FUEL_LEVELS } from "./handover";
import { generateHireAgreementDocument, HIRE_AGREEMENT_TEMPLATE_KEY } from "./hire-agreement";
import { currentHireEpisode, signedHireAgreementOnFile } from "./hire-readiness";
import { assertCanRecordHandover } from "./jobs";

export const TRANSMISSIONS = ["Manual", "Automatic"] as const;

/** What has to be on the file about the car and the driver before the client signs. */
export type BeforeSigning = {
  episodeId: string | null;
  fleetVehicleId: string | null;
  vehicleId: string | null;
  mileage: number | null;
  fuelLevel: string;
  transmission: string;
  licenceIssuedOn: string;
  started: boolean;
};

function text(value: unknown): string {
  const t = String(value ?? "").trim();
  return /^unknown$/i.test(t) ? "" : t;
}

export function beforeSigningFor(claimId: string): BeforeSigning {
  const row = get<{
    id: string | null;
    fleet_vehicle_id: string | null;
    vehicle_id: string | null;
    out_mileage: number | null;
    out_fuel_level: string | null;
    transmission: string | null;
    started_at: string | null;
  }>(
    `SELECT he.id, he.fleet_vehicle_id, fv.vehicle_id, he.out_mileage, he.out_fuel_level, v.transmission, he.started_at
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ? AND he.collection_at IS NULL AND he.billing_end_at IS NULL
     ORDER BY CASE WHEN he.fleet_vehicle_id IS NULL THEN 1 ELSE 0 END, he.started_at DESC
     LIMIT 1`,
    [claimId],
  );
  const person = get<{ licence_issued_on: string | null; pack_issued: string | null }>(
    `SELECT p.licence_issued_on, hp.licence_issued_on AS pack_issued
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id LEFT JOIN hire_pack_data hp ON hp.claim_id = c.id
     WHERE c.id = ?`,
    [claimId],
  );
  return {
    episodeId: row?.id || null,
    fleetVehicleId: row?.fleet_vehicle_id || null,
    vehicleId: row?.vehicle_id || null,
    mileage: row?.out_mileage == null ? null : Number(row.out_mileage),
    fuelLevel: text(row?.out_fuel_level),
    transmission: text(row?.transmission),
    licenceIssuedOn: text(person?.pack_issued) || text(person?.licence_issued_on),
    started: Boolean(row?.started_at),
  };
}

/**
 * Mileage and fuel out, and the licence date of issue when it is missing. Entered before the client signs, so the
 * signed agreement carries them. The gearbox is entered with the car's other missing details on the Choose a car step;
 * a gearbox sent here is still saved to the fleet record.
 */
export function saveBeforeSigning(input: {
  claimId: string;
  actorId: string;
  mileage: string;
  fuelLevel: string;
  transmission?: string;
  licenceIssuedOn?: string;
}) {
  const current = beforeSigningFor(input.claimId);
  if (!current.episodeId || !current.vehicleId) throw new Error("Choose the hire car first.");
  if (current.started) throw new Error("The car has already been handed over. The readings are on the handover.");
  const mileageText = input.mileage.replace(/[,\s]/g, "");
  if (!/^\d{1,7}$/.test(mileageText)) throw new Error("Enter the mileage out as a whole number.");
  const fuel = FUEL_LEVELS.find((level) => level.value === input.fuelLevel.trim());
  if (!fuel) throw new Error("Choose the fuel level out: Empty, ¼, ½, ¾ or Full.");
  const transmission = String(input.transmission || "").trim();
  if (transmission && !(TRANSMISSIONS as readonly string[]).includes(transmission)) throw new Error("Choose manual or automatic.");
  const issued = String(input.licenceIssuedOn || "").trim();
  if (issued && (!/^\d{4}-\d{2}-\d{2}$/.test(issued) || issued > londonTodayIso())) {
    throw new Error("Enter the licence date of issue. It cannot be after today.");
  }
  if (!current.licenceIssuedOn && !issued) throw new Error("Enter the licence date of issue (4a on the photocard).");
  run(`UPDATE hire_episodes SET out_mileage = ?, out_fuel_level = ? WHERE id = ?`, [Number(mileageText), fuel.value, current.episodeId]);
  if (current.fleetVehicleId) noteFleetMileage(current.fleetVehicleId, Number(mileageText));
  if (transmission) run(`UPDATE vehicles SET transmission = ? WHERE id = ?`, [transmission, current.vehicleId]);
  if (issued) {
    run(`UPDATE people SET licence_issued_on = ? WHERE id = (SELECT client_person_id FROM claims WHERE id = ?)`, [issued, input.claimId]);
  }
  const parts = [`Mileage out ${Number(mileageText).toLocaleString("en-GB")}`, `fuel out ${fuel.label}`];
  if (transmission) parts.push(`transmission ${transmission.toLowerCase()} (saved to the fleet record)`);
  if (issued) parts.push("licence date of issue");
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "hire_car_readings_recorded",
    occurredAt: nowUtcIso(),
    actorId: input.actorId,
    details: `Recorded before signing: ${parts.join(", ")}.`,
    source: "staff",
  });
}

/**
 * Save the readings and, when an agreement is already produced but not yet signed, produce a new version so the
 * client signs the agreement with these figures on it. Readings cannot change once the agreement is signed.
 * Office staff, or the driver on the delivery job, may do this.
 */
export function saveBeforeSigningAndRefresh(input: {
  claimId: string;
  actorId: string;
  actorRole: string;
  mileage: string;
  fuelLevel: string;
  transmission?: string;
  licenceIssuedOn?: string;
}): { reproduced: boolean } {
  assertCanRecordHandover({ id: input.actorId, role: input.actorRole }, input.claimId, currentHireEpisode(input.claimId)?.id || null);
  if (signedHireAgreementOnFile(input.claimId)) {
    throw new Error("The agreement is already signed with the readings on it. Record any difference on the handover.");
  }
  saveBeforeSigning(input);
  const produced = get<{ id: string }>(
    `SELECT id FROM documents WHERE claim_id = ? AND template_key = ? LIMIT 1`,
    [input.claimId, HIRE_AGREEMENT_TEMPLATE_KEY],
  );
  if (!produced) return { reproduced: false };
  generateHireAgreementDocument(input.claimId, input.actorId);
  return { reproduced: true };
}

function reproduceUnsignedAgreement(claimId: string, actorId: string): boolean {
  if (signedHireAgreementOnFile(claimId)) return false;
  const produced = get<{ id: string }>(`SELECT id FROM documents WHERE claim_id = ? AND template_key = ? LIMIT 1`, [claimId, HIRE_AGREEMENT_TEMPLATE_KEY]);
  if (!produced) return false;
  generateHireAgreementDocument(claimId, actorId);
  return true;
}

/**
 * Details missing on the chosen car's fleet record, entered on the Hire tab (R22). They are saved to the fleet record,
 * so the next hire of the car has them. An agreement produced but not yet signed is produced again with them on it.
 */
export function saveHireCarDetails(input: {
  claimId: string;
  actorId: string;
  actorRole: string;
  values: Partial<Record<FleetDetailField, string>>;
  expectedVersion?: string;
}): { saved: FleetDetailField[]; reproduced: boolean } {
  const episode = currentHireEpisode(input.claimId);
  if (!episode?.fleet_vehicle_id) throw new Error("Choose the hire car first.");
  assertCanRecordHandover({ id: input.actorId, role: input.actorRole }, input.claimId, String(episode.id));
  const result = saveMissingFleetDetails({
    fleetVehicleId: String(episode.fleet_vehicle_id),
    actorId: input.actorId,
    values: input.values,
    claimId: input.claimId,
    expectedVersion: input.expectedVersion,
  });
  const reproduced = result.saved.length > 0 && !episode.started_at && reproduceUnsignedAgreement(input.claimId, input.actorId);
  return { saved: result.saved, reproduced };
}

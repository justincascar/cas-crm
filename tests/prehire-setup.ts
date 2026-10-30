import { addImpecuniosityAccount } from "../src/lib/db/impecuniosity.ts";
import { get, run } from "../src/lib/db/connection.ts";
import { listHireDrivers, recordLicenceCheck } from "../src/lib/db/prehire-checks.ts";
import { londonTodayIso, nowUtcIso } from "../src/lib/dates.ts";

/** Fictional licence number for tests. Not a real licence. */
export const TEST_LICENCE_NUMBER = "TESTX901010AB9CD";

/** Records the two facts the hire-agreement gate requires. Not a bypass, and not used by the app. */
export function recordPassingPrehireChecks(claimId: string, actorId = "staff-sian") {
  const checkedOn = londonTodayIso();
  for (const driver of listHireDrivers(claimId)) {
    recordLicenceCheck({
      claimId,
      actorId,
      driverKey: driver.key,
      checkCode: "test-check-code",
      category: "B",
      endorsementCodes: "",
      licenceExpiresOn: "2032-01-01",
      checkedOn,
      licenceNumber: driver.licenceNumber ? undefined : TEST_LICENCE_NUMBER,
    });
  }
  addImpecuniosityAccount({
    claimId,
    actorId,
    label: "Test current account",
    kind: "bank_account",
  });
}

/**
 * Fills the mandatory agreement items a seeded file lacks: licence number and expiry, the reason a hire car is
 * needed, the group charged, and a stored daily rate on the hire. Fictional test values only.
 */
export function prepareAgreementItems(claimId: string, ratePence = 6653, group = "S3") {
  const claim = get<{ client_person_id: string | null }>(`SELECT client_person_id FROM claims WHERE id = ?`, [claimId]);
  if (claim?.client_person_id) {
    run(
      `UPDATE people SET
         licence_number = COALESCE(NULLIF(licence_number, ''), ?),
         licence_expires_on = COALESCE(NULLIF(licence_expires_on, ''), '2032-01-01'),
         date_of_birth = COALESCE(NULLIF(date_of_birth, ''), '1985-01-01'),
         licence_issued_on = COALESCE(NULLIF(licence_issued_on, ''), '2015-01-01')
       WHERE id = ?`,
      [TEST_LICENCE_NUMBER, claim.client_person_id],
    );
  }
  const pack = get<{ claim_id: string }>(`SELECT claim_id FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  if (!pack) run(`INSERT INTO hire_pack_data(claim_id, updated_at) VALUES (?, ?)`, [claimId, nowUtcIso()]);
  run(
    `UPDATE hire_pack_data SET
       need_reason = COALESCE(NULLIF(need_reason, ''), 'Own car cannot be driven and is needed for work.'),
       group_charged = COALESCE(NULLIF(group_charged, ''), ?)
     WHERE claim_id = ?`,
    [group, claimId],
  );
  run(
    `UPDATE hire_episodes SET rate_pence_per_day = ?, rate_taken_on = ?, rate_group = ?
     WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL AND (rate_pence_per_day IS NULL OR rate_pence_per_day <= 0)`,
    [ratePence, londonTodayIso(), group, claimId],
  );
  // Mileage and fuel out, and the car's transmission, are on the agreement the client signs.
  run(
    `UPDATE hire_episodes SET out_mileage = COALESCE(out_mileage, 12000), out_fuel_level = COALESCE(NULLIF(out_fuel_level, ''), 'full')
     WHERE claim_id = ? AND fleet_vehicle_id IS NOT NULL AND started_at IS NULL`,
    [claimId],
  );
  run(
    // Fuel, seats, colour and the supplied car's GTA group print on the agreement too (R22). Test fleet values only.
    `UPDATE vehicles SET transmission = COALESCE(NULLIF(trim(transmission), ''), 'Manual'),
            fuel = COALESCE(NULLIF(trim(fuel), ''), 'Petrol'),
            seats = COALESCE(seats, 5),
            colour = COALESCE(NULLIF(trim(colour), ''), 'Grey'),
            gta_group = COALESCE(NULLIF(trim(gta_group), ''), 'S3')
     WHERE id IN (
       SELECT fv.vehicle_id FROM hire_episodes he JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id WHERE he.claim_id = ?)`,
    [claimId],
  );
}

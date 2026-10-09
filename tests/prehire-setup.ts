import { addImpecuniosityAccount } from "../src/lib/db/impecuniosity.ts";
import { listHireDrivers, recordLicenceCheck } from "../src/lib/db/prehire-checks.ts";
import { londonTodayIso } from "../src/lib/dates.ts";

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
      pointsEndorsements: "None shown",
      licenceExpiresOn: "2032-01-01",
      checkedOn,
    });
  }
  addImpecuniosityAccount({
    claimId,
    actorId,
    label: "Test current account",
    kind: "bank_account",
  });
}

import { canOverridePreHireChecks } from "../auth/roles";
import { londonTodayIso, nowUtcIso } from "../dates";
import {
  hireAgreementRefusal,
  isPrehireCheckKind,
  type NamedHireDriver,
  type PrehireCheckKind,
} from "../domain/prehire-checks";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { listFinancialCircumstances, listImpecuniosityAccounts } from "./impecuniosity";
import { migrate } from "./migrate";
import { listStaffPermissions } from "./permissions";

let licenceTableReady = false;

/** The dev server keeps its database connection open. Creating the table here covers that process without a restart. */
function ensureLicenceTable() {
  if (licenceTableReady) return;
  migrate(getDb());
  licenceTableReady = true;
}

export type HireDriver = NamedHireDriver & {
  basis: string;
};

export type LicenceCheckRow = {
  id: string;
  claim_id: string;
  driver_key: string;
  driver_name: string;
  check_code: string;
  category: string;
  points_endorsements: string;
  licence_expires_on: string;
  checked_on: string;
  recorded_at: string;
  recorded_by_name: string | null;
};

export type BankStatementPosition = {
  bankAccounts: Array<{ id: string; label: string }>;
  noBankExplanation: string;
  satisfied: boolean;
};

function normName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanName(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

function requireYmd(value: string, label: string): string {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Enter ${label} as a date.`);
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Enter ${label} as a real calendar date.`);
  }
  return text;
}

function requireText(value: string, message: string): string {
  const text = value.trim();
  if (!text) throw new Error(message);
  if (text.length > 200) throw new Error("That entry is too long. Keep it to what the check showed.");
  return text;
}

function screenValues(claimId: string, screenKey: string): Record<string, string> {
  const row = get<{ data_json: string }>(
    `SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`,
    [claimId, screenKey],
  );
  if (!row?.data_json) return {};
  try {
    const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * People who will drive the hire vehicle.
 * Party role "driver" is the person recorded as a driver.
 * Client driver details, the hire-pack additional driver, and Additional drivers 1 and 2 are named drivers.
 * Owner, hirer, keeper, witness and third party are not included unless they are also one of those.
 * If none of those are recorded, the client is treated as the person who will drive.
 */
export function listHireDrivers(claimId: string): HireDriver[] {
  const parties = all<{ person_id: string; role: string; full_name: string }>(
    `SELECT cp.person_id, cp.role, p.full_name
     FROM claim_parties cp
     JOIN people p ON p.id = cp.person_id
     WHERE cp.claim_id = ?
     ORDER BY p.full_name, cp.role`,
    [claimId],
  );
  const client = get<{ person_id: string; full_name: string }>(
    `SELECT p.id AS person_id, p.full_name
     FROM claims c
     JOIN people p ON p.id = c.client_person_id
     WHERE c.id = ?`,
    [claimId],
  );

  const drivers: HireDriver[] = [];
  const seenNames = new Set<string>();
  const seenKeys = new Set<string>();

  function push(driver: HireDriver) {
    const name = cleanName(driver.name);
    const norm = normName(name);
    if (!name || norm === "unknown" || seenKeys.has(driver.key) || seenNames.has(norm)) return;
    seenKeys.add(driver.key);
    seenNames.add(norm);
    drivers.push({ ...driver, name });
  }

  for (const row of parties) {
    if (row.role !== "driver") continue;
    push({
      key: `person:${row.person_id}`,
      name: row.full_name,
      basis: "Recorded on the file as a driver.",
    });
  }

  function considerNamed(name: string, basis: string) {
    const trimmed = cleanName(name);
    const norm = normName(trimmed);
    if (!trimmed || norm === "unknown" || seenNames.has(norm)) return;
    const key = client && normName(client.full_name) === norm ? `person:${client.person_id}` : `named:${norm}`;
    push({ key, name: trimmed, basis });
  }

  const driverScreen = screenValues(claimId, "driver");
  considerNamed(
    [driverScreen.title, driverScreen.forename, driverScreen.surname].filter(Boolean).join(" "),
    "Named on Client driver details.",
  );

  const pack = get<{ additional_name: string | null }>(
    `SELECT additional_name FROM hire_pack_data WHERE claim_id = ?`,
    [claimId],
  );
  considerNamed(String(pack?.additional_name || ""), "Named as the additional driver on the hire pack.");

  const extras = screenValues(claimId, "additional-drivers");
  considerNamed(extras.d1Name || "", "Named as additional driver 1.");
  considerNamed(extras.d2Name || "", "Named as additional driver 2.");

  if (drivers.length === 0 && client) {
    push({
      key: `person:${client.person_id}`,
      name: client.full_name,
      basis: "No separate driver is recorded, so the client is treated as the person who will use the hire vehicle.",
    });
  }

  return drivers;
}

export function listLicenceChecks(claimId: string): LicenceCheckRow[] {
  ensureLicenceTable();
  return all<LicenceCheckRow>(
    `SELECT l.id, l.claim_id, l.driver_key, l.driver_name, l.check_code, l.category, l.points_endorsements,
            l.licence_expires_on, l.checked_on, l.recorded_at, s.name AS recorded_by_name
     FROM licence_checks l
     LEFT JOIN staff s ON s.id = l.recorded_by
     WHERE l.claim_id = ?
     ORDER BY l.recorded_at DESC, l.rowid DESC`,
    [claimId],
  );
}

export function recordLicenceCheck(input: {
  claimId: string;
  actorId: string;
  driverKey: string;
  checkCode: string;
  category: string;
  pointsEndorsements: string;
  licenceExpiresOn: string;
  checkedOn: string;
}): { id: string; driverName: string } {
  ensureLicenceTable();
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const driver = listHireDrivers(input.claimId).find((item) => item.key === input.driverKey);
  if (!driver) throw new Error("That person is not recorded as someone who will drive the hire vehicle.");
  const checkedOn = requireYmd(input.checkedOn, "the date the check was done");
  if (checkedOn > londonTodayIso()) throw new Error("The date of the check cannot be after today.");
  const id = newId("lic");
  run(
    `INSERT INTO licence_checks(
       id, claim_id, driver_key, driver_name, check_code, category, points_endorsements,
       licence_expires_on, checked_on, recorded_by, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      driver.key,
      driver.name,
      requireText(input.checkCode, "Enter the DVLA check code from the gov.uk page."),
      requireText(input.category, "Enter the categories the check showed."),
      requireText(input.pointsEndorsements, "Enter the points and endorsements the check showed. If none were shown, say so."),
      requireYmd(input.licenceExpiresOn, "the licence expiry the check showed"),
      checkedOn,
      input.actorId,
      nowUtcIso(),
    ],
  );
  return { id, driverName: driver.name };
}

/**
 * A listed bank account satisfies this. So does the latest saved no-bank explanation.
 * Wage slips and other evidence kinds do not. An uploaded file is not labelled as a bank statement, so it does not.
 * Checklist Complete and impecuniosity approval are not consulted.
 */
export function bankStatementPosition(claimId: string): BankStatementPosition {
  const bankAccounts = listImpecuniosityAccounts(claimId)
    .filter((row) => row.kind === "bank_account")
    .map((row) => ({ id: row.id, label: row.label }));
  const noBankExplanation = (listFinancialCircumstances(claimId).at(-1)?.no_bank_explanation || "").trim();
  return {
    bankAccounts,
    noBankExplanation,
    satisfied: bankAccounts.length > 0 || noBankExplanation.length > 0,
  };
}

export type PrehireOverrideRow = {
  id: string;
  claim_id: string;
  check_kind: string;
  reason: string;
  recorded_at: string;
  recorded_by_name: string | null;
};

/** Every override recorded on this claim, oldest first. Rows are not removed when evidence is added later. */
export function listPrehireOverrides(claimId: string): PrehireOverrideRow[] {
  ensureLicenceTable();
  return all<PrehireOverrideRow>(
    `SELECT o.id, o.claim_id, o.check_kind, o.reason, o.recorded_at, s.name AS recorded_by_name
     FROM prehire_overrides o
     LEFT JOIN staff s ON s.id = o.recorded_by
     WHERE o.claim_id = ?
     ORDER BY o.recorded_at ASC, o.rowid ASC`,
    [claimId],
  );
}

export function prehireCheckOverridden(claimId: string, checkKind: PrehireCheckKind): boolean {
  return listPrehireOverrides(claimId).some((row) => row.check_kind === checkKind);
}

function licenceEvidenceMissing(claimId: string): boolean {
  const drivers = listHireDrivers(claimId);
  if (drivers.length === 0) return true;
  const checked = new Set(listLicenceChecks(claimId).map((row) => row.driver_key));
  return drivers.some((driver) => !checked.has(driver.key));
}

/**
 * Records one check's override on this claim. The other check is untouched.
 * Permission is read from staff_permissions for actorId. Role is loaded and not treated as a grant.
 */
export function recordPrehireOverride(input: {
  claimId: string;
  actorId: string;
  checkKind: string;
  reason: string;
}): { id: string; checkKind: PrehireCheckKind; reason: string } {
  ensureLicenceTable();
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const staff = get<{ role: string }>(`SELECT role FROM staff WHERE id = ? AND active = 1`, [input.actorId]);
  const permissions = staff ? listStaffPermissions(input.actorId) : [];
  if (!staff || !canOverridePreHireChecks({ role: staff.role, permissions })) {
    throw new Error("You do not have permission to override a pre-hire check. The administrator role does not include this.");
  }
  if (!isPrehireCheckKind(input.checkKind)) {
    throw new Error("Choose the licence check or the bank-statement check.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter a reason. An override is not saved without one.");
  if (reason.length > 1000) throw new Error("Keep the reason to a short explanation of why this check is being overridden.");
  if (input.checkKind === "licence" && !licenceEvidenceMissing(input.claimId)) {
    throw new Error("A licence check is already recorded for everyone who will drive. An override was not saved.");
  }
  if (input.checkKind === "bank" && bankStatementPosition(input.claimId).satisfied) {
    throw new Error("Bank-statement evidence is already on this file. An override was not saved.");
  }
  const id = newId("override");
  const recordedAt = nowUtcIso();
  run(
    `INSERT INTO prehire_overrides(id, claim_id, check_kind, reason, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.claimId, input.checkKind, reason, input.actorId, recordedAt],
  );
  const which = input.checkKind === "licence" ? "Licence check" : "Bank-statement evidence";
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: recordedAt,
    details: `${which} overridden on this file. Reason: ${reason}`,
    actorId: input.actorId,
    source: "staff",
  });
  return { id, checkKind: input.checkKind, reason };
}

/**
 * Refusal text, or null when both checks are satisfied or overridden on this claim.
 * There is no bypass argument. Stored overrides are read for this claim only.
 * The caller's role is not consulted.
 */
export function hireAgreementPrehireBlock(claimId: string): string | null {
  const drivers = listHireDrivers(claimId);
  const checked = new Set(listLicenceChecks(claimId).map((row) => row.driver_key));
  const missing = drivers.filter((driver) => !checked.has(driver.key)).map((driver) => driver.name);
  return hireAgreementRefusal({
    missingDriverNames: missing,
    driverRecorded: drivers.length > 0,
    bankSatisfied: bankStatementPosition(claimId).satisfied,
    licenceOverridden: prehireCheckOverridden(claimId, "licence"),
    bankOverridden: prehireCheckOverridden(claimId, "bank"),
  });
}

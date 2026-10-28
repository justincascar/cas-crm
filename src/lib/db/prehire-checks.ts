import { canOverridePreHireChecks, isOfficeRole } from "../auth/roles";
import { formatUkDate, londonTodayIso, nowUtcIso } from "../dates";
import {
  hireAgreementRefusal,
  hireCheckAnchor,
  isPrehireCheckKind,
  licenceCheckIsStale,
  latestLicenceCheck,
  type HireGap,
  type NamedHireDriver,
  type PrehireCheckKind,
} from "../domain/prehire-checks";
import { MAX_CLAIM_DOCUMENT_BYTES, claimDocumentMime } from "../domain/claim-documents";
import { recordClaimEvent } from "./chronology";
import { all, get, getDb, newId, run } from "./connection";
import { storeClaimDocument, type ClaimDocumentFile } from "./claim-documents";
import { listFinancialCircumstances, listImpecuniosityAccounts, saveFinancialCircumstances } from "./impecuniosity";
import { licenceCheckWindowDays } from "./licence-window";
import { migrate } from "./migrate";
import { listStaffPermissions } from "./permissions";
import { replaySubmit, requireSubmitKey, storeSubmit } from "./submit-key";

let licenceTableReady = false;

/** The dev server keeps its database connection open. Creating the table here covers that process without a restart. */
function ensureLicenceTable() {
  if (licenceTableReady) return;
  migrate(getDb());
  licenceTableReady = true;
}

export type HireDriver = NamedHireDriver & {
  basis: string;
  licenceNumber: string;
  licenceHref: string;
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
  result: string;
  notes: string;
  penalty_points: number;
  document_id: string | null;
};

export type StoredBankStatement = {
  id: string;
  title: string;
  createdAt: string;
  period: string;
};

export type BankStatementPosition = {
  bankAccounts: Array<{ id: string; label: string }>;
  statements: StoredBankStatement[];
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

  const drivers: Array<NamedHireDriver & { basis: string }> = [];
  const seenNames = new Set<string>();
  const seenKeys = new Set<string>();

  function push(driver: NamedHireDriver & { basis: string }) {
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

  return drivers.map((driver) => ({ ...driver, ...licencePlacement(claimId, driver, client?.person_id || "") }));
}

function licencePlacement(claimId: string, driver: NamedHireDriver, clientPersonId: string): { licenceNumber: string; licenceHref: string } {
  const base = `/claims/${claimId}`;
  if (driver.key.startsWith("person:")) {
    const personId = driver.key.slice("person:".length);
    const row = get<{ licence_number: string | null }>(`SELECT licence_number FROM people WHERE id = ?`, [personId]);
    return {
      licenceNumber: String(row?.licence_number || "").trim(),
      licenceHref: personId === clientPersonId ? `${base}/details/client` : `${base}/details/driver`,
    };
  }
  const extras = screenValues(claimId, "additional-drivers");
  const norm = normName(driver.name);
  if (normName(extras.d1Name || "") === norm) {
    return { licenceNumber: String(extras.d1LicenceNumber || "").trim(), licenceHref: `${base}/details/additional-drivers` };
  }
  if (normName(extras.d2Name || "") === norm) {
    return { licenceNumber: String(extras.d2LicenceNumber || "").trim(), licenceHref: `${base}/details/additional-drivers` };
  }
  const pack = get<{ additional_name: string | null; additional_licence: string | null }>(
    `SELECT additional_name, additional_licence FROM hire_pack_data WHERE claim_id = ?`,
    [claimId],
  );
  if (normName(String(pack?.additional_name || "")) === norm) {
    return { licenceNumber: String(pack?.additional_licence || "").trim(), licenceHref: `${base}/details/additional-drivers` };
  }
  return { licenceNumber: "", licenceHref: `${base}/details/additional-drivers` };
}

/** Licence numbers are kept without spaces, in capitals. The format is not guessed beyond that. */
export function cleanLicenceNumber(value: string): string {
  const text = value.replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  if (!/^[A-Z0-9]{5,20}$/.test(text)) throw new Error("Enter the licence number as it is printed on the licence, letters and numbers only.");
  return text;
}

/**
 * Saves a licence number to the person's own record, so it is entered once and used everywhere:
 * the client or driver record, Additional drivers, or the hire pack's additional driver.
 */
export function saveDriverLicenceNumber(claimId: string, driver: HireDriver, licenceNumber: string): void {
  const number = cleanLicenceNumber(licenceNumber);
  if (!number) return;
  if (driver.key.startsWith("person:")) {
    run(`UPDATE people SET licence_number = ? WHERE id = ?`, [number, driver.key.slice("person:".length)]);
    return;
  }
  const norm = normName(driver.name);
  const extras = get<{ data_json: string }>(
    `SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = 'additional-drivers'`,
    [claimId],
  );
  if (extras?.data_json) {
    const values = JSON.parse(extras.data_json) as Record<string, unknown>;
    const slot = normName(String(values.d1Name || "")) === norm ? "d1" : normName(String(values.d2Name || "")) === norm ? "d2" : null;
    if (slot) {
      values[`${slot}LicenceNumber`] = number;
      run(`UPDATE claim_screen_data SET data_json = ?, updated_at = ? WHERE claim_id = ? AND screen_key = 'additional-drivers'`, [
        JSON.stringify(values),
        nowUtcIso(),
        claimId,
      ]);
      return;
    }
  }
  run(`UPDATE hire_pack_data SET additional_licence = ? WHERE claim_id = ? AND lower(trim(additional_name)) = ?`, [number, claimId, norm]);
}

export function listLicenceChecks(claimId: string): LicenceCheckRow[] {
  ensureLicenceTable();
  return all<LicenceCheckRow>(
    `SELECT l.id, l.claim_id, l.driver_key, l.driver_name, l.check_code, l.category, l.points_endorsements,
            l.licence_expires_on, l.checked_on, l.recorded_at, s.name AS recorded_by_name,
            COALESCE(l.result, 'ok') AS result, COALESCE(l.notes, '') AS notes,
            COALESCE(l.penalty_points, 0) AS penalty_points, l.document_id
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
  checkCode?: string;
  category: string;
  pointsEndorsements?: string;
  penaltyPoints?: number;
  licenceExpiresOn: string;
  checkedOn: string;
  result?: string;
  notes?: string;
  documentId?: string | null;
  /** Typed on the check card when the person's record has none. Saved to that record. */
  licenceNumber?: string;
}): { id: string; driverName: string; result: "ok" | "problem" } {
  ensureLicenceTable();
  const claim = get<{ id: string }>(`SELECT id FROM claims WHERE id = ?`, [input.claimId]);
  if (!claim) throw new Error("File not found.");
  const driver = listHireDrivers(input.claimId).find((item) => item.key === input.driverKey);
  if (!driver) throw new Error("That person is not recorded as someone who will drive the hire vehicle.");
  const checkedOn = requireYmd(input.checkedOn, "the date the check was done");
  if (checkedOn > londonTodayIso()) throw new Error("The date of the check cannot be after today.");
  const result = input.result === "problem" ? "problem" : "ok";
  const typedNumber = cleanLicenceNumber(String(input.licenceNumber || ""));
  if (result === "ok" && !driver.licenceNumber && !typedNumber) {
    throw new Error(`Enter ${driver.name}'s licence number. The check cannot be saved as OK to drive without it.`);
  }
  if (typedNumber && typedNumber !== driver.licenceNumber) saveDriverLicenceNumber(input.claimId, driver, typedNumber);
  const expiry = requireYmd(input.licenceExpiresOn, "the licence expiry the check showed");
  if (driver.key.startsWith("person:")) {
    run(`UPDATE people SET licence_expires_on = ? WHERE id = ? AND (licence_expires_on IS NULL OR trim(licence_expires_on) = '')`, [
      expiry,
      driver.key.slice("person:".length),
    ]);
  }
  const points =
    input.pointsEndorsements != null && input.pointsEndorsements.trim()
      ? requireText(input.pointsEndorsements, "Enter the penalty points.")
      : String(normalPoints(input.penaltyPoints));
  const code = String(input.checkCode || "").trim();
  if (code.length > 200) throw new Error("That entry is too long. Keep it to what the check showed.");
  const notes = (input.notes || "").trim();
  if (notes.length > 1000) throw new Error("Keep the notes short.");
  const id = newId("lic");
  run(
    `INSERT INTO licence_checks(
       id, claim_id, driver_key, driver_name, check_code, category, points_endorsements,
       licence_expires_on, checked_on, recorded_by, recorded_at, result, notes, penalty_points, document_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.claimId,
      driver.key,
      driver.name,
      code,
      requireText(input.category, "Enter the categories the check showed."),
      points,
      expiry,
      checkedOn,
      input.actorId,
      nowUtcIso(),
      result,
      notes,
      normalPoints(input.penaltyPoints ?? (Number(points) || 0)),
      input.documentId || null,
    ],
  );
  return { id, driverName: driver.name, result };
}

function normalPoints(value: number | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error("Enter penalty points as a whole number from 0.");
  return n;
}

export function listStoredBankStatements(claimId: string): StoredBankStatement[] {
  return all<{ id: string; title: string | null; created_at: string; statement_period: string | null }>(
    `SELECT id, title, created_at, statement_period FROM documents
     WHERE claim_id = ? AND document_type = 'bank_statements'
     ORDER BY created_at ASC, rowid ASC`,
    [claimId],
  ).map((row) => ({
    id: String(row.id),
    title: String(row.title || "Bank statement"),
    createdAt: String(row.created_at),
    period: String(row.statement_period || "").trim(),
  }));
}

/**
 * A stored bank statement, a listed bank account, or the latest no-bank explanation satisfies this.
 * Wage slips do not. Checklist Complete and impecuniosity approval are not consulted.
 */
export function bankStatementPosition(claimId: string): BankStatementPosition {
  const bankAccounts = listImpecuniosityAccounts(claimId)
    .filter((row) => row.kind === "bank_account")
    .map((row) => ({ id: row.id, label: row.label }));
  const statements = listStoredBankStatements(claimId);
  const noBankExplanation = (listFinancialCircumstances(claimId).at(-1)?.no_bank_explanation || "").trim();
  return {
    bankAccounts,
    statements,
    noBankExplanation,
    satisfied: statements.length > 0 || bankAccounts.length > 0 || noBankExplanation.length > 0,
  };
}

export function recordNoBankExplanation(input: { claimId: string; actorId: string; explanation: string }): string {
  const explanation = input.explanation.trim();
  if (!explanation) throw new Error("Say why the client has no bank account.");
  if (explanation.length > 1000) throw new Error("Keep the explanation short.");
  const previous = listFinancialCircumstances(input.claimId);
  const last = previous.at(-1);
  return saveFinancialCircumstances({
    claimId: input.claimId,
    actorId: input.actorId,
    employmentStatus: last?.employment_status || "not_stated",
    employmentWords: last?.employment_words || "",
    incomeAsStated: last?.income_as_stated || "",
    benefitsAsStated: last?.benefits_as_stated || "",
    abilityToPay: last?.ability_to_pay || "not_answered",
    abilityToPayWords: last?.ability_to_pay_words || "",
    noBankExplanation: explanation,
    correctionReason: previous.length > 0 ? "Recorded on the Hire tab." : undefined,
  });
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

function licenceEvidenceMissing(claimId: string, asAtYmd = londonTodayIso()): boolean {
  const names = licenceGapNames(claimId, asAtYmd);
  return !names.recorded || names.missing.length > 0 || names.problem.length > 0 || names.stale.length > 0;
}

function licenceGapNames(claimId: string, asAtYmd: string): {
  missing: string[];
  problem: string[];
  stale: string[];
  recorded: boolean;
} {
  const drivers = listHireDrivers(claimId);
  const checks = listLicenceChecks(claimId).map((row) => ({
    driverKey: row.driver_key,
    checkedOn: row.checked_on,
    recordedAt: row.recorded_at,
    result: row.result,
  }));
  const windowDays = licenceCheckWindowDays();
  const missing: string[] = [];
  const problem: string[] = [];
  const stale: string[] = [];
  for (const driver of drivers) {
    const latest = latestLicenceCheck(checks, driver.key);
    if (!latest) missing.push(driver.name);
    else if (latest.result === "problem") problem.push(driver.name);
    else if (licenceCheckIsStale(latest.checkedOn, asAtYmd, windowDays)) stale.push(driver.name);
  }
  return { missing, problem, stale, recorded: drivers.length > 0 };
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
export function listHireGaps(claimId: string, asAtYmd = londonTodayIso()): HireGap[] {
  const claim = get<{ claim_type: string }>(`SELECT claim_type FROM claims WHERE id = ?`, [claimId]);
  const creditHire = String(claim?.claim_type || "") !== "fault";
  const names = licenceGapNames(claimId, asAtYmd);
  const licenceOverridden = prehireCheckOverridden(claimId, "licence");
  const bankOverridden = prehireCheckOverridden(claimId, "bank");
  const gaps: HireGap[] = [];
  if (!licenceOverridden) {
    if (!names.recorded) {
      gaps.push({
        key: "driver",
        kind: "driver",
        label: "Somebody who will drive",
        href: `/claims/${claimId}/details/client`,
      });
    }
    for (const name of names.missing) {
      gaps.push({ key: `missing:${name}`, kind: "licence", label: `Licence check for ${name}`, href: "#checks" });
    }
    for (const name of names.problem) {
      gaps.push({ key: `problem:${name}`, kind: "problem", label: `Licence check for ${name} found a problem`, href: "#checks" });
    }
    for (const name of names.stale) {
      gaps.push({
        key: `stale:${name}`,
        kind: "stale",
        label: `Licence check is older than ${licenceCheckWindowDays()} days — please recheck (${name})`,
        href: "#checks",
      });
    }
  }
  if (creditHire && !bankOverridden && !bankStatementPosition(claimId).satisfied) {
    gaps.push({ key: "bank", kind: "bank", label: "Bank statements", href: "#bank" });
  }
  return gaps;
}

export function hireAgreementPrehireBlock(
  claimId: string,
  options: { asAtYmd?: string; purpose?: "agreement" | "handover" } = {},
): string | null {
  const claim = get<{ claim_type: string }>(`SELECT claim_type FROM claims WHERE id = ?`, [claimId]);
  const asAtYmd = options.asAtYmd && /^\d{4}-\d{2}-\d{2}$/.test(options.asAtYmd) ? options.asAtYmd : londonTodayIso();
  const names = licenceGapNames(claimId, asAtYmd);
  return hireAgreementRefusal({
    missingDriverNames: names.missing,
    problemDriverNames: names.problem,
    staleDriverNames: names.stale,
    driverRecorded: names.recorded,
    bankSatisfied: bankStatementPosition(claimId).satisfied,
    licenceOverridden: prehireCheckOverridden(claimId, "licence"),
    bankOverridden: prehireCheckOverridden(claimId, "bank"),
    requireBank: String(claim?.claim_type || "") !== "fault",
    windowDays: licenceCheckWindowDays(),
    purpose: options.purpose,
  });
}

export function waitingForChecks(gaps: HireGap[]): string {
  const parts: string[] = [];
  if (gaps.some((gap) => gap.kind === "licence" || gap.kind === "problem" || gap.kind === "stale" || gap.kind === "driver")) {
    parts.push("licence check");
  }
  if (gaps.some((gap) => gap.kind === "bank")) parts.push("bank statements");
  return parts.join(", ");
}

export function storeHireBankStatement(input: {
  claimId: string;
  actorId: string;
  actorRole: string;
  clientName: string;
  period?: string;
  submitKey: string;
  file: ClaimDocumentFile;
}): { id: string } {
  const key = requireSubmitKey(input.submitKey);
  const prior = replaySubmit<{ id: string }>(key);
  if (prior?.id) return prior;
  if (!isOfficeRole(input.actorRole)) throw new Error("You cannot store documents on a file.");
  const period = (input.period || "").trim();
  if (period.length > 80) throw new Error("Keep the statement period short.");
  readUpload(input.file);
  const stored = storeClaimDocument({
    claimId: input.claimId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    documentType: "bank_statements",
    file: input.file,
    title: `Bank statement – ${input.clientName || "Client"} – ${formatUkDate(nowUtcIso())}`,
    statementPeriod: period,
  });
  storeSubmit(key, { id: stored.id });
  return { id: stored.id };
}

export function readUpload(file: ClaimDocumentFile): void {
  const filename = (file.filename || "").trim() || "document";
  if (!file.buffer || file.buffer.length < 1) throw new Error("Choose a file to store.");
  if (file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  claimDocumentMime(filename, file.mimeType);
}

export { hireCheckAnchor };

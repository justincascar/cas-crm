import { canOverridePreHireChecks } from "../auth/roles";
import { claimDocumentMime, MAX_CLAIM_DOCUMENT_BYTES } from "../domain/claim-documents";
import { settingsGtaGroup } from "./gta-rates";
import { formatUkDate, londonDateIso, nowUtcIso } from "../dates";
import { formatGbp } from "../money";
import { storeFileCopy } from "../storage/files";
import { AGREEMENT_LENGTH_DAYS, AGREEMENT_ALERT_FROM_DAY } from "../constants";
import { recordClaimEvent } from "./chronology";
import { all, get, newId, run } from "./connection";
import { insertStoredDocument } from "./documents-store";
import { latestMitigationForPack } from "./impecuniosity";
import { listStaffPermissions } from "./permissions";
import { hireAgreementPrehireBlock } from "./prehire-checks";
import { beforeSigningFor } from "./hire-out-readings";

export const SIGNED_HIRE_AGREEMENT_TYPE = "signed_hire_agreement";
export const SIGNED_AGREEMENT_OVERRIDE = "signed_agreement";

export type HireGapLink = { key: string; label: string; href: string };

function present(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^unknown$/i.test(text);
}

type EpisodeFacts = {
  id: string;
  fleet_vehicle_id: string | null;
  started_at: string | null;
  rate_pence_per_day: number | null;
  rate_taken_on: string | null;
  rate_group: string | null;
  credit_hire: number;
  make: string | null;
  model: string | null;
  registration: string | null;
};

/** The hire this file is working on now: an open one first, then one not yet handed over. */
export function currentHireEpisode(claimId: string): EpisodeFacts | undefined {
  return get<EpisodeFacts>(
    `SELECT he.id, he.fleet_vehicle_id, he.started_at, he.rate_pence_per_day, he.rate_taken_on, he.rate_group, he.credit_hire,
            v.make, v.model, v.registration
     FROM hire_episodes he
     LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
     LEFT JOIN vehicles v ON v.id = fv.vehicle_id
     WHERE he.claim_id = ?
     ORDER BY CASE WHEN he.collection_at IS NULL AND he.billing_end_at IS NULL THEN 0 ELSE 1 END,
              CASE WHEN he.fleet_vehicle_id IS NULL THEN 1 ELSE 0 END,
              CASE WHEN he.started_at IS NULL THEN 0 ELSE 1 END,
              he.started_at DESC
     LIMIT 1`,
    [claimId],
  );
}

/** Group charged on this file: the pack's group, otherwise the client's own vehicle group. */
export function groupChargedFor(claimId: string): string | null {
  const row = get<{ group_charged: string | null; client_group: string | null }>(
    `SELECT hp.group_charged, v.gta_group AS client_group
     FROM claims c
     LEFT JOIN hire_pack_data hp ON hp.claim_id = c.id
     LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
     WHERE c.id = ?`,
    [claimId],
  );
  return settingsGtaGroup(row?.group_charged) || settingsGtaGroup(row?.client_group);
}

export function needReasonFor(claimId: string): string {
  const pack = get<{ need_reason: string | null }>(`SELECT need_reason FROM hire_pack_data WHERE claim_id = ?`, [claimId]);
  const fromPack = String(pack?.need_reason || "").trim();
  if (fromPack) return fromPack;
  return String(latestMitigationForPack(claimId)?.need_reason || "").trim();
}

/** Licence expiry for the client: the client record, the pack, then the latest licence check. */
export function clientLicenceExpiry(claimId: string): string {
  const row = get<{ person_id: string | null; person_expiry: string | null; pack_expiry: string | null }>(
    `SELECT p.id AS person_id, p.licence_expires_on AS person_expiry, hp.licence_expires_on AS pack_expiry
     FROM claims c
     LEFT JOIN people p ON p.id = c.client_person_id
     LEFT JOIN hire_pack_data hp ON hp.claim_id = c.id
     WHERE c.id = ?`,
    [claimId],
  );
  if (present(row?.person_expiry)) return String(row?.person_expiry);
  if (present(row?.pack_expiry)) return String(row?.pack_expiry);
  if (!row?.person_id) return "";
  const check = get<{ licence_expires_on: string | null }>(
    `SELECT licence_expires_on FROM licence_checks WHERE claim_id = ? AND driver_key = ? ORDER BY recorded_at DESC LIMIT 1`,
    [claimId, `person:${row.person_id}`],
  );
  return present(check?.licence_expires_on) ? String(check?.licence_expires_on) : "";
}

export function plannedHandoverAt(claimId: string): string | null {
  const job = get<{ planned_at: string | null }>(
    `SELECT planned_at FROM day_assignments
     WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
  if (job?.planned_at) return String(job.planned_at);
  const reservation = get<{ start_at: string }>(
    `SELECT start_at FROM reservations WHERE claim_id = ? AND status IN ('reserved', 'active') ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
  return reservation?.start_at ? String(reservation.start_at) : null;
}

/**
 * Items the final hire agreement cannot be produced without, each with the place to fix it.
 * Plain words only. The pre-hire checks are listed separately by listHireGaps.
 */
export function agreementMandatoryGaps(claimId: string): HireGapLink[] {
  const claim = get<{
    full_name: string | null;
    address_line1: string | null;
    postcode: string | null;
    date_of_birth: string | null;
    licence_number: string | null;
  }>(
    `SELECT p.full_name, p.address_line1, p.postcode, p.date_of_birth, p.licence_number
     FROM claims c LEFT JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
    [claimId],
  );
  const base = `/claims/${claimId}`;
  const gaps: HireGapLink[] = [];
  const add = (key: string, label: string, href: string) => gaps.push({ key, label, href });
  if (!present(claim?.full_name)) add("hirer-name", "Hirer's name", `${base}/details/client`);
  if (!present(claim?.address_line1) || !present(claim?.postcode)) add("hirer-address", "Hirer's address", `${base}/details/client`);
  if (!present(claim?.date_of_birth)) add("hirer-dob", "Date of birth", `${base}/details/client`);
  if (!present(claim?.licence_number)) add("licence-number", "Licence number", `${base}/hire#checks`);
  if (!present(clientLicenceExpiry(claimId))) add("licence-expiry", "Licence expiry date", `${base}/hire#checks`);
  const episode = currentHireEpisode(claimId);
  if (!episode?.fleet_vehicle_id || !present(episode.make) || !present(episode.model) || !present(episode.registration)) {
    add("car", "Hire car (make, model and registration)", `${base}/hire#car`);
  }
  if (!episode?.started_at && !plannedHandoverAt(claimId)) add("handover-date", "Planned handover date", `${base}/hire#car`);
  if (!(Number(episode?.rate_pence_per_day) > 0)) add("daily-rate", "Daily rate", `${base}/hire#rate`);
  if (!groupChargedFor(claimId)) add("group-charged", "Group charged", `${base}/hire#rate`);
  if (!needReasonFor(claimId)) add("need-reason", "Why a hire car is needed", `${base}/hire#need`);
  // These print on the agreement the client signs, so they are needed before it is produced.
  const before = beforeSigningFor(claimId);
  if (before.vehicleId && !before.started) {
    if (!before.transmission) add("transmission", "Hire car transmission", `${base}/hire#before-signing`);
    if (before.mileage == null || !before.fuelLevel) add("readings-out", "Mileage and fuel out", `${base}/hire#before-signing`);
  }
  if (!before.licenceIssuedOn) add("licence-issued", "Licence date of issue", `${base}/hire#before-signing`);
  return gaps;
}

export function agreementMandatoryRefusal(claimId: string): string | null {
  const gaps = agreementMandatoryGaps(claimId);
  if (gaps.length === 0) return null;
  return `A hire agreement was not produced. Still needed: ${gaps.map((gap) => gap.label.toLowerCase()).join(", ")}.`;
}

export type SignedAgreementFile = { id: string; title: string; createdAt: string };

export function signedHireAgreementOnFile(claimId: string): SignedAgreementFile | null {
  const row = get<{ id: string; title: string | null; created_at: string }>(
    `SELECT id, title, created_at FROM documents WHERE claim_id = ? AND document_type = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [claimId, SIGNED_HIRE_AGREEMENT_TYPE],
  );
  return row ? { id: String(row.id), title: String(row.title || "Signed hire agreement"), createdAt: String(row.created_at) } : null;
}

export type SignedAgreementOverride = { reason: string; recordedAt: string; recordedByName: string | null };

export function signedAgreementOverride(claimId: string): SignedAgreementOverride | null {
  const row = get<{ reason: string; recorded_at: string; name: string | null }>(
    `SELECT o.reason, o.recorded_at, s.name FROM prehire_overrides o LEFT JOIN staff s ON s.id = o.recorded_by
     WHERE o.claim_id = ? AND o.check_kind = ? ORDER BY o.recorded_at DESC LIMIT 1`,
    [claimId, SIGNED_AGREEMENT_OVERRIDE],
  );
  return row ? { reason: String(row.reason), recordedAt: String(row.recorded_at), recordedByName: row.name ? String(row.name) : null } : null;
}

function creditHireClaim(claimId: string): boolean {
  const claim = get<{ claim_type: string }>(`SELECT claim_type FROM claims WHERE id = ?`, [claimId]);
  return String(claim?.claim_type || "") !== "fault";
}

/**
 * Everything that stops a handover starting hire, in one sentence.
 * Credit hire also needs the daily rate and the signed agreement (or an authorised override with a reason).
 */
export function hireHandoverBlock(
  claimId: string,
  options: { asAtYmd?: string; signedCopyComing?: boolean } = {},
): string | null {
  const checks = hireAgreementPrehireBlock(claimId, { asAtYmd: options.asAtYmd, purpose: "handover" });
  if (checks) return checks;
  if (!creditHireClaim(claimId)) return null;
  const episode = currentHireEpisode(claimId);
  if (!(Number(episode?.rate_pence_per_day) > 0)) {
    return "Handover was not completed. The daily rate is missing on this hire. Set the daily rate first.";
  }
  if (!options.signedCopyComing && !signedHireAgreementOnFile(claimId) && !signedAgreementOverride(claimId)) {
    return "Handover was not completed. Upload the signed hire agreement first. A photograph of the signed pages is fine.";
  }
  return null;
}

export function readSignedUpload(file: { buffer: Buffer; filename: string; mimeType: string }) {
  const filename = (file.filename || "").trim() || "signed-hire-agreement.pdf";
  if (!file.buffer || file.buffer.length < 1) throw new Error("Choose the signed hire agreement to upload.");
  if (file.buffer.length > MAX_CLAIM_DOCUMENT_BYTES) throw new Error("Each document must be 12 MB or smaller.");
  return { buffer: file.buffer, filename, mimeType: claimDocumentMime(filename, file.mimeType) };
}

/**
 * Files the signed copy as "Signed hire agreement" and records agreement 1 as signed on the hire,
 * at the daily rate already stored on the hire. The signed date is the upload, never earlier.
 * The caller has already checked that this person may record the handover.
 */
export function storeSignedHireAgreement(input: {
  claimId: string;
  actorId: string;
  file: { buffer: Buffer; filename: string; mimeType: string };
  startDay?: string;
}): { documentId: string } {
  const file = readSignedUpload(input.file);
  const episode = currentHireEpisode(input.claimId);
  const stored = storeFileCopy({
    relDir: `claims/${input.claimId}/documents`,
    originalFilename: `${newId("file")}-${file.filename}`,
    buffer: file.buffer,
  });
  const documentId = insertStoredDocument({
    title: "Signed hire agreement",
    documentType: SIGNED_HIRE_AGREEMENT_TYPE,
    kind: "file",
    claimId: input.claimId,
    vehicleId: null,
    fleetVehicleId: episode?.fleet_vehicle_id || null,
    originalFilename: file.filename,
    storedRelpath: stored.storedRelpath,
    mimeType: file.mimeType,
    byteSize: stored.byteSize,
    createdBy: input.actorId,
    simulated: 0,
  });
  run(`UPDATE documents SET signed = 1 WHERE id = ?`, [documentId]);
  const now = nowUtcIso();
  // Signed before the handover: agreement 1 is recorded when the car is handed over. Signed after: recorded now.
  if (episode?.started_at) recordSignedAgreementOnHire(input.claimId, input.startDay || londonDateIso(new Date(episode.started_at)));
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "document_filed",
    occurredAt: now,
    actorId: input.actorId,
    documentId,
    details: "Signed hire agreement uploaded and filed. Nothing was attached to an email.",
    source: "staff",
  });
  return { documentId };
}

/**
 * Records agreement 1 as signed on the hire, at the rate stored on the hire, once the car has been handed over
 * and a signed copy is on the file. The signed date is when the signed copy was filed, never earlier.
 * Does nothing on a courtesy car, without a signed copy, or when the hire already has an agreement.
 */
export function recordSignedAgreementOnHire(claimId: string, startDay: string) {
  if (!creditHireClaim(claimId)) return;
  const episode = currentHireEpisode(claimId);
  const signed = signedHireAgreementOnFile(claimId);
  if (!episode?.started_at || !signed) return;
  const existing = get<{ id: string }>(`SELECT id FROM agreements WHERE hire_episode_id = ? LIMIT 1`, [episode.id]);
  if (existing) return;
  const [year, month, day] = startDay.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + AGREEMENT_LENGTH_DAYS - 1)).toISOString().slice(0, 10);
  run(
    `INSERT INTO agreements(id, hire_episode_id, sequence, start_on, planned_end_on, max_days, renewal_alert_day, signed, signed_at, signature_status, template_note, rate_pence_per_day)
     VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, 'signed', ?, ?)`,
    [
      newId("ag"),
      episode.id,
      startDay,
      end,
      AGREEMENT_LENGTH_DAYS,
      AGREEMENT_ALERT_FROM_DAY,
      signed.createdAt,
      "Signed paper copy uploaded. Signed date is when it was filed.",
      Number(episode.rate_pence_per_day) > 0 ? Number(episode.rate_pence_per_day) : null,
    ],
  );
}

/** An authorised user lets the handover go ahead without the signed copy. Kept on the file with the reason. */
export function recordSignedAgreementOverride(input: { claimId: string; actorId: string; reason: string }) {
  const staff = get<{ role: string }>(`SELECT role FROM staff WHERE id = ? AND active = 1`, [input.actorId]);
  const permissions = staff ? listStaffPermissions(input.actorId) : [];
  if (!staff || !canOverridePreHireChecks({ role: staff.role, permissions })) {
    throw new Error("You do not have permission to hand over without the signed agreement.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter a reason. The handover is not completed without the signed copy unless a reason is given.");
  if (reason.length > 1000) throw new Error("Keep the reason short.");
  if (signedHireAgreementOnFile(input.claimId)) return;
  const at = nowUtcIso();
  run(
    `INSERT INTO prehire_overrides(id, claim_id, check_kind, reason, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [newId("override"), input.claimId, SIGNED_AGREEMENT_OVERRIDE, reason, input.actorId, at],
  );
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: at,
    actorId: input.actorId,
    details: `Handover allowed without the signed hire agreement. Reason: ${reason}`,
    source: "staff",
  });
}

export type HireRateView = {
  ratePence: number | null;
  takenOn: string | null;
  group: string | null;
  line: string;
};

export function hireRateLine(episode: Pick<EpisodeFacts, "rate_pence_per_day" | "rate_taken_on" | "rate_group"> | undefined): HireRateView {
  const rate = Number(episode?.rate_pence_per_day) > 0 ? Number(episode?.rate_pence_per_day) : null;
  const takenOn = episode?.rate_taken_on ? String(episode.rate_taken_on) : null;
  const group = episode?.rate_group ? String(episode.rate_group) : null;
  if (!rate) return { ratePence: null, takenOn, group, line: "Daily rate missing" };
  const bits = [`${formatGbp(rate)} a day`];
  if (group) bits.push(`group ${group}`);
  if (takenOn) bits.push(`taken ${formatUkDate(takenOn)}`);
  return { ratePence: rate, takenOn, group, line: bits.join(" · ") };
}

/** Claims whose credit hire has started with no daily rate stored. Nothing is changed here. */
export function claimsWithRunningHireAndNoRate(): string[] {
  return all<{ claim_id: string }>(
    `SELECT he.claim_id FROM hire_episodes he
     WHERE he.started_at IS NOT NULL AND he.credit_hire = 1
       AND he.billing_end_at IS NULL AND he.collection_at IS NULL
       AND (he.rate_pence_per_day IS NULL OR he.rate_pence_per_day <= 0)`,
  ).map((row) => String(row.claim_id));
}

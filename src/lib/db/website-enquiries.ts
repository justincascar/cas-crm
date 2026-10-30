import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isAdministrator, isOfficeRole } from "../auth/roles";
import { formatUkDate, formatUkDateTime, londonTodayIso, nowUtcIso } from "../dates";
import { PRIVACY_NOTICE_APPROVED, PRIVACY_NOTICE_PLACEHOLDER } from "../documents/privacy-notice";
import { ukNationalNumber } from "../phone-number";
import { formatVehicleRegistration, toStartCase } from "../text";
import { recordClaimEvent } from "./chronology";
import { getClaimDraft, saveClaimDraft } from "./claim-drafts";
import { all, get, getDb, newId, run } from "./connection";

/**
 * Website enquiries (J16). The public website's "Start your claim" form posts here with no staff login. Everything it
 * sends is untrusted: strict size and format checks, a hidden spam trap, a rate limit per address, and no files. An
 * enquiry never creates a claim, changes other data or sends anything by itself. It waits on the "Website enquiries"
 * list, marked "Needs a call", until office staff convert it to a claim (the new-claim form opens pre-filled, for them
 * to check and save) or close it as not proceeding. Enquiries that never become claims follow the 12-month rule.
 */

export const FAULT_CHOICES = [
  { value: "theirs", label: "The other driver's" },
  { value: "mine", label: "Mine" },
  { value: "not_sure", label: "Not sure" },
] as const;

export const DRIVEABLE_CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
] as const;

/** The fields the website form may send. The spam trap is a box people never see. */
export const ENQUIRY_FIELDS = ["name", "mobile", "registration", "accidentDate", "fault", "driveable", "whatHappened", "privacyConsent"] as const;
export const SPAM_TRAP_FIELD = "website";

export const MAX_BODY_BYTES = 8 * 1024;
export const WHAT_HAPPENED_MAX = 1000;
/** Posts from one address in an hour, and from everyone in an hour. Every post counts, accepted or not. */
export const PER_ADDRESS_PER_HOUR = 8;
export const ALL_ADDRESSES_PER_HOUR = 120;

/** The local website used for testing (J17). In development the CRM accepts posts from it only. */
export const DEV_WEBSITE_ORIGINS = ["http://localhost:4000", "http://127.0.0.1:4000"];
export const WEBSITE_ORIGINS_SETTING = "website_origins";

export function ensureWebsiteEnquiryTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS website_enquiries (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      received_at TEXT NOT NULL,
      full_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      registration TEXT NOT NULL,
      accident_date TEXT NOT NULL,
      fault TEXT NOT NULL,
      driveable TEXT NOT NULL,
      what_happened TEXT,
      consent_at TEXT NOT NULL,
      consent_notice TEXT NOT NULL,
      source_origin TEXT,
      status TEXT NOT NULL DEFAULT 'needs_call',
      draft_id TEXT,
      claim_id TEXT,
      closed_at TEXT,
      closed_by TEXT,
      closed_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS website_enquiries_status ON website_enquiries(status, received_at);
    CREATE TABLE IF NOT EXISTS website_enquiry_hits (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      address_hash TEXT NOT NULL,
      outcome TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS website_enquiry_hits_at ON website_enquiry_hits(at);
  `);
}

function ready() {
  ensureWebsiteEnquiryTables(getDb());
}

function setting(key: string): string | null {
  return get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key])?.value ?? null;
}

function setSetting(key: string, value: string) {
  run(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

// ---- Allowed website addresses ----

/** "https://www.example.co.uk/page" → "https://www.example.co.uk"; anything that is not a web address → null. */
export function normaliseOrigin(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The live website address(es) saved in Settings. */
export function savedWebsiteOrigins(): string[] {
  ready();
  return String(setting(WEBSITE_ORIGINS_SETTING) || "")
    .split(/[\s,]+/)
    .map(normaliseOrigin)
    .filter((origin): origin is string => Boolean(origin));
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** In development, the local website only. Live, the address saved in Settings (none until Justin saves one). */
export function allowedWebsiteOrigins(): string[] {
  if (isDevelopment()) {
    const extra = normaliseOrigin(process.env.CAS_WEBSITE_DEV_ORIGIN || "");
    return extra ? [...DEV_WEBSITE_ORIGINS, extra] : DEV_WEBSITE_ORIGINS;
  }
  return savedWebsiteOrigins();
}

export function isAllowedWebsiteOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const normalised = normaliseOrigin(origin);
  return Boolean(normalised && allowedWebsiteOrigins().includes(normalised));
}

export function saveWebsiteOrigins(input: { actorRole: string; value: string }) {
  if (!isAdministrator(input.actorRole)) throw new Error("Only an administrator can change the website address.");
  const parts = input.value.split(/[\s,]+/).filter(Boolean);
  const origins: string[] = [];
  for (const part of parts) {
    const origin = normaliseOrigin(part);
    if (!origin) throw new Error(`"${part.slice(0, 60)}" is not a website address. Enter it like https://www.example.co.uk`);
    if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      throw new Error("The live website address must start with https://");
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  if (origins.length > 5) throw new Error("Enter at most five website addresses.");
  ready();
  setSetting(WEBSITE_ORIGINS_SETTING, origins.join("\n"));
}

// ---- Rate limit ----

/** Addresses are kept only as a salted fingerprint, for the rate limit, and dropped after a day. */
export function addressFingerprint(address: string): string {
  ready();
  let salt = setting("website_enquiry_salt");
  if (!salt) {
    salt = randomBytes(16).toString("hex");
    setSetting("website_enquiry_salt", salt);
  }
  return createHash("sha256").update(`${salt}:${address.trim().toLowerCase() || "unknown"}`).digest("hex").slice(0, 32);
}

function recordHit(addressHash: string, outcome: string, nowIso: string) {
  run(`INSERT INTO website_enquiry_hits(id, at, address_hash, outcome) VALUES (?, ?, ?, ?)`, [newId("hit"), nowIso, addressHash, outcome]);
}

export function isRateLimited(addressHash: string, nowIso: string): boolean {
  ready();
  const dayAgo = new Date(new Date(nowIso).getTime() - 24 * 3_600_000).toISOString();
  run(`DELETE FROM website_enquiry_hits WHERE at < ?`, [dayAgo]);
  const hourAgo = new Date(new Date(nowIso).getTime() - 3_600_000).toISOString();
  const mine = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM website_enquiry_hits WHERE address_hash = ? AND at >= ?`, [addressHash, hourAgo])?.n || 0);
  if (mine >= PER_ADDRESS_PER_HOUR) return true;
  const everyone = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM website_enquiry_hits WHERE at >= ?`, [hourAgo])?.n || 0);
  return everyone >= ALL_ADDRESSES_PER_HOUR;
}

// ---- Checking what was sent ----

export type EnquiryInput = {
  name: string;
  mobile: string;
  registration: string;
  accidentDate: string;
  fault: (typeof FAULT_CHOICES)[number]["value"];
  driveable: (typeof DRIVEABLE_CHOICES)[number]["value"];
  whatHappened: string;
};

export type CheckResult = { ok: true; value: EnquiryInput } | { ok: false; errors: Record<string, string> };

/** Removes control characters, zero-width and direction-changing characters, and runs of spaces. */
export function cleanText(value: unknown, keepLines = false): string {
  if (typeof value !== "string") return "";
  const stripped = value
    .normalize("NFC")
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(keepLines ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, keepLines ? "" : " ");
  if (!keepLines) return stripped.replace(/\s+/g, " ").trim();
  return stripped
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addYears(ymd: string, years: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y + years, m - 1, d));
  return date.toISOString().slice(0, 10);
}

function realDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const CONSENT_YES = new Set(["yes", "on", "true", "1"]);

export function checkEnquiry(raw: Record<string, unknown>, todayYmd = londonTodayIso()): CheckResult {
  const errors: Record<string, string> = {};
  for (const key of [...ENQUIRY_FIELDS, SPAM_TRAP_FIELD]) {
    const value = raw[key];
    if (value != null && typeof value !== "string" && typeof value !== "boolean") errors[key] = "This must be text.";
  }

  const name = cleanText(raw.name);
  if (!name) errors.name = "Enter your name.";
  else if (name.length < 2 || name.length > 80) errors.name = "Enter your name (2 to 80 characters).";
  else if (!/^[\p{L}\p{M}' .-]+$/u.test(name) || !/\p{L}/u.test(name)) errors.name = "Use letters only in your name.";

  const mobileRaw = cleanText(raw.mobile);
  const national = ukNationalNumber(mobileRaw);
  const mobileOk = Boolean(national && /^07\d{9}$/.test(national) && /^[+\d\s()-]{10,20}$/.test(mobileRaw));
  if (!mobileRaw) errors.mobile = "Enter your mobile number.";
  else if (!mobileOk) errors.mobile = "Enter a UK mobile number, like 07700 900123.";

  const registration = cleanText(raw.registration).toUpperCase().replace(/\s+/g, "");
  if (!registration) errors.registration = "Enter your registration.";
  else if (!/^[A-Z0-9]{2,8}$/.test(registration) || !/[A-Z]/.test(registration) || !/\d/.test(registration)) {
    errors.registration = "Enter the registration as it shows on the number plate, like AB12 CDE.";
  }

  const accidentDate = cleanText(raw.accidentDate);
  if (!accidentDate) errors.accidentDate = "Enter the date of the accident.";
  else if (!realDate(accidentDate)) errors.accidentDate = "Enter a real date.";
  else if (accidentDate > todayYmd) errors.accidentDate = "The accident date cannot be in the future.";
  else if (accidentDate < addYears(todayYmd, -6)) errors.accidentDate = "That date is more than six years ago. Please call us instead.";

  const fault = cleanText(raw.fault);
  if (!FAULT_CHOICES.some((choice) => choice.value === fault)) errors.fault = "Choose whose fault it was.";

  const driveable = cleanText(raw.driveable);
  if (!DRIVEABLE_CHOICES.some((choice) => choice.value === driveable)) errors.driveable = "Choose whether the car can be driven.";

  const whatHappened = cleanText(raw.whatHappened, true);
  if (whatHappened.length > WHAT_HAPPENED_MAX) errors.whatHappened = `Keep this to ${WHAT_HAPPENED_MAX} characters or fewer.`;

  const consent = raw.privacyConsent;
  if (!(consent === true || (typeof consent === "string" && CONSENT_YES.has(consent.trim().toLowerCase())))) {
    errors.privacyConsent = "Tick the box to say you have read the privacy notice.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      mobile: `${national!.slice(0, 5)} ${national!.slice(5)}`,
      // The current style of plate gets its usual space; older and Northern Irish plates are kept as typed, without spaces.
      registration: formatVehicleRegistration(/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(registration) ? `${registration.slice(0, 4)} ${registration.slice(4)}` : registration),
      accidentDate,
      fault: fault as EnquiryInput["fault"],
      driveable: driveable as EnquiryInput["driveable"],
      whatHappened,
    },
  };
}

// ---- Receiving ----

export type ReceiveResult =
  | { outcome: "stored"; id: string; reference: string }
  | { outcome: "spam" }
  | { outcome: "limited" }
  | { outcome: "invalid"; errors: Record<string, string> };

function nextReference(): string {
  const last = get<{ reference: string }>(`SELECT reference FROM website_enquiries ORDER BY reference DESC LIMIT 1`)?.reference || "WEB-0000";
  const n = Number(last.replace(/\D/g, "")) + 1;
  return `WEB-${String(n).padStart(4, "0")}`;
}

/**
 * Takes one post from the website. It only ever adds a row to website_enquiries (and a rate-limit mark). It never
 * creates a claim, changes other data or sends anything.
 */
export function receiveWebsiteEnquiry(input: { raw: Record<string, unknown>; address: string; origin: string | null; nowIso?: string }): ReceiveResult {
  ready();
  const now = input.nowIso || nowUtcIso();
  const hash = addressFingerprint(input.address);
  if (isRateLimited(hash, now)) {
    recordHit(hash, "limited", now);
    return { outcome: "limited" };
  }
  // The spam trap: a box people never see. Anything typed in it is from a program, so nothing is kept.
  if (cleanText(input.raw[SPAM_TRAP_FIELD])) {
    recordHit(hash, "spam", now);
    return { outcome: "spam" };
  }
  const checked = checkEnquiry(input.raw, londonTodayIso(new Date(now)));
  if (!checked.ok) {
    recordHit(hash, "invalid", now);
    return { outcome: "invalid", errors: checked.errors };
  }
  const id = newId("webenq");
  const reference = nextReference();
  const value = checked.value;
  run(
    `INSERT INTO website_enquiries(id, reference, received_at, full_name, mobile, registration, accident_date, fault, driveable, what_happened, consent_at, consent_notice, source_origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      reference,
      now,
      value.name,
      value.mobile,
      value.registration,
      value.accidentDate,
      value.fault,
      value.driveable,
      value.whatHappened || null,
      now,
      PRIVACY_NOTICE_APPROVED ? "Privacy notice (approved wording)" : PRIVACY_NOTICE_PLACEHOLDER,
      input.origin ? normaliseOrigin(input.origin) : null,
    ],
  );
  recordHit(hash, "stored", now);
  return { outcome: "stored", id, reference };
}

// ---- The staff list ----

export type EnquiryRow = {
  id: string;
  reference: string;
  received_at: string;
  full_name: string;
  mobile: string;
  registration: string;
  accident_date: string;
  fault: string;
  driveable: string;
  what_happened: string | null;
  consent_at: string;
  consent_notice: string;
  status: string;
  draft_id: string | null;
  claim_id: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  closed_by_name?: string | null;
  file_reference?: string | null;
  draft_open?: number;
};

export type EnquiryView = EnquiryRow & {
  urgent: boolean;
  faultLabel: string;
  driveableLabel: string;
  /** "Needs a call", "Claim being set up", "Converted to TEST-0040" or "Not proceeding". */
  statusLabel: string;
};

function view(row: EnquiryRow): EnquiryView {
  const open = row.status === "needs_call";
  return {
    ...row,
    urgent: open && row.driveable === "no",
    faultLabel: FAULT_CHOICES.find((choice) => choice.value === row.fault)?.label || row.fault,
    driveableLabel: DRIVEABLE_CHOICES.find((choice) => choice.value === row.driveable)?.label || row.driveable,
    statusLabel:
      row.status === "converted"
        ? `Converted to ${row.file_reference || "a claim"}`
        : row.status === "not_proceeding"
          ? "Not proceeding"
          : row.draft_open
            ? "Claim being set up"
            : "Needs a call",
  };
}

const SELECT = `
  SELECT e.*, s.name AS closed_by_name, c.file_reference,
         CASE WHEN d.id IS NOT NULL AND d.discarded_at IS NULL AND d.claim_id IS NULL THEN 1 ELSE 0 END AS draft_open
  FROM website_enquiries e
  LEFT JOIN staff s ON s.id = e.closed_by
  LEFT JOIN claims c ON c.id = e.claim_id
  LEFT JOIN claim_drafts d ON d.id = e.draft_id`;

/** Open enquiries: can't-be-driven first, then oldest first, so nobody waits longest. */
export function listOpenEnquiries(): EnquiryView[] {
  ready();
  return all<EnquiryRow>(`${SELECT} WHERE e.status = 'needs_call' ORDER BY CASE WHEN e.driveable = 'no' THEN 0 ELSE 1 END, e.received_at ASC`).map(view);
}

export function listClosedEnquiries(limit = 50): EnquiryView[] {
  ready();
  return all<EnquiryRow>(`${SELECT} WHERE e.status <> 'needs_call' ORDER BY COALESCE(e.closed_at, e.received_at) DESC LIMIT ?`, [limit]).map(view);
}

export function getEnquiry(id: string): EnquiryView | undefined {
  ready();
  const row = get<EnquiryRow>(`${SELECT} WHERE e.id = ?`, [id]);
  return row ? view(row) : undefined;
}

export function enquiryCounts(): { needsCall: number; urgent: number } {
  ready();
  const row = get<{ needs: number; urgent: number }>(
    `SELECT COUNT(*) AS needs, SUM(CASE WHEN driveable = 'no' THEN 1 ELSE 0 END) AS urgent FROM website_enquiries WHERE status = 'needs_call'`,
  );
  return { needsCall: Number(row?.needs || 0), urgent: Number(row?.urgent || 0) };
}

function officeOnly(role: string) {
  if (!isOfficeRole(role)) throw new Error("Only office staff can work on website enquiries.");
}

/** The new-claim form's boxes, filled from the enquiry. Staff check each one before saving. */
export function draftFieldsFromEnquiry(enquiry: Pick<EnquiryRow, "id" | "full_name" | "mobile" | "registration" | "accident_date" | "fault" | "driveable" | "what_happened">): Record<string, string> {
  const words = toStartCase(enquiry.full_name).split(" ").filter(Boolean);
  const forename = words.length > 1 ? words.slice(0, -1).join(" ") : words[0] || "";
  const surname = words.length > 1 ? words[words.length - 1] : "";
  return {
    websiteEnquiryId: enquiry.id,
    clientRole: "owner_driver",
    client_forename: forename,
    client_surname: surname,
    client_mobile: enquiry.mobile,
    veh_registration: enquiry.registration,
    accidentDate: enquiry.accident_date,
    claimType: enquiry.fault === "theirs" ? "non_fault" : enquiry.fault === "mine" ? "fault" : "",
    roadworthiness: enquiry.driveable === "no" ? "unroadworthy" : enquiry.driveable === "yes" ? "roadworthy" : "",
    circumstances: enquiry.what_happened || "",
  };
}

/**
 * "Convert to claim": makes (or reopens) a new-claim draft filled from the enquiry and returns its id. No claim exists
 * until staff check the form and save it.
 */
export function startClaimFromEnquiry(input: { enquiryId: string; actorId: string; actorRole: string }): string {
  ready();
  officeOnly(input.actorRole);
  const enquiry = getEnquiry(input.enquiryId);
  if (!enquiry) throw new Error("That enquiry was not found.");
  if (enquiry.status !== "needs_call") throw new Error(`This enquiry is already closed (${enquiry.statusLabel}).`);
  if (enquiry.draft_id && enquiry.draft_open) return enquiry.draft_id;
  const draft = saveClaimDraft({ payload: draftFieldsFromEnquiry(enquiry), actorId: input.actorId });
  run(`UPDATE website_enquiries SET draft_id = ? WHERE id = ?`, [draft.id, enquiry.id]);
  return draft.id;
}

/** The enquiry a new-claim draft was made from, if any. */
export function enquiryForDraft(draftId: string | null | undefined): EnquiryView | undefined {
  const id = (draftId || "").trim();
  if (!id) return undefined;
  ready();
  const row = get<{ id: string }>(`SELECT id FROM website_enquiries WHERE draft_id = ?`, [id]);
  return row ? getEnquiry(String(row.id)) : undefined;
}

/** Called when the new claim is saved from a draft: the enquiry it came from is marked converted. */
export function markEnquiryConverted(input: { draftId: string | null | undefined; claimId: string; actorId: string }) {
  const enquiry = enquiryForDraft(input.draftId);
  if (!enquiry || enquiry.status !== "needs_call") return;
  const now = nowUtcIso();
  run(`UPDATE website_enquiries SET status = 'converted', claim_id = ?, closed_at = ?, closed_by = ? WHERE id = ?`, [input.claimId, now, input.actorId, enquiry.id]);
  recordClaimEvent({
    claimId: input.claimId,
    eventType: "other",
    occurredAt: now,
    actorId: input.actorId,
    source: "staff",
    details: `Opened from website enquiry ${enquiry.reference}, received ${formatUkDateTime(enquiry.received_at)}. The client ticked the privacy notice box on the website at ${formatUkDateTime(enquiry.consent_at)} (${enquiry.consent_notice}).`,
  });
}

export function closeEnquiry(input: { enquiryId: string; actorId: string; actorRole: string; reason: string }) {
  ready();
  officeOnly(input.actorRole);
  const reason = cleanText(input.reason).slice(0, 500);
  if (!reason) throw new Error("Give the reason it is not proceeding.");
  const enquiry = getEnquiry(input.enquiryId);
  if (!enquiry) throw new Error("That enquiry was not found.");
  if (enquiry.status !== "needs_call") throw new Error(`This enquiry is already closed (${enquiry.statusLabel}).`);
  const now = nowUtcIso();
  run(`UPDATE website_enquiries SET status = 'not_proceeding', closed_at = ?, closed_by = ?, closed_reason = ? WHERE id = ?`, [now, input.actorId, reason, enquiry.id]);
  // A half-made claim from this enquiry is put away with it, so it does not linger on the dashboard.
  if (enquiry.draft_id && enquiry.draft_open) {
    run(`UPDATE claim_drafts SET discarded_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND claim_id IS NULL`, [now, now, input.actorId, enquiry.draft_id]);
  }
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'website_enquiry_closed', 'website_enquiry', ?, ?)`, [
    newId("audit"),
    now,
    input.actorId,
    enquiry.id,
    `${enquiry.reference} not proceeding: ${reason}`,
  ]);
}

/** Puts a "not proceeding" enquiry back on the list, if it was closed by mistake. */
export function reopenEnquiry(input: { enquiryId: string; actorId: string; actorRole: string }) {
  ready();
  officeOnly(input.actorRole);
  const enquiry = getEnquiry(input.enquiryId);
  if (!enquiry || enquiry.status !== "not_proceeding") throw new Error("Only an enquiry marked not proceeding can be reopened.");
  run(`UPDATE website_enquiries SET status = 'needs_call', closed_at = NULL, closed_by = NULL, closed_reason = NULL, draft_id = NULL WHERE id = ?`, [enquiry.id]);
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, 'website_enquiry_reopened', 'website_enquiry', ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    input.actorId,
    enquiry.id,
    `${enquiry.reference} reopened`,
  ]);
}

// ---- Retention and a person's data ----

/** Enquiries that never became a claim and are past the retention period (12 months by default). */
export function enquiriesDueForDeletion(months: number, asAtYmd: string): Array<{ id: string; reference: string; dueSince: string }> {
  ready();
  return all<{ id: string; reference: string; received_at: string }>(`SELECT id, reference, received_at FROM website_enquiries WHERE claim_id IS NULL ORDER BY received_at`)
    .map((row) => {
      const [y, m, d] = String(row.received_at).slice(0, 10).split("-").map(Number);
      const due = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
      return { id: String(row.id), reference: String(row.reference), dueSince: due };
    })
    .filter((row) => row.dueSince <= asAtYmd);
}

export function deleteEnquiry(id: string): number {
  ready();
  getDb().prepare(`DELETE FROM claim_drafts WHERE id = (SELECT draft_id FROM website_enquiries WHERE id = ?) AND claim_id IS NULL`).run(id);
  return Number(getDb().prepare(`DELETE FROM website_enquiries WHERE id = ? AND claim_id IS NULL`).run(id).changes);
}

/** Website enquiries matching a name, mobile number or registration, for the person's data screen. */
export function searchEnquiries(query: string): EnquiryView[] {
  ready();
  const text = cleanText(query);
  if (text.length < 2) return [];
  const digits = text.replace(/\D/g, "");
  const reg = text.toUpperCase().replace(/\s+/g, "");
  return all<EnquiryRow>(
    `${SELECT} WHERE lower(e.full_name) LIKE ? OR (? <> '' AND replace(e.mobile, ' ', '') LIKE ?) OR replace(e.registration, ' ', '') = ? ORDER BY e.received_at DESC LIMIT 50`,
    [`%${text.toLowerCase()}%`, digits.length >= 6 ? digits : "", `%${digits}%`, reg],
  ).map(view);
}

/** Plain-text summary used in a subject access export. */
export function enquiryExportText(enquiry: EnquiryView): string {
  return [
    `Website enquiry ${enquiry.reference}`,
    `Received: ${formatUkDateTime(enquiry.received_at)}`,
    `Name: ${enquiry.full_name}`,
    `Mobile: ${enquiry.mobile}`,
    `Registration: ${enquiry.registration}`,
    `Accident date: ${formatUkDate(enquiry.accident_date)}`,
    `Whose fault: ${enquiry.faultLabel}`,
    `Can the car be driven: ${enquiry.driveableLabel}`,
    `What happened: ${enquiry.what_happened || "(left blank)"}`,
    `Privacy notice box ticked: ${formatUkDateTime(enquiry.consent_at)} (${enquiry.consent_notice})`,
    `Status: ${enquiry.statusLabel}${enquiry.closed_reason ? ` (${enquiry.closed_reason})` : ""}`,
  ].join("\n");
}

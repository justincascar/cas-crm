import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { nowUtcIso } from "../dates";
import { get, getDb, newId, run } from "../db/connection";
import { ADMINISTRATOR_ROLE } from "./roles";
import { newTotpSecret, verifyTotp } from "./totp";

/**
 * Login security (J15). Repeated failed logins lock the username for a while; a session ends after a period without
 * use (Settings, default 30 minutes); new passwords must be strong; an authenticator-app code is a second step,
 * optional for local logins and required for an administrator (Justin). Sign-in goes through a provider list so
 * Microsoft 365 single sign-on can be added later beside the local login without rewriting it.
 */

export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const DEFAULT_IDLE_MINUTES = 30;
const CHALLENGE_MINUTES = 5;
const MAX_CODE_ATTEMPTS = 5;
export const CHALLENGE_COOKIE = "cas_challenge";

/** Where a person can sign in. Microsoft 365 is listed but not connected: it needs CAS's Microsoft admin set-up. */
export const SIGN_IN_PROVIDERS = [
  { id: "local", label: "Username and password", connected: true },
  { id: "microsoft365", label: "Microsoft 365", connected: false },
] as const;

export function ensureLoginSecurityTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(username, at);
    CREATE TABLE IF NOT EXISTS login_challenges (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      pending_secret TEXT,
      next_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  const staff = new Set((db.prepare(`PRAGMA table_info(staff)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!staff.has("totp_secret")) db.exec(`ALTER TABLE staff ADD COLUMN totp_secret TEXT`);
  if (!staff.has("totp_enabled_at")) db.exec(`ALTER TABLE staff ADD COLUMN totp_enabled_at TEXT`);
  if (!staff.has("auth_provider")) db.exec(`ALTER TABLE staff ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'`);
  if (!staff.has("external_subject")) db.exec(`ALTER TABLE staff ADD COLUMN external_subject TEXT`);
  const sessions = new Set((db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map((c) => c.name));
  if (!sessions.has("last_seen_at")) db.exec(`ALTER TABLE sessions ADD COLUMN last_seen_at TEXT`);
}

function ready() {
  ensureLoginSecurityTables(getDb());
}

function audit(action: string, staffId: string | null, details: string) {
  run(`INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, 'staff', ?, ?)`, [
    newId("audit"),
    nowUtcIso(),
    staffId,
    action,
    staffId,
    details,
  ]);
}

/** When the username is locked until, or null. Counts failures since the last success, within the lock window. */
export function loginLockedUntil(username: string, nowMs = Date.now()): string | null {
  ready();
  const name = username.trim().toLowerCase();
  if (!name) return null;
  const since = new Date(nowMs - LOCK_MINUTES * 60_000).toISOString();
  const lastOk = get<{ at: string }>(`SELECT at FROM login_attempts WHERE username = ? AND ok = 1 ORDER BY at DESC LIMIT 1`, [name])?.at || "";
  const from = lastOk > since ? lastOk : since;
  const failures = get<{ n: number; last: string | null }>(
    `SELECT COUNT(*) AS n, MAX(at) AS last FROM login_attempts WHERE username = ? AND ok = 0 AND at > ?`,
    [name, from],
  );
  if (Number(failures?.n || 0) < LOCK_AFTER_FAILURES || !failures?.last) return null;
  const until = new Date(new Date(failures.last).getTime() + LOCK_MINUTES * 60_000).toISOString();
  return until > new Date(nowMs).toISOString() ? until : null;
}

export function recordLoginAttempt(input: { username: string; ok: boolean; staffId?: string | null; reason?: string }) {
  ready();
  const name = input.username.trim().toLowerCase().slice(0, 64);
  if (!name) return;
  run(`INSERT INTO login_attempts(id, username, at, ok, reason) VALUES (?, ?, ?, ?, ?)`, [newId("login"), name, nowUtcIso(), input.ok ? 1 : 0, input.reason || null]);
  if (!input.ok) {
    audit("login_failed", input.staffId || null, `Failed sign-in for ${name}${input.reason ? ` (${input.reason})` : ""}`);
    if (loginLockedUntil(name)) audit("login_locked", input.staffId || null, `${name} locked for ${LOCK_MINUTES} minutes after ${LOCK_AFTER_FAILURES} failed attempts`);
  }
}

/** A reset by an administrator clears the lock. */
export function clearLoginLock(username: string) {
  ready();
  run(`INSERT INTO login_attempts(id, username, at, ok, reason) VALUES (?, ?, ?, 1, 'lock cleared by an administrator')`, [newId("login"), username.trim().toLowerCase(), nowUtcIso()]);
}

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "cas123", "accident", "complete"];

/** Strong password rules for a new or reset password. Null when it is acceptable. */
export function passwordProblem(password: string, username = ""): string | null {
  const value = password.trim();
  if (value.length < 12) return "Use at least 12 characters.";
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(value)).length;
  if (kinds < 3) return "Use at least three of: lower-case letters, capitals, numbers and symbols.";
  const lower = value.toLowerCase();
  if (username && lower.includes(username.trim().toLowerCase())) return "Do not include the username in the password.";
  if (COMMON.some((word) => lower.includes(word))) return "Avoid common words such as \"password\" or the company name.";
  return null;
}

export function idleMinutes(): number {
  const value = Number(get<{ value: string }>(`SELECT value FROM settings WHERE key = 'session_idle_minutes'`)?.value || "");
  return Number.isFinite(value) && value >= 5 && value <= 480 ? value : DEFAULT_IDLE_MINUTES;
}

export function setIdleMinutes(raw: string) {
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 5 || value > 480) throw new Error("Enter the minutes before sign-out, between 5 and 480.");
  run(`INSERT INTO settings(key, value) VALUES ('session_idle_minutes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(value)]);
}

export function twoStepRequired(role: string): boolean {
  return role === ADMINISTRATOR_ROLE;
}

export function twoStepEnabled(staffId: string): boolean {
  ready();
  return Boolean(get<{ totp_enabled_at: string | null }>(`SELECT totp_enabled_at FROM staff WHERE id = ?`, [staffId])?.totp_enabled_at);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * After a correct password: a short-lived second step. "code" asks for the app's code; "setup" shows a new secret
 * to add to the app and asks for a code from it, then switches the second step on.
 */
export function startChallenge(input: { staffId: string; kind: "code" | "setup"; nextPath: string }): string {
  ready();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  run(`DELETE FROM login_challenges WHERE expires_at <= ? OR staff_id = ?`, [now.toISOString(), input.staffId]);
  run(
    `INSERT INTO login_challenges(id, staff_id, kind, pending_secret, next_path, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(token), input.staffId, input.kind, input.kind === "setup" ? newTotpSecret() : null, input.nextPath, now.toISOString(), new Date(now.getTime() + CHALLENGE_MINUTES * 60_000).toISOString()],
  );
  return token;
}

export type Challenge = { staffId: string; kind: "code" | "setup"; pendingSecret: string | null; nextPath: string; username: string };

export function readChallenge(token: string | undefined | null): Challenge | null {
  ready();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = get<{ staff_id: string; kind: string; pending_secret: string | null; next_path: string | null; username: string }>(
    `SELECT c.staff_id, c.kind, c.pending_secret, c.next_path, s.username FROM login_challenges c JOIN staff s ON s.id = c.staff_id
     WHERE c.id = ? AND c.expires_at > ? AND c.attempts < ? AND s.active = 1`,
    [hashToken(token), nowUtcIso(), MAX_CODE_ATTEMPTS],
  );
  return row
    ? { staffId: String(row.staff_id), kind: row.kind === "setup" ? "setup" : "code", pendingSecret: row.pending_secret, nextPath: String(row.next_path || "/"), username: String(row.username) }
    : null;
}

/** Checks the code. On success the challenge is used up (and on setup the second step is switched on). */
export function completeChallenge(token: string, code: string): { staffId: string; nextPath: string } {
  const challenge = readChallenge(token);
  if (!challenge) throw new Error("That sign-in step has expired. Sign in again.");
  const secret =
    challenge.kind === "setup"
      ? challenge.pendingSecret
      : get<{ totp_secret: string | null }>(`SELECT totp_secret FROM staff WHERE id = ?`, [challenge.staffId])?.totp_secret || null;
  if (!secret || !verifyTotp(secret, code)) {
    run(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`, [hashToken(token)]);
    recordLoginAttempt({ username: challenge.username, ok: false, staffId: challenge.staffId, reason: "wrong authenticator code" });
    throw new Error("That code is not right. Check the time on your phone and try the newest code.");
  }
  run(`DELETE FROM login_challenges WHERE id = ?`, [hashToken(token)]);
  if (challenge.kind === "setup") {
    run(`UPDATE staff SET totp_secret = ?, totp_enabled_at = ? WHERE id = ?`, [secret, nowUtcIso(), challenge.staffId]);
    audit("two_step_on", challenge.staffId, "Authenticator app sign-in switched on");
  }
  return { staffId: challenge.staffId, nextPath: challenge.nextPath };
}

/** A person switches their own optional second step off. Not allowed where it is required. */
export function switchOffTwoStep(input: { staffId: string; role: string }) {
  if (twoStepRequired(input.role)) throw new Error("The authenticator app is required for an administrator.");
  run(`UPDATE staff SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?`, [input.staffId]);
  audit("two_step_off", input.staffId, "Authenticator app sign-in switched off");
}

/** An administrator resets someone's authenticator (a lost phone). They set it up again at their next sign-in. */
export function resetTwoStep(input: { staffId: string; actorId: string }) {
  run(`UPDATE staff SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?`, [input.staffId]);
  audit("two_step_reset", input.actorId, `Authenticator app reset for ${input.staffId}`);
}

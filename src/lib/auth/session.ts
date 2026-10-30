import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { nowUtcIso } from "../dates";
import { get, newId, run } from "../db/connection";
import { SESSION_COOKIE, SESSION_DAYS } from "./constants";
import { passwordMatches } from "./passwords";
import { idleMinutes, loginLockedUntil, recordLoginAttempt } from "./login-security";
import { isAdministrator, isOfficeRole } from "./roles";

export { SESSION_COOKIE, SESSION_DAYS };

export type StaffUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
};

type StaffRow = StaffUser & { password_hash: string | null; active: number };

function sessionExpiryIso(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function findStaffByUsername(username: string): StaffRow | undefined {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) return undefined;
  return get<StaffRow>(
    `SELECT id, name, username, email, role, password_hash, active
     FROM staff WHERE lower(username) = ?`,
    [trimmed],
  );
}

/** A session ends after the Settings period without use (J15), as well as at its expiry. Use keeps it alive. */
export function findValidSession(token: string | undefined | null): StaffUser | undefined {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  const now = Date.now();
  const idleCutoff = new Date(now - idleMinutes() * 60_000).toISOString();
  const row = get<StaffUser & { last_seen: string }>(
    `SELECT st.id, st.name, st.username, st.email, st.role, COALESCE(s.last_seen_at, s.created_at) AS last_seen
     FROM sessions s
     JOIN staff st ON st.id = s.staff_id
     WHERE s.id = ? AND s.expires_at > ? AND COALESCE(s.last_seen_at, s.created_at) > ? AND st.active = 1`,
    [token, new Date(now).toISOString(), idleCutoff],
  );
  if (!row) return undefined;
  // Written at most once a minute, so opening pages does not write on every request.
  if (String(row.last_seen) < new Date(now - 60_000).toISOString()) run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [new Date(now).toISOString(), token]);
  return { id: row.id, name: row.name, username: row.username, email: row.email, role: row.role };
}

export function createSession(staffId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = nowUtcIso();
  run(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
  run(`INSERT INTO sessions(id, staff_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`, [
    token,
    staffId,
    now,
    sessionExpiryIso(),
    now,
  ]);
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, 'login', 'staff', ?, 'Signed in')`,
    [newId("audit"), now, staffId, staffId],
  );
  return token;
}

export function destroySession(token: string | undefined | null, staffId?: string) {
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    run(`DELETE FROM sessions WHERE id = ?`, [token]);
  }
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, 'logout', 'staff', ?, 'Signed out')`,
    [newId("audit"), nowUtcIso(), staffId || null, staffId || null],
  );
}

export type LoginCheck = { ok: true; staff: StaffUser } | { ok: false; lockedUntil: string | null };

/** Username and password, with the lockout after repeated failures (J15). Every attempt is recorded. */
export function checkStaffLogin(username: string, password: string): LoginCheck {
  const lockedUntil = loginLockedUntil(username);
  const row = findStaffByUsername(username);
  if (lockedUntil) {
    passwordMatches(password, row?.password_hash); // same time taken whether or not locked
    recordLoginAttempt({ username, ok: false, staffId: row?.id, reason: "locked" });
    return { ok: false, lockedUntil };
  }
  const staff = verifyStaffLogin(username, password);
  recordLoginAttempt({ username, ok: Boolean(staff), staffId: row?.id, reason: staff ? undefined : "wrong username or password" });
  return staff ? { ok: true, staff } : { ok: false, lockedUntil: loginLockedUntil(username) };
}

export function verifyStaffLogin(username: string, password: string): StaffUser | null {
  const row = findStaffByUsername(username);
  const ok = passwordMatches(password, row?.password_hash) && !!row && row.active === 1;
  if (!ok || !row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: row.role,
  };
}

export async function getRequestStaff(): Promise<StaffUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findValidSession(token) || null;
}

export async function requireSignedIn(): Promise<StaffUser> {
  const staff = await getRequestStaff();
  if (!staff) redirect("/login");
  return staff;
}

/** Administrator and staff. Driver and mechanic are sent to My jobs today. */
export async function requireStaff(): Promise<StaffUser> {
  const staff = await requireSignedIn();
  if (!isOfficeRole(staff.role)) redirect("/jobs?notice=office");
  return staff;
}

export async function requireAdministrator(): Promise<StaffUser> {
  const staff = await requireStaff();
  if (!isAdministrator(staff.role)) {
    redirect("/settings?error=" + encodeURIComponent("Only an administrator can manage staff logins."));
  }
  return staff;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/";
  return raw;
}

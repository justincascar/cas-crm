import { hashPasswordSync } from "../auth/passwords";
import { ADMINISTRATOR_ROLE, normaliseStaffRole, parseStaffRole } from "../auth/roles";
import { nowUtcIso } from "../dates";
import { all, get, newId, run } from "./connection";

export type StaffRecord = {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  active: number;
};

export function listAllStaff(): StaffRecord[] {
  return all<StaffRecord>(
    "SELECT id, name, email, username, role, active FROM staff ORDER BY active DESC, name",
  );
}

function countAdministrators(): number {
  const row = get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM staff WHERE role = ? AND active = 1",
    [ADMINISTRATOR_ROLE],
  );
  return Number(row?.c || 0);
}

function validUsername(username: string): string | null {
  const value = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{1,31}$/.test(value)) {
    return "Username must start with a letter and use only letters, numbers, dots, hyphens or underscores.";
  }
  return null;
}

export function createStaffAccount(input: {
  name: string;
  username: string;
  email: string;
  password: string;
  role: string;
  actorId: string;
}): { ok: true; id: string } | { ok: false; error: string } {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const usernameError = validUsername(input.username);
  if (!name) return { ok: false, error: "Enter the person's name." };
  if (usernameError) return { ok: false, error: usernameError };
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (input.password.trim().length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const username = input.username.trim().toLowerCase();
  const taken = get<{ id: string }>("SELECT id FROM staff WHERE lower(username) = ? OR lower(email) = ?", [
    username,
    email,
  ]);
  if (taken) return { ok: false, error: "That username or email is already in use." };
  const id = newId("staff");
  const role = parseStaffRole(input.role);
  if (!role) return { ok: false, error: "Choose administrator, staff, driver or bodyshop / mechanic." };
  run(
    `INSERT INTO staff(id, name, email, username, password_hash, role, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, name, email, username, hashPasswordSync(input.password.trim()), role],
  );
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, 'staff_create', 'staff', ?, ?)`,
    [newId("audit"), nowUtcIso(), input.actorId, id, `Created ${username} as ${role}`],
  );
  return { ok: true, id };
}

export function setStaffActive(id: string, active: boolean, actorId: string): { ok: true } | { ok: false; error: string } {
  const row = get<StaffRecord>("SELECT id, name, email, username, role, active FROM staff WHERE id = ?", [id]);
  if (!row) return { ok: false, error: "That staff record was not found." };
  if (id === actorId && !active) return { ok: false, error: "You cannot disable your own login." };
  if (!active && row.role === ADMINISTRATOR_ROLE && countAdministrators() <= 1) {
    return { ok: false, error: "There must be at least one active administrator." };
  }
  run("UPDATE staff SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
  if (!active) run("DELETE FROM sessions WHERE staff_id = ?", [id]);
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, ?, 'staff', ?, ?)`,
    [newId("audit"), nowUtcIso(), actorId, active ? "staff_enable" : "staff_disable", id, row.username],
  );
  return { ok: true };
}

export function resetStaffPassword(
  id: string,
  password: string,
  actorId: string,
): { ok: true } | { ok: false; error: string } {
  if (password.trim().length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const row = get<{ id: string; username: string }>("SELECT id, username FROM staff WHERE id = ?", [id]);
  if (!row) return { ok: false, error: "That staff record was not found." };
  run("UPDATE staff SET password_hash = ? WHERE id = ?", [hashPasswordSync(password.trim()), id]);
  run("DELETE FROM sessions WHERE staff_id = ?", [id]);
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, 'staff_password_reset', 'staff', ?, ?)`,
    [newId("audit"), nowUtcIso(), actorId, id, row.username],
  );
  return { ok: true };
}

export function setStaffRole(id: string, role: string, actorId: string): { ok: true } | { ok: false; error: string } {
  const next = parseStaffRole(role);
  if (!next) return { ok: false, error: "Choose administrator, staff, driver or bodyshop / mechanic." };
  const row = get<StaffRecord>("SELECT id, name, email, username, role, active FROM staff WHERE id = ?", [id]);
  if (!row) return { ok: false, error: "That staff record was not found." };
  if (row.role === ADMINISTRATOR_ROLE && next !== ADMINISTRATOR_ROLE && countAdministrators() <= 1) {
    return { ok: false, error: "There must be at least one active administrator." };
  }
  run("UPDATE staff SET role = ? WHERE id = ?", [next, id]);
  run(
    `INSERT INTO audit_log(id, at, actor_id, action, entity, entity_id, details)
     VALUES (?, ?, ?, 'staff_role', 'staff', ?, ?)`,
    [newId("audit"), nowUtcIso(), actorId, id, `${row.username} → ${next}`],
  );
  return { ok: true };
}

export { normaliseStaffRole };

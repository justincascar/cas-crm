import { canOverridePreHireChecks } from "../auth/roles";
import { all, getDb } from "./connection";
import { migrate } from "./migrate";

let permissionsReady = false;

function ensurePermissionTable() {
  if (permissionsReady) return;
  migrate(getDb());
  permissionsReady = true;
}

/** Permission keys granted to this account. Empty when none have been granted. */
export function listStaffPermissions(staffId: string): string[] {
  ensurePermissionTable();
  return all<{ permission: string }>(
    `SELECT permission FROM staff_permissions WHERE staff_id = ? ORDER BY permission`,
    [staffId],
  ).map((row) => row.permission);
}

export function accountCanOverridePreHireChecks(staffId: string, role: string | null | undefined): boolean {
  return canOverridePreHireChecks({ role, permissions: listStaffPermissions(staffId) });
}

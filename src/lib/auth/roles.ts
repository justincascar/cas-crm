export const ADMINISTRATOR_ROLE = "administrator";
export const STAFF_ROLE = "staff";

export type StaffAccessRole = typeof ADMINISTRATOR_ROLE | typeof STAFF_ROLE;

export function isAdministrator(role: string | null | undefined): boolean {
  return role === ADMINISTRATOR_ROLE;
}

export function normaliseStaffRole(role: string | null | undefined): StaffAccessRole {
  if (role === ADMINISTRATOR_ROLE) return ADMINISTRATOR_ROLE;
  return STAFF_ROLE;
}

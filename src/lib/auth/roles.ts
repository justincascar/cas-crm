export const ADMINISTRATOR_ROLE = "administrator";
export const STAFF_ROLE = "staff";
export const DRIVER_ROLE = "driver";
export const MECHANIC_ROLE = "mechanic";

export const STAFF_ACCESS_ROLES = [ADMINISTRATOR_ROLE, STAFF_ROLE, DRIVER_ROLE, MECHANIC_ROLE] as const;

export type StaffAccessRole = (typeof STAFF_ACCESS_ROLES)[number];

export function isAdministrator(role: string | null | undefined): boolean {
  return role === ADMINISTRATOR_ROLE;
}

/** Administrator and staff keep the existing full desk. Driver and mechanic do not. */
export function isOfficeRole(role: string | null | undefined): boolean {
  return role === ADMINISTRATOR_ROLE || role === STAFF_ROLE;
}

export function isDriverRole(role: string | null | undefined): boolean {
  return role === DRIVER_ROLE;
}

export function isMechanicRole(role: string | null | undefined): boolean {
  return role === MECHANIC_ROLE;
}

/** Recoveries, deliveries and collections are done by drivers and by office staff, not only the restricted driver login. */
export function canDoFieldJob(role: string | null | undefined): boolean {
  return role === DRIVER_ROLE || isOfficeRole(role);
}

export function roleLabel(role: string | null | undefined): string {
  if (role === ADMINISTRATOR_ROLE) return "Administrator";
  if (role === STAFF_ROLE) return "Staff";
  if (role === DRIVER_ROLE) return "Driver";
  if (role === MECHANIC_ROLE) return "Bodyshop / mechanic";
  return "Staff";
}

export function normaliseStaffRole(role: string | null | undefined): StaffAccessRole {
  if (role === ADMINISTRATOR_ROLE || role === DRIVER_ROLE || role === MECHANIC_ROLE || role === STAFF_ROLE) return role;
  return STAFF_ROLE;
}

export function parseStaffRole(raw: string): StaffAccessRole | null {
  const role = raw.trim();
  if (role === ADMINISTRATOR_ROLE || role === STAFF_ROLE || role === DRIVER_ROLE || role === MECHANIC_ROLE) return role;
  return null;
}

/** Server-side page allow-list. Office roles may open anything. */
export function pathAllowedForRole(role: string | null | undefined, pathname: string): boolean {
  if (isOfficeRole(role)) return true;
  const path = pathname.split("?")[0] || "/";
  if (path === "/jobs" || path === "/login") return true;
  if (role === DRIVER_ROLE) {
    return (
      /^\/claims\/[^/]+\/handover(\/(photo|start|finish))?$/.test(path) ||
      /^\/documents\/[^/]+(\/file|\/preview|\/preview\/\d+)?$/.test(path)
    );
  }
  if (role === MECHANIC_ROLE) {
    return /^\/claims\/[^/]+\/repair$/.test(path) || /^\/documents\/[^/]+(\/file|\/preview|\/preview\/\d+)?$/.test(path);
  }
  return false;
}

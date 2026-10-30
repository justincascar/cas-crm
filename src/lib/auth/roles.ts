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

/** Stored on staff_permissions. Not implied by the administrator role or by impecuniosity approval. */
export const OVERRIDE_PREHIRE_CHECKS = "overridePreHireChecks";

/**
 * True only when this account has been granted overridePreHireChecks.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canOverridePreHireChecks(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(OVERRIDE_PREHIRE_CHECKS);
}

/**
 * Stored on staff_permissions. Accepting a short payment as the final figure.
 * Not implied by the administrator role.
 */
export const ACCEPT_PAYMENT_SETTLEMENT = "acceptPaymentSettlement";

/**
 * True only when this account has been granted acceptPaymentSettlement.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canAcceptPaymentSettlement(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(ACCEPT_PAYMENT_SETTLEMENT);
}

/**
 * Stored on staff_permissions. Accepting an agreed figure below the claimed figure.
 * Not implied by the administrator role, and not read from the username.
 */
export const APPROVE_SETTLEMENT = "approveSettlement";

/**
 * Stored on staff_permissions. Approving a rebuttal or impecuniosity response (and any letter before action or court
 * document) before it is marked as sent or emailed. Granted to Justin.
 */
export const APPROVE_LEGAL_CORRESPONDENCE = "approveLegalCorrespondence";

/**
 * Stored on staff_permissions. Recording a recovery or storage payment request as sent although the client has not
 * signed the Storage & Recovery Agreement, with a written reason. Justin only (review note R21).
 */
export const OVERRIDE_UNSIGNED_STORAGE_RECOVERY = "overrideUnsignedStorageRecovery";

/**
 * Stored on staff_permissions. Completing a vehicle swap mid-hire without the new signed hire agreement, with a written
 * reason. Justin only (review note R26).
 */
export const OVERRIDE_UNSIGNED_SWAP = "overrideUnsignedSwap";

/**
 * Stored on staff_permissions. Downloading the full export of every claim, person, money line, history entry and
 * document, and opening the audit view of who changed what. Justin only (J12).
 */
export const EXPORT_AND_AUDIT = "exportAndAudit";

/**
 * Stored on staff_permissions. Changing the bank details in Settings.
 * Not implied by the administrator role, and not read from the username.
 */
export const MANAGE_BANK_DETAILS = "manageBankDetails";

/**
 * Stored on staff_permissions. A wait longer than 14 days.
 * Not implied by the administrator role, and not read from the username.
 */
export const EXTENDED_WAIT = "extendedWait";

/**
 * Stored on staff_permissions. Returning the car on a fault claim before the excess is paid.
 * Not implied by the administrator role, and not read from the username.
 */
export const RELEASE_WITHOUT_EXCESS = "releaseWithoutExcess";

/**
 * True only when this account has been granted approveSettlement.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canApproveSettlement(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(APPROVE_SETTLEMENT);
}

/**
 * True only when this account has been granted manageBankDetails.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canManageBankDetails(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(MANAGE_BANK_DETAILS);
}

/**
 * True only when this account has been granted extendedWait.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canExtendedWait(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(EXTENDED_WAIT);
}

/**
 * True only when this account has been granted releaseWithoutExcess.
 * The role is accepted so callers pass it, and it is not consulted.
 */
export function canReleaseWithoutExcess(account: {
  role: string | null | undefined;
  permissions: readonly string[];
}): boolean {
  void account.role;
  return account.permissions.includes(RELEASE_WITHOUT_EXCESS);
}

/** Server-side page allow-list. Office roles may open anything. */
export function pathAllowedForRole(role: string | null | undefined, pathname: string): boolean {
  if (isOfficeRole(role)) return true;
  const path = pathname.split("?")[0] || "/";
  if (path === "/jobs" || path === "/login") return true;
  if (role === DRIVER_ROLE) {
    return (
      /^\/claims\/[^/]+\/handover(\/(photo|start|finish))?$/.test(path) ||
      /^\/claims\/[^/]+\/sign(\/submit|\/readings)?$/.test(path) ||
      /^\/documents\/[^/]+(\/file|\/preview|\/preview\/\d+)?$/.test(path)
    );
  }
  if (role === MECHANIC_ROLE) {
    return (
      /^\/claims\/[^/]+\/repair(\/step)?$/.test(path) ||
      /^\/documents\/[^/]+(\/file|\/preview|\/preview\/\d+)?$/.test(path)
    );
  }
  return false;
}

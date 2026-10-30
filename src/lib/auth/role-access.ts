import type { StaffAccessRole } from "./roles";

/**
 * Who can open what, by role (J12). The server enforces this on every page and file, not only in the menu.
 * scripts/permissions-check.ts signs in as each demonstration person and opens each address directly to prove it;
 * Settings → Who can do what shows the same table. "Justin only" means a permission held on Justin's staff row, not
 * the administrator role.
 */

export type AccessArea = {
  key: string;
  label: string;
  /** An address with :claim and :bankDoc filled in by the check. */
  path: string;
  open: Record<StaffAccessRole, boolean>;
  /** Open only to a person holding the export-and-audit permission. */
  justinOnly?: boolean;
};

const OFFICE = { administrator: true, staff: true, driver: false, mechanic: false };

export const ROLE_ACCESS: AccessArea[] = [
  { key: "desk", label: "Claims desk (dashboard)", path: "/", open: OFFICE },
  { key: "claims", label: "All claims", path: "/claims", open: OFFICE },
  { key: "claim", label: "A claim file", path: "/claims/:claim", open: OFFICE },
  { key: "money", label: "A claim's money", path: "/claims/:claim/money", open: OFFICE },
  { key: "financials", label: "Financials", path: "/financials", open: OFFICE },
  { key: "bank", label: "A client's bank statement (by direct address)", path: "/documents/:bankDoc/file", open: OFFICE },
  { key: "hire", label: "Hire / Fleet", path: "/hire", open: OFFICE },
  { key: "driverJobs", label: "Driver jobs board", path: "/driver-jobs", open: OFFICE },
  { key: "settings", label: "Settings", path: "/settings", open: OFFICE },
  { key: "jobs", label: "My jobs today", path: "/jobs", open: { administrator: true, staff: true, driver: true, mechanic: true } },
  { key: "audit", label: "Audit view", path: "/audit", open: { administrator: true, staff: false, driver: false, mechanic: false }, justinOnly: true },
  { key: "export", label: "Full export", path: "/settings/export", open: { administrator: true, staff: false, driver: false, mechanic: false }, justinOnly: true },
];

/** What each role can do, in plain words, for the Settings page. */
export const ROLE_CAN_DO: Record<StaffAccessRole, string[]> = {
  administrator: [
    "Everything office staff can do.",
    "Justin's own permissions (listed below): for example the full export and audit view, approving legal letters, approving a settlement, managing bank details, and the authorised overrides.",
  ],
  staff: [
    "Open every claim, its money, its documents (including bank statements) and its history.",
    "Record steps, letters, emails, payments, hire and storage; use Settings.",
    "Not the full export, the audit view, or anything that needs one of Justin's permissions.",
  ],
  driver: [
    "My jobs today: their deliveries, collections and recoveries.",
    "Record the handover and the client's signature on the jobs given to them.",
    "Not claims, money, bank statements, the fleet or Settings, even by typing the address.",
  ],
  mechanic: [
    "My jobs today and the workshop steps on the cars given to them.",
    "Not claims, money, bank statements, the fleet or Settings, even by typing the address.",
  ],
};

/** Plain words for each extra permission, for the Settings page. */
export const PERMISSION_LABELS: Record<string, string> = {
  overridePreHireChecks: "override a pre-hire check, with a reason",
  acceptPaymentSettlement: "accept a payment as the final figure",
  approveSettlement: "approve a settlement below the claimed figure",
  approveLegalCorrespondence: "approve legal letters before they are sent",
  overrideUnsignedStorageRecovery: "claim recovery or storage without a signed agreement, with a reason",
  overrideUnsignedSwap: "complete a vehicle swap without the new signed hire agreement, with a reason",
  exportAndAudit: "download the full export and open the audit view",
  manageBankDetails: "change the bank details",
  extendedWait: "set a longer wait on a file",
  releaseWithoutExcess: "return a car before the excess is paid, with a reason",
};

export function permissionWords(keys: string | null): string {
  const list = String(keys || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => PERMISSION_LABELS[key] || key);
  return list.length ? list.join("; ") : "none";
}

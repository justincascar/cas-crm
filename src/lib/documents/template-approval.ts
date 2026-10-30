/**
 * The old intake credit recovery and storage agreement is still marked outstanding. The standalone Storage & Recovery
 * Agreement is built from the supplied Hire Pack wording (R17). No approved wording is invented here.
 */
export const RECOVERY_STORAGE_TEMPLATE = "recovery_storage_agreement";
export const STORAGE_RECOVERY_PACK_TEMPLATE = "storage_recovery";

export const DRAFT_WORDING_NOT_APPROVED = "DRAFT – wording not approved by CAS";

const OUTSTANDING = new Set([RECOVERY_STORAGE_TEMPLATE]);

export function casTemplateApproved(templateKey: string | null | undefined): boolean {
  const key = (templateKey || "").trim();
  if (!key) return true;
  return !OUTSTANDING.has(key);
}

export function unapprovedSendMessage(): string {
  return `This cannot be sent. ${DRAFT_WORDING_NOT_APPROVED}. It can be kept on the file as a draft. Sending is a separate step once CAS-approved wording is in place.`;
}

export function sendBlockedForUnapproved(input: { templateKey?: string | null; body?: string | null }): string | null {
  if (!casTemplateApproved(input.templateKey)) return unapprovedSendMessage();
  if ((input.body || "").includes(DRAFT_WORDING_NOT_APPROVED)) return unapprovedSendMessage();
  return null;
}

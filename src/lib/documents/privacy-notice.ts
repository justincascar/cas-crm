/**
 * The privacy notice slot (J15). The client form and the welcome email show a "Privacy notice" link. The wording is a
 * placeholder until Justin approves it in the J9a wording review; while it is a placeholder the client form cannot be
 * sent to a real client (live email). Nothing here is privacy wording: it only says the wording is awaited.
 */

export const PRIVACY_NOTICE_APPROVED = false;

export const PRIVACY_NOTICE_PLACEHOLDER = "Privacy notice — awaiting approved wording (J9a).";

export const PRIVACY_NOTICE_PATH = "/privacy";

/** The line added to client emails: where the notice is, or that it is awaited. */
export function privacyNoticeLine(origin?: string): string {
  const where = origin ? `${origin.replace(/\/$/, "")}${PRIVACY_NOTICE_PATH}` : PRIVACY_NOTICE_PATH;
  return PRIVACY_NOTICE_APPROVED ? `Privacy notice: ${where}` : `Privacy notice: ${where} (${PRIVACY_NOTICE_PLACEHOLDER})`;
}

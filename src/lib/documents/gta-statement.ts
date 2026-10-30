import { DRAFT_WORDING_NOT_APPROVED } from "./template-approval";

/**
 * CAS is not a GTA subscriber (confirmed by Justin, 29/10/2026). Staff can choose to add this paragraph to the
 * rebuttal letters and the payment pack cover letter. It is off unless ticked.
 *
 * The wording is a draft for Justin to approve (QUESTIONS-FOR-JUSTIN.md). Until he does, the paragraph carries the
 * draft marker, so a letter or email containing it cannot be sent. Set GTA_STATEMENT_APPROVED to true only once he
 * has approved this exact wording.
 */
export const GTA_STATEMENT_TEXT =
  "Complete Accident Solutions Ltd is not a subscriber to the General Terms of Agreement (GTA). GTA rates, rate reductions, protocols and dispute-resolution procedures do not apply to this claim.";

export const GTA_STATEMENT_APPROVED = false;

/** Survives HTML escaping, so a stored letter can be checked for it. */
export const GTA_DRAFT_MARK = `${DRAFT_WORDING_NOT_APPROVED}: the GTA paragraph`;

export const GTA_STATEMENT_DRAFT_NOTE = `(${GTA_DRAFT_MARK} above is waiting for Justin's approval.)`;

/** Insurer correspondence that offers the paragraph. */
export const GTA_STATEMENT_TEMPLATES: readonly string[] = ["rebuttal_rate", "rebuttal_need", "rebuttal_duration", "hire_pack_cover"];

export function offersGtaStatement(templateKey: string | null | undefined): boolean {
  return GTA_STATEMENT_TEMPLATES.includes(String(templateKey || ""));
}

export function gtaStatementParagraph(): string {
  return GTA_STATEMENT_APPROVED ? GTA_STATEMENT_TEXT : `${GTA_STATEMENT_TEXT}\n\n${GTA_STATEMENT_DRAFT_NOTE}`;
}

/** Puts the paragraph just above the sign-off, or at the end when there is none. */
export function withGtaStatement(body: string): string {
  const paragraph = gtaStatementParagraph();
  const signOff = body.search(/^(Yours faithfully|Yours sincerely|Kind regards)/m);
  if (signOff < 0) return `${body.trimEnd()}\n\n${paragraph}\n`;
  return `${body.slice(0, signOff)}${paragraph}\n\n${body.slice(signOff)}`;
}

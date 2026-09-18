import { CAS_EMAIL_SPECS, CAS_LETTER_SPECS } from "./cas-wording";
import { EMAIL_TEMPLATES, isEmailTemplateKey, type EmailTemplateKey } from "./email-templates";
import { LETTER_TEMPLATES, isLetterTemplateKey, type LetterTemplateKey } from "./templates";
import type { CorrespondenceSpec } from "./correspondence";

export const DOCUMENT_TEMPLATES = [...LETTER_TEMPLATES, ...EMAIL_TEMPLATES];

export type DocumentTemplateKey = LetterTemplateKey | EmailTemplateKey;

export function isDocumentTemplateKey(key: string): key is DocumentTemplateKey {
  return isLetterTemplateKey(key) || isEmailTemplateKey(key);
}

export function specForTemplate(key: string): CorrespondenceSpec | null {
  return CAS_LETTER_SPECS.find((item) => item.key === key) || CAS_EMAIL_SPECS.find((item) => item.key === key) || null;
}

export function eventTypeForTemplate(key: string) {
  const listed = DOCUMENT_TEMPLATES.find((item) => item.key === key);
  return listed?.eventType ?? "document_generated";
}

export function channelForTemplate(key: string): "letter" | "email" {
  if (isEmailTemplateKey(key)) return "email";
  return "letter";
}

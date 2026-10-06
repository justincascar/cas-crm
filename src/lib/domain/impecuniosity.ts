import { isAdministrator, isOfficeRole } from "../auth/roles";

/**
 * Wording taken from the mitigation questionnaire already extracted from CAS's Hire Pack
 * (see the hire-pack generator). A filled Hire Pack return uses the same questions.
 * There is no separate "how long" question on that page.
 */
export const MITIGATION_QUESTIONNAIRE = {
  heading: "Mitigation Questionnaire / Statement of Truth",
  audience: "TO BE COMPLETED BY CUSTOMER",
  preamble:
    "Prior to agreeing to enter into the hire agreement my duty to keep my losses to a minimum have been explained to me and",
  noOffer: "I had not received an offer for a replacement vehicle from the at-fault insurer",
  declinedBecause: "I did receive an offer of a replacement vehicle but did not accept it because",
  personalLiability:
    "I understand that if I choose to hire on credit I am personally liable for paying for the hire costs which I would not have incurred had I been offered and accepted a suitable courtesy vehicle from my own motor insurer or legal expenses insurer.",
  needBecause: "I need a hire vehicle because",
  ownVehicle:
    "I believe my own vehicle is unroadworthy and/or unusable and I understand temporary repairs are impractical or uneconomic.",
  noOtherVehicle:
    "I do not have another suitable vehicle available to me, either being my own or through my immediate family.",
  statementOfTruth: "I have read and understood the above and I believe that the answers I have given are true.",
} as const;

/**
 * Drafted close to the Lagden test for Justin to review.
 * It is the question put to the client. It is not a finding.
 */
export const ABILITY_TO_PAY_QUESTION =
  "Could you have paid for a replacement vehicle yourself, without making a sacrifice you could not reasonably have been expected to make?";

export const ABILITY_TO_PAY_REVIEW =
  "Wording for Justin to review. Drafted close to the Lagden test. It records the client's own answer. It does not decide whether the charges can be recovered.";

export const IMPECUNIOSITY_TEMPLATE_KEY = "impecuniosity_disclosure";

/** Phrases that assert impecuniosity. Mentioning the word on its own does not. */
export const IMPECUNIOSITY_ASSERTION_PHRASES = [
  "could not have paid for hire without making sacrifices",
  "i could not reasonably have funded a replacement vehicle from my own resources",
] as const;

export const CHECKLIST_STATUSES = ["not_started", "requested", "partial", "complete"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const EMPLOYMENT_STATUSES = [
  { value: "employed", label: "Employed" },
  { value: "self_employed", label: "Self-employed" },
  { value: "not_employed", label: "Not employed" },
  { value: "retired", label: "Retired" },
  { value: "student", label: "Student" },
  { value: "not_stated", label: "Not stated" },
] as const;

export const ABILITY_ANSWERS = [
  { value: "yes", label: "Yes — the client says they could have paid without that sacrifice" },
  { value: "no", label: "No — the client says they could not have paid without that sacrifice" },
  { value: "not_answered", label: "The client has not answered this" },
] as const;

export const EVIDENCE_KINDS = [
  { value: "bank_account", label: "Bank account" },
  { value: "wage_slips", label: "Wage slips" },
  { value: "benefit_award", label: "Benefit award letter" },
] as const;

export const OFFER_POSITIONS = ["not_answered", "no_offer", "declined"] as const;
export type OfferPosition = (typeof OFFER_POSITIONS)[number];

export const OPERATIONAL_RECORD_NOTICE =
  "This records what the client or a handler has provided. It is not legal advice. A complete checklist does not mean the hire charges will be recovered.";

export const CONCURRENT_EDIT_NOTICE =
  "If two people save this section at the same time, the later save is kept. The CRM does not yet warn that someone else changed it. Earlier dated entries stay.";

export const NO_CLIENT_PORTAL_NOTICE =
  "There is no client form for this yet. Staff enter what the client tells them. A client sending this in themselves is a later stage.";

export function checklistStatusLabel(status: string): string {
  if (status === "requested") return "Requested";
  if (status === "partial") return "Partial";
  if (status === "complete") return "Complete";
  return "Not started";
}

export function isChecklistStatus(value: string): value is ChecklistStatus {
  return (CHECKLIST_STATUSES as readonly string[]).includes(value);
}

export function employmentLabel(value: string): string {
  return EMPLOYMENT_STATUSES.find((item) => item.value === value)?.label || value;
}

export function evidenceKindLabel(value: string): string {
  return EVIDENCE_KINDS.find((item) => item.value === value)?.label || value;
}

export function abilityAnswerLabel(value: string): string {
  return ABILITY_ANSWERS.find((item) => item.value === value)?.label || "The client has not answered this";
}

export function canMarkChecklist(role: string): boolean {
  return isOfficeRole(role);
}

export function canApproveImpecuniosity(role: string): boolean {
  return isAdministrator(role);
}

export function templateReliesOnImpecuniosity(templateKey: string): boolean {
  return templateKey === IMPECUNIOSITY_TEMPLATE_KEY;
}

export function textAssertsImpecuniosity(text: string): boolean {
  const haystack = text.toLowerCase();
  return IMPECUNIOSITY_ASSERTION_PHRASES.some((phrase) => haystack.includes(phrase));
}

function gapSentence(status: ChecklistStatus, approved: boolean): string {
  const gaps: string[] = [];
  if (status !== "complete") {
    gaps.push(`the evidence checklist is ${checklistStatusLabel(status)}, not Complete`);
  }
  if (!approved) gaps.push("an authorised user has not approved relying on impecuniosity");
  return gaps.join(", and ");
}

/** Refuses a generated letter or an email that would assert impecuniosity. */
export function impecuniosityGenerationBlock(status: ChecklistStatus, approved: boolean): string | null {
  if (status === "complete" && approved) return null;
  return `Nothing was produced. This would rely on impecuniosity: ${gapSentence(status, approved)}. A complete checklist is a record of what is held. It does not mean the charges can be recovered.`;
}

/** Shown inside a hire pack that is still produced, with the assertion left out. */
export function impecuniosityWithheldSentence(status: ChecklistStatus, approved: boolean): string {
  if (status === "complete" && approved) return "";
  return `This copy does not rely on impecuniosity: ${gapSentence(status, approved)}. A complete checklist is a record of what is held. It does not mean the charges can be recovered.`;
}

export function clientAbilitySentence(input: {
  question: string;
  answer: string;
  words: string;
  recordedLabel: string;
}): string {
  const words = input.words.trim();
  const extra = words ? ` The client's own words: ${words}` : "";
  return `Client's own answer, recorded ${input.recordedLabel}, to “${input.question}”: ${abilityAnswerLabel(input.answer)}.${extra} This is what the client said. It is not a finding that the charges can be recovered.`;
}

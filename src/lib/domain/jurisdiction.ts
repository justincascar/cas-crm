/** Where the claim would be heard. England & Wales unless staff choose otherwise at intake. */
export const JURISDICTIONS = [
  { value: "england_wales", label: "England & Wales" },
  { value: "scotland", label: "Scotland" },
  { value: "northern_ireland", label: "Northern Ireland" },
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number]["value"];

export function normaliseJurisdiction(value: string | null | undefined): Jurisdiction {
  const found = JURISDICTIONS.find((item) => item.value === String(value || "").trim());
  return found ? found.value : "england_wales";
}

export function jurisdictionLabel(value: string | null | undefined): string {
  return JURISDICTIONS.find((item) => item.value === normaliseJurisdiction(value))?.label || "England & Wales";
}

/**
 * A reminder, not legal advice. Justin is asked for the checklist of what a Northern Ireland court expects
 * (question in QUESTIONS-FOR-JUSTIN.md); nothing more specific is written here until he supplies it.
 */
export const NORTHERN_IRELAND_REMINDER =
  "Northern Ireland file. The court there expects extra evidence. Check with Justin what this file needs before it goes further.";

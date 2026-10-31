/**
 * R51: one fuel list everywhere fuel is entered or shown (client vehicle and fleet; R53 dropped it for third parties).
 * Stored as the label, "Other: <what>", or blank for Not known. Never guessed: a lookup may fill it, staff may change it.
 */
export const FUEL_TYPES = ["Petrol", "Diesel", "Hybrid", "Plug-in hybrid", "Electric", "LPG"] as const;
export const FUEL_OTHER = "Other";
export const FUEL_NOT_KNOWN = "Not known";
export const FUEL_OTHER_PREFIX = "Other: ";

/** Options for a select: Not known first (stored blank), the types, then Other. */
export const FUEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: FUEL_NOT_KNOWN },
  ...FUEL_TYPES.map((type) => ({ value: type, label: type })),
  { value: FUEL_OTHER, label: FUEL_OTHER },
];

const KNOWN: Record<string, string> = {
  petrol: "Petrol",
  unleaded: "Petrol",
  diesel: "Diesel",
  "heavy oil": "Diesel",
  hybrid: "Hybrid",
  "hybrid electric": "Hybrid",
  "petrol hybrid": "Hybrid",
  "petrol/electric": "Hybrid",
  "plug-in hybrid": "Plug-in hybrid",
  "plug in hybrid": "Plug-in hybrid",
  phev: "Plug-in hybrid",
  electric: "Electric",
  "electricity": "Electric",
  ev: "Electric",
  lpg: "LPG",
};

const NOT_KNOWN_WORDS = new Set(["", "unknown", "not known", "n/a", "na", "-", "—"]);

/**
 * The stored value for whatever was typed or held before. A recognised word becomes its label, an unclear one becomes
 * Other with the old text kept, and nothing (or "unknown") is Not known (blank).
 */
export function normaliseFuel(raw: string | null | undefined): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (NOT_KNOWN_WORDS.has(lower)) return "";
  if (KNOWN[lower]) return KNOWN[lower]!;
  const label = FUEL_TYPES.find((type) => type.toLowerCase() === lower);
  if (label) return label;
  if (lower === "other" || lower === "other:") return FUEL_OTHER;
  if (lower.startsWith("other:")) {
    const what = text.slice(text.indexOf(":") + 1).trim();
    return what ? `${FUEL_OTHER_PREFIX}${what}` : FUEL_OTHER;
  }
  return `${FUEL_OTHER_PREFIX}${text}`;
}

/** How a stored fuel is shown on screens, letters, the agreement and the Hire Pack. */
export function fuelLabel(raw: string | null | undefined): string {
  const value = normaliseFuel(raw);
  return value || FUEL_NOT_KNOWN;
}

/** Splits a stored value into the select's choice and the Other box. */
export function fuelChoice(raw: string | null | undefined): { choice: string; other: string } {
  const value = normaliseFuel(raw);
  if (value.startsWith(FUEL_OTHER_PREFIX)) return { choice: FUEL_OTHER, other: value.slice(FUEL_OTHER_PREFIX.length) };
  return { choice: value, other: "" };
}

export function fuelFromChoice(choice: string, other: string): string {
  if (choice === FUEL_OTHER) return other.trim() ? `${FUEL_OTHER_PREFIX}${other.trim()}` : FUEL_OTHER;
  return normaliseFuel(choice);
}

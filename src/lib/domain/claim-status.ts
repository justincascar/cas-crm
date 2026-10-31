/** Staff-set claim facts that later workflow (letters, recovery, hire) will branch on. */

export const LIABILITY_STATUS_OPTIONS = [
  { value: "", label: "Not yet known" },
  { value: "fault", label: "Fault" },
  { value: "non_fault", label: "Non-fault" },
  { value: "split", label: "Split (shared liability)" },
  { value: "disputed", label: "Disputed" },
] as const;

export const ROADWORTHINESS_OPTIONS = [
  { value: "", label: "Not yet known" },
  { value: "roadworthy", label: "Roadworthy" },
  { value: "unroadworthy", label: "Unroadworthy" },
] as const;

export type LiabilityStatus = (typeof LIABILITY_STATUS_OPTIONS)[number]["value"];
export type RoadworthinessStatus = (typeof ROADWORTHINESS_OPTIONS)[number]["value"];

const LIABILITY_VALUES = new Set<string>(LIABILITY_STATUS_OPTIONS.map((row) => row.value));
const ROADWORTHINESS_VALUES = new Set<string>(ROADWORTHINESS_OPTIONS.map((row) => row.value));

/** Older stored values that mean “staff have not yet chosen”, not Fault or Roadworthy. */
const UNSET_LIABILITY = new Set(["", "unknown", "n/a", "na", "none", "-"]);
const UNSET_ROADWORTHINESS = new Set(["", "unknown", "awaiting_assessment", "needs_review", "n/a", "na", "none", "-"]);

export function normalizeLiabilityStatus(raw: string | null | undefined): LiabilityStatus {
  const value = (raw || "").trim();
  if (UNSET_LIABILITY.has(value)) return "";
  if (LIABILITY_VALUES.has(value)) return value as LiabilityStatus;
  return "";
}

export function normalizeRoadworthiness(raw: string | null | undefined): RoadworthinessStatus {
  const value = (raw || "").trim();
  if (UNSET_ROADWORTHINESS.has(value)) return "";
  if (ROADWORTHINESS_VALUES.has(value)) return value as RoadworthinessStatus;
  return "";
}

export function liabilityStatusLabel(raw: string | null | undefined): string {
  const value = normalizeLiabilityStatus(raw);
  return LIABILITY_STATUS_OPTIONS.find((row) => row.value === value)?.label || "Not yet known";
}

/**
 * R64: on a Split file, the third party's share of liability as a whole percentage (1–99), or null when not yet agreed
 * or proposed. Blank is allowed: the letters then show the percentages as still needed.
 */
export function parseSplitPercent(raw: string | number | null | undefined): number | null {
  const text = String(raw ?? "").trim().replace(/%$/, "");
  if (!text) return null;
  if (!/^\d{1,2}$/.test(text) || Number(text) < 1 || Number(text) > 99) {
    throw new Error("Enter the third party's share of liability as a whole percentage from 1 to 99, for example 50.");
  }
  return Number(text);
}

/** "50 / 50": the third party's share, then the client's. */
export function splitShareWords(tpPercent: number | null | undefined): { tp: string; client: string } | null {
  if (tpPercent == null) return null;
  return { tp: `${tpPercent}%`, client: `${100 - tpPercent}%` };
}

export function roadworthinessLabel(raw: string | null | undefined): string {
  const value = normalizeRoadworthiness(raw);
  return ROADWORTHINESS_OPTIONS.find((row) => row.value === value)?.label || "Not yet known";
}

export function statusChangeDetails(label: string, fromRaw: string | null | undefined, toRaw: string | null | undefined): string {
  const from = label === "Liability status" ? liabilityStatusLabel(fromRaw) : roadworthinessLabel(fromRaw);
  const to = label === "Liability status" ? liabilityStatusLabel(toRaw) : roadworthinessLabel(toRaw);
  if (from === to) return "";
  if (from === "Not yet known") return `Set to ${to}.`;
  return `Changed from ${from} to ${to}.`;
}

const UNSET_TEXT = "not yet recorded";

export function freeTextChangeDetails(fromRaw: string | null | undefined, toRaw: string | null | undefined): string {
  const from = (fromRaw || "").trim() || UNSET_TEXT;
  const to = (toRaw || "").trim() || UNSET_TEXT;
  if (from === to) return "";
  if (from === UNSET_TEXT) return `Set to ${to}.`;
  if (to === UNSET_TEXT) return `Cleared (was ${from}).`;
  return `Changed from ${from} to ${to}.`;
}

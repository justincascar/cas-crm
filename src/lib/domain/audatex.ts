import { normalizeLiabilityStatus } from "./claim-status";
import { isUsableInsurerName } from "../insurers";

export type AudatexCodeSuggestion = {
  value: string;
  insurerName: string;
  sourceClaimId: string;
  sourceFileReference: string;
};

/** Exact name as typed, after trim. "Aviva" and "Aviva Insurance" do not match. */
export function exactInsurerName(name: string | null | undefined): string {
  const trimmed = (name || "").trim();
  if (!isUsableInsurerName(trimmed)) return "";
  return trimmed;
}

/**
 * Which insurer the Audatex codes belong to on this file:
 * own insurer on Fault, first TPI on Non-fault. Disputed / not yet decided: none.
 */
export function audatexInsurerNameForClaim(params: {
  liabilityStatus: string | null | undefined;
  ownInsurerName: string | null | undefined;
  tpInsurerName: string | null | undefined;
}): string {
  const liability = normalizeLiabilityStatus(params.liabilityStatus);
  if (liability === "fault") return exactInsurerName(params.ownInsurerName);
  if (liability === "non_fault") return exactInsurerName(params.tpInsurerName);
  return "";
}

/** Saved value on this file wins. Suggestion is only used when this file has none yet. */
export function displayAudatexCode(
  saved: string | null | undefined,
  suggestion: AudatexCodeSuggestion | null | undefined,
): { value: string; suggestion: AudatexCodeSuggestion | null } {
  const current = (saved || "").trim();
  if (current) return { value: current, suggestion: null };
  const proposed = suggestion?.value.trim() || "";
  if (proposed && suggestion) return { value: proposed, suggestion };
  return { value: "", suggestion: null };
}

/**
 * GTA reference ceilings for hires starting 1 July 2026 – 30 June 2027.
 * These replace the July 2025 – June 2026 workbook (GTA-Grouping-Car-Rates-wef-1st-July-2025).
 * That older file is not the current table. Figures are maximum daily rates excluding VAT, in pence.
 * This list ends at SP10. SP11–SP13 were only in the 2025–26 workbook and are not carried forward.
 */

export const GTA_RATE_EFFECTIVE_FROM = "2026-07-01";
export const GTA_RATE_EFFECTIVE_TO = "2027-06-30";
export const GTA_RATE_PERIOD_LABEL = "1 July 2026 – 30 June 2027";
export const GTA_MARKUP_PERCENT_DEFAULT = 30;
export const GTA_NOT_CLASSIFIED = "not classified";

/** Group code → ceiling in pence for 1 July 2026 – 30 June 2027. */
export const GTA_REFERENCE_RATES_PENCE: Record<string, number> = {
  S1: 4232,
  S2: 4799,
  S3: 5118,
  S4: 5488,
  S5: 5805,
  S6: 6186,
  S7: 8674,
  M: 5666,
  M1: 6549,
  M2: 7468,
  M3: 8777,
  M4: 10358,
  M5: 15537,
  M6: 19681,
  F1: 11210,
  F2: 11174,
  F3: 12946,
  F4: 15882,
  F5: 19863,
  F6: 22347,
  F7: 26071,
  F8: 27934,
  F9: 34141,
  P1: 8461,
  P2: 10135,
  P3: 10784,
  P4: 13122,
  P5: 15230,
  P6: 17226,
  P7: 20093,
  P8: 22962,
  P9: 26409,
  P10: 32496,
  P11: 45642,
  P12: 68320,
  P13: 99065,
  SP1: 6928,
  SP2: 7532,
  SP3: 9048,
  SP4: 10330,
  SP5: 11286,
  SP6: 14992,
  SP7: 16810,
  SP8: 18627,
  SP9: 20444,
  SP10: 23397,
};

export const GTA_GROUPS = Object.keys(GTA_REFERENCE_RATES_PENCE);

export function normaliseGtaGroup(value: string | null | undefined): string | null {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return null;
  return GTA_REFERENCE_RATES_PENCE[text] != null ? text : null;
}

export function gtaRatePence(group: string | null | undefined): number | null {
  const code = normaliseGtaGroup(group);
  if (!code) return null;
  return GTA_REFERENCE_RATES_PENCE[code];
}

/** GTA ceiling × (1 + markup%). Rounded to the nearest penny. */
export function standardDailyRatePence(group: string | null | undefined, markupPercent: number): number | null {
  const ceiling = gtaRatePence(group);
  if (ceiling == null) return null;
  const percent = Number.isFinite(markupPercent) ? markupPercent : GTA_MARKUP_PERCENT_DEFAULT;
  return Math.round((ceiling * (100 + percent)) / 100);
}

/** True when the charged group's GTA ceiling is higher than the client's own group. */
export function groupChargedAboveClient(charged: string | null | undefined, clientGroup: string | null | undefined): boolean {
  const chargedRate = gtaRatePence(charged);
  const clientRate = gtaRatePence(clientGroup);
  if (chargedRate == null || clientRate == null) return false;
  if (normaliseGtaGroup(charged) === normaliseGtaGroup(clientGroup)) return false;
  return chargedRate > clientRate;
}

export function gtaGroupLabel(group: string | null | undefined): string {
  return normaliseGtaGroup(group) || GTA_NOT_CLASSIFIED;
}

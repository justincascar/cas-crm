export type ComplianceCheckResult = {
  registration: string;
  taxStatus: string;
  motStatus: string;
  insuranceStatus: string;
  warnings: string[];
  source: string;
  simulated: boolean;
};

export interface ComplianceLookup {
  name: string;
  simulated: boolean;
  check(registration: string): Promise<ComplianceCheckResult>;
}

/**
 * Simulated tax / MOT / insurance status for the prototype.
 * Does not scrape DVLA, MID or AskMID. Insurance remains unknown until staff record an authorised lookup.
 */
export class SimulatedComplianceLookup implements ComplianceLookup {
  name = "Simulated tax, MOT and insurance check";
  simulated = true;

  async check(registration: string): Promise<ComplianceCheckResult> {
    const reg = registration.toUpperCase().replace(/\s+/g, " ").trim();
    const known: Record<string, Pick<ComplianceCheckResult, "taxStatus" | "motStatus">> = {
      "CF64 DLE": { taxStatus: "Taxed (simulated)", motStatus: "MOT valid (simulated)" },
      "SA12 CWA": { taxStatus: "Taxed (simulated)", motStatus: "MOT due soon (simulated)" },
      "WN12 PSH": { taxStatus: "Untaxed (simulated)", motStatus: "MOT expired (simulated)" },
      "CF71 ABC": { taxStatus: "Taxed (simulated)", motStatus: "MOT valid (simulated)" },
    };
    const row = known[reg];
    return {
      registration: reg || "Unknown",
      taxStatus: row?.taxStatus || "Unknown — confirm on GOV.UK",
      motStatus: row?.motStatus || "Unknown — confirm on GOV.UK",
      insuranceStatus: "Unknown — record the authorised AskMID / MID result. This check does not identify cover.",
      warnings: [
        "Simulated prototype result — not a live DVLA or MID enquiry.",
        "Do not scrape AskMID. Staff should use the authorised lookup and record the insurer here.",
        "Vehicle lookup does not identify the registered keeper.",
      ],
      source: "simulated",
      simulated: true,
    };
  }
}

export const complianceLookup: ComplianceLookup = new SimulatedComplianceLookup();

export const GOV_MOT_URL = "https://www.gov.uk/check-mot-history";
export const GOV_TAX_URL = "https://www.gov.uk/check-vehicle-tax";
export const ASK_MID_URL = "https://www.askmid.com/";

export type VehicleLookupResult = {
  registration: string;
  make?: string;
  model?: string;
  fuel?: string;
  colour?: string;
  bodyType?: string;
  year?: string;
  transmission?: string;
  seats?: number;
  incomplete: boolean;
  warnings: string[];
  source: string;
};

export interface VehicleLookup {
  name: string;
  simulated: boolean;
  lookup(registration: string): Promise<VehicleLookupResult | null>;
}

/**
 * Simulated registration lookup. Does not identify the keeper.
 * Incomplete results must not have transmission inferred.
 */
export class SimulatedVehicleLookup implements VehicleLookup {
  name = "Simulated registration lookup";
  simulated = true;

  async lookup(registration: string): Promise<VehicleLookupResult | null> {
    const reg = registration.toUpperCase().replace(/\s+/g, " ").trim();
    const known: Record<string, Omit<VehicleLookupResult, "warnings" | "source" | "incomplete">> = {
      "CF64 DLE": { registration: "CF64 DLE", make: "BMW", model: "320i", fuel: "petrol", colour: "black", bodyType: "saloon", year: "2019" },
      "SA12 CWA": { registration: "SA12 CWA", make: "Volkswagen", model: "Golf", fuel: "diesel", colour: "white", bodyType: "hatchback", year: "2018" },
      "WN12 PSH": { registration: "WN12 PSH", make: "Peugeot", model: "208", fuel: "petrol", colour: "white", bodyType: "hatchback", year: "2014" },
    };
    const row = known[reg];
    if (!row) {
      return {
        registration: reg,
        incomplete: true,
        warnings: [
          "Simulated lookup: no match. Enter details manually.",
          "Registration lookup does not identify the registered keeper.",
        ],
        source: "simulated",
      };
    }
    return {
      ...row,
      incomplete: true,
      transmission: undefined,
      warnings: [
        "Simulated prototype result — not a live DVLA/VDI enquiry.",
        "Transmission was not returned. Do not infer it.",
        "This lookup does not identify the registered keeper.",
      ],
      source: "simulated",
    };
  }
}

export const vehicleLookup: VehicleLookup = new SimulatedVehicleLookup();

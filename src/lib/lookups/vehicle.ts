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

const NO_KEY_WARNING =
  "No live DVLA vehicle lookup is connected yet. Type the make, colour, tax and MOT. Registration lookup does not identify the registered keeper.";

/**
 * Simulated registration lookup used until a DVLA key is issued and wired.
 * Does not identify the keeper. Incomplete results must not have transmission inferred.
 */
export class SimulatedVehicleLookup implements VehicleLookup {
  name = "Manual vehicle details (DVLA not connected)";
  simulated = true;

  async lookup(registration: string): Promise<VehicleLookupResult | null> {
    const reg = registration.toUpperCase().replace(/\s+/g, " ").trim();
    if (!reg) {
      return {
        registration: "",
        incomplete: true,
        warnings: ["Enter a registration, or type the vehicle details."],
        source: "manual",
      };
    }
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
        warnings: [NO_KEY_WARNING],
        source: "manual",
      };
    }
    return {
      ...row,
      incomplete: true,
      transmission: undefined,
      warnings: [
        "Demonstration result only — not a live DVLA enquiry. Check and type any missing details.",
        "Transmission was not returned. Do not infer it.",
        "This lookup does not identify the registered keeper.",
      ],
      source: "simulated",
    };
  }
}

export function createVehicleLookup(): VehicleLookup {
  const key = (process.env.DVLA_API_KEY || process.env.DVLA_VES_API_KEY || "").trim();
  if (!key) return new SimulatedVehicleLookup();
  // Live DVLA is not wired yet. A key must not be treated as a working integration.
  return new SimulatedVehicleLookup();
}

export const vehicleLookup: VehicleLookup = createVehicleLookup();

export const VEHICLE_MANUAL_HINT = NO_KEY_WARNING;

import { formatVehicleRegistration } from "../text";

/** A stored vehicle counts as recorded when registration, make or model is more than a blank or "Unknown". */
export function vehicleIsRecorded(fields: {
  registration?: string | number | null;
  make?: string | number | null;
  model?: string | number | null;
}): boolean {
  return [fields.registration, fields.make, fields.model].some((value) => meaningful(value) !== null);
}

export const CLIENT_VEHICLE_EMPTY = "Not yet recorded";
export const THIRD_PARTY_VEHICLE_EMPTY = "Not recorded";

export type VehicleSpecLine = { label: string; value: string };

function meaningful(value: string | number | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "unknown") return null;
  return text.replaceAll("_", " ");
}

export function vehicleSummary(fields: {
  registration?: string | number | null;
  make?: string | number | null;
  model?: string | number | null;
}): string {
  if (!vehicleIsRecorded(fields)) return "";
  const registration = meaningful(fields.registration);
  const name = [meaningful(fields.make), meaningful(fields.model)].filter(Boolean).join(" ");
  return [registration ? formatVehicleRegistration(registration) : "", name].filter(Boolean).join(" · ");
}

export function vehicleSpecLines(fields: {
  colour?: string | number | null;
  transmission?: string | number | null;
  fuel?: string | number | null;
  bodyType?: string | number | null;
  seats?: string | number | null;
  engineCc?: string | number | null;
  vehicleClass?: string | number | null;
  gtaGroup?: string | number | null;
  taxStatus?: string | number | null;
  motStatus?: string | number | null;
  insuranceRecorded?: string | number | null;
}): VehicleSpecLine[] {
  const lines: VehicleSpecLine[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    const text = meaningful(value);
    if (text) lines.push({ label, value: text });
  };
  add("Colour", fields.colour);
  add("Gearbox", fields.transmission);
  add("Fuel", fields.fuel);
  add("Body", fields.bodyType);
  add("Seats", fields.seats);
  add("Engine", fields.engineCc ? `${fields.engineCc} cc` : null);
  add("Class", fields.vehicleClass);
  add("GTA group", fields.gtaGroup);
  add("Tax", fields.taxStatus);
  add("MOT", fields.motStatus);
  add("Insurance recorded", fields.insuranceRecorded);
  return lines;
}

export type ThirdPartyVehicleCard = {
  id: string;
  title: string;
  recorded: boolean;
  summary: string;
  lines: VehicleSpecLine[];
  editScreen: "tp1" | "tp2" | null;
};

export function thirdPartyVehicleCards(
  parties: Array<Record<string, string | number | null>>,
): ThirdPartyVehicleCard[] {
  if (parties.length === 0) {
    return [
      {
        id: "none",
        title: "Third-party vehicle",
        recorded: false,
        summary: "",
        lines: [],
        editScreen: "tp1",
      },
    ];
  }
  return parties.map((party, index) => {
    const sequence = Number(party.sequence) || index + 1;
    const name = meaningful(party.full_name);
    const fields = {
      registration: party.tp_registration,
      make: party.tp_make,
      model: party.tp_model,
    };
    const recorded = vehicleIsRecorded(fields);
    return {
      id: String(party.id || `tp-${sequence}`),
      title: name ? `Third party ${sequence} — ${name}` : `Third party ${sequence}`,
      recorded,
      summary: recorded ? vehicleSummary(fields) : "",
      lines: recorded
        ? vehicleSpecLines({
            colour: party.tp_colour,
            transmission: party.tp_transmission,
            fuel: party.tp_fuel,
            bodyType: party.tp_body_type,
            seats: party.tp_seats,
            engineCc: party.tp_engine_cc,
            vehicleClass: party.tp_vehicle_class,
            taxStatus: party.tp_tax_status,
            motStatus: party.tp_mot_status,
          })
        : [],
      editScreen: sequence === 1 ? "tp1" : sequence === 2 ? "tp2" : null,
    };
  });
}

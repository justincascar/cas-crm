import { DEFAULT_VEHICLE_LOCATION } from "../constants";

export function isBlankVehicleLocation(value: string | null | undefined): boolean {
  const trimmed = (value || "").trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return lower === "unknown" || lower === "[not yet on file]";
}

export function joinVehicleLocationParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter((part) => !isBlankVehicleLocation(part))
    .join(", ");
}

/** Use a recorded location when present; otherwise the configurable CAS premises default. */
export function resolveVehicleLocation(
  recorded: string | null | undefined,
  fallback: string = DEFAULT_VEHICLE_LOCATION,
): string {
  if (!isBlankVehicleLocation(recorded)) return String(recorded).trim();
  const trimmedFallback = fallback.trim();
  return trimmedFallback || DEFAULT_VEHICLE_LOCATION;
}

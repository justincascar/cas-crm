export const WEATHER_OPTIONS = [
  { value: "dry", label: "Dry" },
  { value: "wet", label: "Wet" },
  { value: "raining", label: "Raining" },
  { value: "snow", label: "Snow" },
  { value: "ice", label: "Ice" },
  { value: "fog", label: "Fog/mist" },
  { value: "glare", label: "Bright sun/glare" },
  { value: "other", label: "Other" },
] as const;

export const JOURNEY_OPTIONS = [
  { value: "social", label: "Social/domestic" },
  { value: "commuting", label: "Commuting" },
  { value: "business", label: "Business" },
  { value: "taxi", label: "Taxi/private hire" },
  { value: "delivery", label: "Delivery/courier" },
  { value: "goods", label: "Carrying goods" },
  { value: "other", label: "Other" },
] as const;

export const ROAD_SURFACE_OPTIONS = [
  { value: "dry", label: "Dry" },
  { value: "wet", label: "Wet" },
  { value: "icy", label: "Icy" },
  { value: "snow", label: "Snow" },
  { value: "flooded", label: "Flooded" },
  { value: "other", label: "Other" },
] as const;

export const LIGHTING_OPTIONS = [
  { value: "daylight", label: "Daylight" },
  { value: "street", label: "Dark – street lights on" },
  { value: "dark", label: "Dark – no street lights" },
  { value: "dusk", label: "Dusk/dawn" },
] as const;

export function choiceLabel(options: readonly { value: string; label: string }[], value: string | null | undefined): string {
  const found = options.find((item) => item.value === value);
  return found?.label || (value || "").trim();
}

/** Other keeps the typed words. A listed choice keeps its label. */
export function storedChoice(input: {
  value: string | null | undefined;
  other: string | null | undefined;
  options: readonly { value: string; label: string }[];
}): { error: string | null; stored: string | null } {
  const value = (input.value || "").trim();
  if (!value) return { error: null, stored: null };
  if (value === "other") {
    const typed = (input.other || "").trim();
    if (!typed) return { error: "Type what Other means.", stored: null };
    return { error: null, stored: `Other: ${typed}` };
  }
  const known = input.options.find((item) => item.value === value);
  if (!known) return { error: "Choose one of the listed answers.", stored: null };
  return { error: null, stored: known.label };
}

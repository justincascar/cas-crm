export const ADDRESS_NEEDED = "Address needed";

/** "Unknown" was stored for a blank address on older files. It is treated as blank, never shown. */
export function addressPart(value: string | number | null | undefined): string {
  const text = String(value ?? "").trim();
  return !text || text.toLowerCase() === "unknown" ? "" : text;
}

/** One line for display. A blank address reads "Address needed", never "Unknown". */
export function addressLine(line1: unknown, town: unknown, postcode: unknown): string {
  const parts = [line1, town, postcode].map((part) => addressPart(part as string | null | undefined)).filter(Boolean);
  return parts.length ? parts.join(", ") : ADDRESS_NEEDED;
}

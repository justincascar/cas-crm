export type TextKind = "registration" | "postcode" | "email" | "words" | "plain";

const SKIP_TYPES = new Set([
  "date",
  "time",
  "datetime-local",
  "number",
  "gbp",
  "checkbox",
  "select",
  "hidden",
  "file",
  "radio",
]);

function isRegistrationName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("dateofregistration") || n.includes("date_of_registration")) return false;
  return n.includes("registration") || n.endsWith("reg") || n.endsWith("_vrm") || n.includes("vrm");
}

export function kindForField(name: string, type?: string): TextKind {
  if (type && SKIP_TYPES.has(type)) return "plain";
  if (type === "email") return "email";
  const n = name.toLowerCase();
  if (n.includes("email")) return "email";
  if (n.includes("postcode")) return "postcode";
  if (isRegistrationName(name)) return "registration";
  if (
    /(tel|phone|mobile|dob|speed|licence|license|ninumber|policynumber|reference|ref$|_ref)/i.test(n)
  ) {
    return "plain";
  }
  return "words";
}

/** Vehicle registration: capitals only. */
export function formatVehicleRegistration(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

export function formatVehicleRegistrationLive(value: string): string {
  return value.toUpperCase();
}

export function formatPostcode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

export function formatPostcodeLive(value: string): string {
  return value.toUpperCase();
}

export function isCompleteUkPostcode(value: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(value.trim());
}

export function formatEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Each word starts with a capital letter; the rest of the word is lower case. */
export function toStartCase(value: string): string {
  return toStartCaseLive(value).trim();
}

export function toStartCaseLive(value: string): string {
  return value.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ]+)*/g, (word) =>
    word
      .split("'")
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
      .join("'"),
  );
}

export function formatTypedValue(name: string, value: string, type?: string): string {
  if (!value) return value;
  const kind = kindForField(name, type);
  switch (kind) {
    case "registration":
      return formatVehicleRegistration(value);
    case "postcode":
      return formatPostcode(value);
    case "email":
      return formatEmail(value);
    case "words":
      return toStartCase(value);
    default:
      return value;
  }
}

export function formatTypedValueLive(name: string, value: string, type?: string): string {
  const kind = kindForField(name, type);
  if (kind === "registration") return formatVehicleRegistrationLive(value);
  if (kind === "postcode") return formatPostcodeLive(value);
  if (kind === "email") return value.toLowerCase();
  if (kind === "words") return toStartCaseLive(value);
  return value;
}

export function readFormText(formData: FormData, name: string, type?: string): string {
  return formatTypedValue(name, String(formData.get(name) || ""), type);
}

/**
 * R62: driving licence numbers.
 *
 * A GB licence number is 16 characters:
 *  1–5   the first five letters of the surname, padded with 9s
 *  6–11  the date of birth: decade digit of the year, month (plus 5 on the first digit for women), day, last digit of the year
 *  12–13 two initials, padded with 9
 *  14    a digit
 *  15–16 two check characters
 * A Northern Ireland licence number is 8 digits. A licence from another country is taken as printed.
 */

const GB_PATTERN = /^[A-Z9]{5}\d{6}[A-Z9]{2}\d[A-Z0-9]{2}$/;
const NI_PATTERN = /^\d{8}$/;

export type LicenceOrigin = "gb" | "ni" | "other";

const NI_WORDS = new Set(["NI", "NORTHERN IRELAND", "N IRELAND", "N. IRELAND"]);

/** Which kind of licence the boxes describe. Not ticked "Not a GB licence" means a GB licence. */
export function licenceOrigin(notGb: string | undefined | null, issuingCountry: string | undefined | null): LicenceOrigin {
  if (String(notGb || "") !== "yes") return "gb";
  return NI_WORDS.has(String(issuingCountry || "").trim().toUpperCase()) ? "ni" : "other";
}

export function compactLicenceNumber(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

/**
 * The format problem with a licence number as typed, or null. A wrong format is refused when it is entered: it is a
 * typing mistake or the wrong document. Nothing is guessed or corrected.
 */
export function licenceFormatError(
  value: string | null | undefined,
  origin: LicenceOrigin,
  issuingCountry?: string | null,
): string | null {
  const number = compactLicenceNumber(value);
  if (!number) return null;
  if (origin === "gb") {
    if (number.length !== 16) {
      return `A GB licence number is 16 letters and numbers; this one has ${number.length}. Check it against the licence. For a Northern Ireland or foreign licence, tick "Not a GB licence" and enter the issuing country.`;
    }
    if (!GB_PATTERN.test(number)) {
      return 'This is not in the GB licence number format (5 letters of the surname, 6 digits of the date of birth, 2 initials, a digit and 2 check characters). Check it against the licence, or tick "Not a GB licence".';
    }
    return null;
  }
  if (origin === "ni") {
    return NI_PATTERN.test(number) ? null : "A Northern Ireland licence number is 8 digits. Check it against the licence.";
  }
  if (!String(issuingCountry || "").trim()) return "Enter the country that issued the licence.";
  if (!/^[A-Z0-9-]{4,20}$/.test(number)) return "Enter the licence number as printed on the licence: letters and numbers only, up to 20.";
  return null;
}

/** The surname part a GB licence number starts with. "Mac" is written "MC" by DVLA, so both are accepted. */
function surnameParts(surname: string): string[] {
  const letters = surname.toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) return [];
  const pad = (text: string) => (text.slice(0, 5) + "99999").slice(0, 5);
  const parts = [pad(letters)];
  if (letters.startsWith("MAC")) parts.push(pad(`MC${letters.slice(3)}`));
  return parts;
}

/**
 * Where a GB licence number does not match the surname or date of birth on the file. Not an error: the number is kept
 * and the licence check is never blocked. The mismatch is shown for a person to review.
 */
export function licenceMismatches(input: {
  number: string | null | undefined;
  origin: LicenceOrigin;
  surname?: string | null;
  dateOfBirth?: string | null;
}): string[] {
  const number = compactLicenceNumber(input.number);
  if (input.origin !== "gb" || !GB_PATTERN.test(number)) return [];
  const out: string[] = [];
  const parts = surnameParts(String(input.surname || ""));
  if (parts.length && !parts.includes(number.slice(0, 5))) {
    out.push(`it starts ${number.slice(0, 5)}, but the surname on the file gives ${parts[0]}`);
  }
  const dob = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.dateOfBirth || ""));
  if (dob) {
    const [, year, month, day] = dob;
    const code = number.slice(5, 11);
    const man = `${year![2]}${month}${day}${year![3]}`;
    const woman = `${year![2]}${String(Number(month) + 50)}${day}${year![3]}`;
    if (code !== man && code !== woman) out.push(`its date-of-birth digits (${code}) do not match the date of birth on the file`);
  }
  return out;
}

/** The licence boxes on the claim screens: number, the "Not a GB licence" tick and the issuing country. */
export const LICENCE_BOXES: Array<{ screen: string; number: string; notGb: string; country: string; name?: string; dob: string; surname?: string }> = [
  { screen: "client", number: "licenceNumber", notGb: "licenceNotGb", country: "issuingCountry", dob: "dob", surname: "surname" },
  { screen: "additional-drivers", number: "d1LicenceNumber", notGb: "d1LicenceNotGb", country: "d1IssuingCountry", name: "d1Name", dob: "d1Dob" },
  { screen: "additional-drivers", number: "d2LicenceNumber", notGb: "d2LicenceNotGb", country: "d2IssuingCountry", name: "d2Name", dob: "d2Dob" },
];

/** The surname from a full name typed in one box: the last word. */
export function surnameFromFullName(name: string | null | undefined): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[words.length - 1]! : "";
}

/** One plain sentence for staff, or "" when there is nothing to review. */
export function licenceMismatchSentence(name: string, mismatches: string[]): string {
  if (!mismatches.length) return "";
  return `Check ${name}'s licence number: ${mismatches.join("; ")}. It has been kept; check it against the licence.`;
}

export const MOBILE_MAX_DIGITS = 11;
export const MOBILE_REQUIRED_DIGITS = 11;

export function isMobileFieldName(name: string): boolean {
  return /mobile/i.test(name);
}

export function mobileDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

export function clipMobileNumber(value: string): string {
  return mobileDigits(value).slice(0, MOBILE_MAX_DIGITS);
}

export function mobileNumberError(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const digits = mobileDigits(raw);
  if (digits.length > MOBILE_MAX_DIGITS) {
    return `A mobile number can have at most ${MOBILE_MAX_DIGITS} digits.`;
  }
  if (digits.length < MOBILE_REQUIRED_DIGITS) {
    return `That mobile number is too short. Use ${MOBILE_REQUIRED_DIGITS} digits.`;
  }
  return null;
}

const SAVE_ANYWAY = " Use Save anyway for an overseas number.";

/**
 * A telephone box: mobile, or a general number that may be a landline or a mobile.
 * A skip tick box and a Save anyway tick box are not telephone numbers.
 * A template name is not a telephone number.
 */
export function isPhoneBoxName(name: string): boolean {
  if (!name || /template/i.test(name)) return false;
  if (name.startsWith("saveAnyway_")) return false;
  if (/skip/i.test(name)) return false;
  return /mobile|telephone|phone|tel/i.test(name);
}

/** The other-number box paired with a "there is no number" tick. */
export function skippedOtherNumberName(fieldName: string): string | null {
  if (!fieldName.endsWith("otherTel")) return null;
  return `${fieldName.slice(0, -"otherTel".length)}skipOtherTel`;
}

/** National form starting with 0, or null when it does not start with 0 or +44. */
export function ukNationalNumber(value: string | null | undefined): string | null {
  const compact = (value || "").trim().replace(/[\s()-]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+44")) {
    const rest = compact.slice(3).replace(/\D/g, "");
    if (!rest) return null;
    return `0${rest}`;
  }
  if (compact.startsWith("0")) {
    const digits = compact.replace(/\D/g, "");
    return digits || null;
  }
  return null;
}

/**
 * One check for every phone box.
 * A mobile must start 07 or +447 and be 11 national digits.
 * A general phone accepts a UK landline or mobile (0 or +44, 10 or 11 digits).
 * Empty is left alone. A failure is a warning, not a silent block.
 */
export function phoneFieldError(name: string, value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const mobile = isMobileFieldName(name);
  const national = ukNationalNumber(raw);
  if (mobile) {
    if (national && /^07\d{9}$/.test(national)) return null;
    if (raw.startsWith("+") || raw.startsWith("00")) {
      return `A mobile number starts with 07 or +447 and has the right length.${SAVE_ANYWAY}`;
    }
    const existing = mobileNumberError(raw);
    if (existing) return `${existing}${SAVE_ANYWAY}`;
    if (!national?.startsWith("07")) {
      return `A mobile number starts with 07 or +447.${SAVE_ANYWAY}`;
    }
    return `A mobile number starts with 07 or +447 and has the right length.${SAVE_ANYWAY}`;
  }
  if (!national || !/^0\d{9,10}$/.test(national)) {
    return `That does not look like a UK number. It should start with 0 or +44 and be the right length.${SAVE_ANYWAY}`;
  }
  return null;
}

export function saveAnywayFieldName(fieldName: string): string {
  return `saveAnyway_${fieldName}`;
}

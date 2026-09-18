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

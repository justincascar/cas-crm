import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

export const TIMEZONE = "Europe/London";

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function londonNow(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

export function startOfLondonDay(date = new Date()): Date {
  return startOfDay(toZonedTime(date, TIMEZONE));
}

export function londonDateIso(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
}

/** Today's calendar date in Europe/London (yyyy-MM-dd). */
export function londonTodayIso(asAt = new Date()): string {
  return londonDateIso(asAt);
}

export function isFutureLondonDate(dateYmd: string, asAt = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return false;
  return dateYmd > londonTodayIso(asAt);
}

export function accidentDateError(dateYmd: string | null | undefined, asAt = new Date()): string | null {
  const value = (dateYmd || "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter the accident date as a valid calendar date.";
  if (isFutureLondonDate(value, asAt)) {
    return "An accident date cannot be after today. Use today's date or an earlier date.";
  }
  return null;
}

export function utcFromLondonDateTime(dateTimeLocal: string): string {
  // dateTimeLocal: "2026-09-15T09:30" interpreted as Europe/London
  const asUtc = fromZonedTime(dateTimeLocal, TIMEZONE);
  return asUtc.toISOString();
}

export function formatUkDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return formatInTimeZone(d, TIMEZONE, "dd/MM/yyyy");
}

export function formatUkDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return formatInTimeZone(d, TIMEZONE, "dd/MM/yyyy HH:mm");
}

export function addCalendarDaysIso(iso: string, days: number): string {
  return addDays(new Date(iso), days).toISOString();
}

export function daysBetweenLondon(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(
    toZonedTime(new Date(toIso), TIMEZONE),
    toZonedTime(new Date(fromIso), TIMEZONE),
  );
}

export function isSameLondonDay(iso: string, comparedTo = new Date()): boolean {
  return londonDateIso(new Date(iso)) === londonDateIso(comparedTo);
}

export function isBeforeLondonDay(iso: string, comparedTo = new Date()): boolean {
  return londonDateIso(new Date(iso)) < londonDateIso(comparedTo);
}

export function isoDaysFromNow(days: number, hours = 9, minutes = 0): string {
  const london = londonNow();
  london.setHours(hours, minutes, 0, 0);
  const shifted = addDays(london, days);
  return fromZonedTime(shifted, TIMEZONE).toISOString();
}

export function isoDateFromNow(days: number): string {
  return londonDateIso(addDays(londonNow(), days));
}

/** Accepts a date (yyyy-MM-dd) or datetime-local value as Europe/London. */
export function occurredFromForm(value: string | null | undefined): string {
  if (!value) return nowUtcIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return utcFromLondonDateTime(`${value}T09:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return utcFromLondonDateTime(value.slice(0, 16));
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return nowUtcIso();
  return parsed.toISOString();
}

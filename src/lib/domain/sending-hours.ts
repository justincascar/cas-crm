/**
 * Chaser sending hours, in Europe/London. A chase email is only sent inside these hours.
 * The days and times are a Settings value. Monday to Friday, 09:00 to 17:00 until CAS confirms them.
 */
export type SendingHours = { days: number[]; start: string; end: string };

export const SENDING_HOURS_SETTING = "chase_sending_hours";
export const DEFAULT_SENDING_HOURS: SendingHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Stored as "1,2,3,4,5 09:00-17:00". Anything unreadable falls back to the default. */
export function parseSendingHours(raw: string | null | undefined): SendingHours {
  const match = /^([0-6](?:,[0-6])*) (\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(String(raw || "").trim());
  if (!match || !validTime(match[2]) || !validTime(match[3]) || match[2] >= match[3]) return { ...DEFAULT_SENDING_HOURS };
  const days = [...new Set(match[1].split(",").map(Number))].sort();
  return { days, start: match[2], end: match[3] };
}

export function formatSendingHoursSetting(hours: SendingHours): string {
  return `${hours.days.join(",")} ${hours.start}-${hours.end}`;
}

export function sendingHoursFromForm(days: string[], start: string, end: string): SendingHours {
  const picked = [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  if (picked.length === 0) throw new Error("Tick at least one day for sending.");
  if (!validTime(start) || !validTime(end)) throw new Error("Enter the sending times as hours and minutes.");
  if (start >= end) throw new Error("The sending window must end after it starts.");
  return { days: picked, start, end };
}

function londonParts(at: Date): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, time: `${get("hour")}:${get("minute")}` };
}

export function insideSendingHours(at: Date, hours: SendingHours): boolean {
  const { day, time } = londonParts(at);
  return hours.days.includes(day) && time >= hours.start && time < hours.end;
}

export function describeSendingHours(hours: SendingHours): string {
  const names = hours.days.map((day) => DAY_NAMES[day]);
  const weekdays = hours.days.join(",") === "1,2,3,4,5";
  return `${weekdays ? "Monday to Friday" : names.join(", ")}, ${hours.start} to ${hours.end}`;
}

export function outsideSendingHoursMessage(hours: SendingHours): string {
  return `Chasers are only sent ${describeSendingHours(hours)}. Nothing was sent. Send it inside those hours.`;
}

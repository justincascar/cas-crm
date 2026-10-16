import { formatUkDate, londonDateIso, londonTodayIso } from "../dates";
import { realLondonDays } from "./repair-progress";

export type DueTone = "overdue" | "today" | "soon" | "future" | "waiting" | "unknown";

export type DueWording = {
  text: string;
  tone: DueTone;
  /** Days past the due date. 0 is due today. A negative number is days until a future date. */
  sortDays: number;
};

/** Calendar day in Europe/London. A date-only value is that day, not the UTC midnight before it. */
export function londonDayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return londonDateIso(parsed);
}

/**
 * How a due date is said on the dashboard.
 * The next day is 1. The same day is due today. A future date is not overdue.
 * Inclusive day counts are for charges only and are not used here.
 */
export function dueWording(dueAt: string | null | undefined, today = londonTodayIso()): DueWording {
  const day = londonDayOf(dueAt);
  if (!day) return { text: "Unknown", tone: "unknown", sortDays: 0 };
  if (day === today) return { text: "Due today", tone: "today", sortDays: 0 };
  if (day < today) {
    const days = realLondonDays(day, today);
    return {
      text: days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`,
      tone: "overdue",
      sortDays: days,
    };
  }
  const until = realLondonDays(today, day);
  if (until <= 2) return { text: formatUkDate(day), tone: "soon", sortDays: -until };
  return { text: formatUkDate(day), tone: "future", sortDays: -until };
}

/** Red overdue, amber due within 2 days, green later, grey waiting. */
export function dueTextClass(tone: DueTone): string {
  if (tone === "overdue") return "font-semibold text-overdue";
  if (tone === "today" || tone === "soon") return "font-semibold text-warn";
  if (tone === "future") return "font-semibold text-ok";
  if (tone === "waiting") return "font-semibold text-slate";
  return "";
}

export function dueRowClass(tone: DueTone): string {
  if (tone === "overdue") return "bg-[#f8ecec]";
  if (tone === "today" || tone === "soon") return "bg-[#fff6e8]";
  if (tone === "future") return "bg-[#eef6ee]";
  if (tone === "waiting") return "bg-[#eceae4]";
  return "";
}

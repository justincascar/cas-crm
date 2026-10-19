import { formatUkDate, formatUkTime } from "../dates";
import { formatGbp } from "../money";

export const INHERITED_NOTE_FLAG_PREFIX = "Inherited recovery charge needs review:";
export const RECOVERY_TIME_FLAG_PREFIX = "Recovery time needs review:";

/** Pounds typed in a note, such as 195 or £195.00. Does not invent a company or VAT. */
export function amountTypedInNote(note: string | null | undefined): number | null {
  const text = (note || "").trim();
  if (!text) return null;
  const match = text.match(/£?\s*(\d{1,7}(?:\.\d{1,2})?)/);
  if (!match) return null;
  const pounds = Number.parseFloat(match[1]);
  if (!Number.isFinite(pounds) || pounds <= 0) return null;
  return Math.round(pounds * 100);
}

/**
 * A note with an amount and no company is flagged. The amount stays visible.
 * Company and VAT are not guessed.
 */
export function inheritedNoteFlag(input: {
  note: string | null | undefined;
  company?: string | null;
}): string | null {
  if ((input.company || "").trim()) return null;
  const pence = amountTypedInNote(input.note);
  if (pence == null) return null;
  const pounds = pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2);
  return `${INHERITED_NOTE_FLAG_PREFIX} £${pounds} was typed in a note`;
}

export function recoveryInstant(date: string | null | undefined, time: string | null | undefined, occurredAt: string | null | undefined): string | null {
  if (occurredAt && !date) return occurredAt;
  return null;
}

/** Refuses a new recovery that is before the accident. Does not rewrite a time already stored. */
export function recoveryBeforeAccidentMessage(accidentAt: string | null | undefined, recoveryAt: string | null | undefined): string | null {
  if (!accidentAt || !recoveryAt) return null;
  const accident = new Date(accidentAt);
  const recovery = new Date(recoveryAt);
  if (Number.isNaN(accident.getTime()) || Number.isNaN(recovery.getTime())) return null;
  if (recovery.getTime() >= accident.getTime()) return null;
  return `Recovery cannot be before the accident. The accident was at ${formatUkTime(accidentAt)} on ${formatUkDate(accidentAt)} and the recovery is ${formatUkTime(recoveryAt)} on ${formatUkDate(recoveryAt)}.`;
}

/** An existing recovery stored before the accident is flagged. The stored time is not changed. */
export function recoveryTimeFlag(accidentAt: string | null | undefined, recoveryAt: string | null | undefined): string | null {
  if (!accidentAt || !recoveryAt) return null;
  const accident = new Date(accidentAt);
  const recovery = new Date(recoveryAt);
  if (Number.isNaN(accident.getTime()) || Number.isNaN(recovery.getTime())) return null;
  if (recovery.getTime() >= accident.getTime()) return null;
  return `${RECOVERY_TIME_FLAG_PREFIX} ${formatUkTime(recoveryAt)} is before the accident at ${formatUkTime(accidentAt)}`;
}

export function inheritedLineLabel(company: string): string {
  return `Inherited charge (paid to ${company.trim()})`;
}

export function formatReviewPounds(pence: number): string {
  return formatGbp(pence);
}

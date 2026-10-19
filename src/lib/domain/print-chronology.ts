import { formatUkDate } from "../dates";
import { eventLabel } from "./events";
import { dispatchFromHistoryNote } from "./justification-chronology";

/**
 * A clean dated list for an insurer chase.
 * Generated and simulated items keep the existing dispatch rules.
 * A letter before action is left out. Nothing here is marked sent unless the history already says it was sent.
 */

const STEP_TYPES = [
  "file_opened",
  "recovery_completed",
  "hire_started",
  "initial_letter_tp_insurer",
  "initial_letter_own_insurer",
  "engineer_instructed",
  "engineer_report_received",
  "repair_estimate_agreed_with_client",
  "total_loss_agreed_confirmed",
  "engineer_report_sent_to_insurer",
  "total_loss_notice_sent",
  "repair_authorisation_requested",
  "repairs_authorised",
  "repairs_started",
  "repairs_complete",
  "vehicle_returned",
  "hire_ended",
  "storage_ended",
  "storage_end_date_confirmed",
  "total_loss_payment_received",
  "hire_payment_request_sent",
  "storage_payment_request_sent",
  "recovery_payment_request_sent",
  "repair_payment_request_sent",
  "settlement_payment_request_sent",
  "step_not_needed",
] as const;

const MESSAGE_TYPES = [
  "outgoing_email",
  "incoming_email",
  "outgoing_whatsapp",
  "incoming_whatsapp",
  "outgoing_call",
  "incoming_call",
  "incoming_letter",
  "call_logged",
  "client_welcome_sent",
  "liability_chase_sent",
  "liability_response_chase_sent",
  "engineer_report_chase_sent",
  "repair_authorisation_chase_sent",
  "hire_payment_reminder_sent",
  "storage_payment_reminder_sent",
  "recovery_payment_reminder_sent",
  "repair_payment_reminder_sent",
  "settlement_payment_reminder_sent",
] as const;

const KEPT = new Set<string>([...STEP_TYPES, ...MESSAGE_TYPES]);

export type PrintChronologyEvent = {
  id: string;
  event_type: string;
  title: string;
  details: string | null;
  occurred_at: string;
};

export type PrintChronologyLine = {
  id: string;
  date: string;
  text: string;
  dispatch: "generated" | "sent" | "not_sent" | null;
};

export function isLetterBeforeAction(event: { event_type: string; title: string; details: string | null }): boolean {
  const title = event.title || "";
  const type = event.event_type || "";
  if (type === "letter_before_action") return true;
  if (/letter before action/i.test(title) && !/not a letter before action/i.test(title)) return true;
  const details = event.details || "";
  if (/^letter before action\b/i.test(details)) return true;
  return false;
}

/** How the line may be described. A simulated or generated item is not "sent". */
export function printDispatch(details: string | null | undefined): "generated" | "sent" | "not_sent" | null {
  const text = details || "";
  const stored = dispatchFromHistoryNote(text);
  if (stored === "generated") return "generated";
  if (/not sent/i.test(text) || /simulated/i.test(text)) return "not_sent";
  if (stored === "sent") return "sent";
  return null;
}

function dispatchWords(dispatch: PrintChronologyLine["dispatch"]): string {
  if (dispatch === "generated") return "Generated, not sent";
  if (dispatch === "not_sent") return "Not sent";
  if (dispatch === "sent") return "Sent";
  return "";
}

export function printChronology(events: PrintChronologyEvent[]): PrintChronologyLine[] {
  const lines = events
    .filter((event) => KEPT.has(event.event_type) && !isLetterBeforeAction(event))
    .map((event) => {
      const dispatch = printDispatch(event.details);
      const words = dispatchWords(dispatch);
      const title = event.title || eventLabel(event.event_type);
      return {
        id: event.id,
        date: formatUkDate(event.occurred_at),
        text: words ? `${title}. ${words}` : title,
        dispatch,
        occurredAt: event.occurred_at,
      };
    });
  lines.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1));
  return lines.map(({ occurredAt: _occurredAt, ...line }) => line);
}

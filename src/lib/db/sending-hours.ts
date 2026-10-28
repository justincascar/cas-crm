import { CHASE_KINDS, chaseDefinition } from "../domain/chase";
import {
  SENDING_HOURS_SETTING,
  insideSendingHours,
  outsideSendingHoursMessage,
  formatSendingHoursSetting,
  parseSendingHours,
  sendingHoursFromForm,
  type SendingHours,
} from "../domain/sending-hours";
import { chaseForClaim } from "./chase";
import { get, run } from "./connection";
import { totalLossPaymentChaseTemplateKey } from "./follow-up-chases";

export function getSendingHours(): SendingHours {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [SENDING_HOURS_SETTING]);
  return parseSendingHours(row?.value);
}

export function setSendingHours(days: string[], start: string, end: string): SendingHours {
  const hours = sendingHoursFromForm(days, start, end);
  run(
    `INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SENDING_HOURS_SETTING, formatSendingHoursSetting(hours)],
  );
  return hours;
}

/**
 * Checked immediately before a chase email goes. A real send outside the sending hours is refused. Every chase is
 * worked out again from the file first: one with a reply on file, paused or cancelled is not sent. However long a
 * chase has been due, one email goes and the clock restarts from that send, so there is no backlog after an outage.
 */
export function chaseSendRefusal(input: { claimId: string; templateKey: string | null; live: boolean; at?: Date }): string | null {
  const templateKey = String(input.templateKey || "");
  const kind = CHASE_KINDS.find((item) => chaseDefinition(item).templateKey === templateKey) || null;
  const chaser = Boolean(kind) || templateKey.startsWith("document_chase_") || templateKey === totalLossPaymentChaseTemplateKey();
  if (!chaser) return null;
  if (input.live) {
    const hours = getSendingHours();
    if (!insideSendingHours(input.at || new Date(), hours)) return outsideSendingHoursMessage(hours);
  }
  // A payment chase has its own fuller check at the point of sending.
  if (kind && !chaseDefinition(kind).paymentHead) {
    const fresh = chaseForClaim(kind, input.claimId);
    if (!fresh) return "This chase no longer applies to the file. Nothing was sent.";
    if (fresh.outcomeOnFile || fresh.handlerState === "paused" || fresh.handlerState === "cancelled") {
      return `${fresh.reason} Nothing was sent.`;
    }
  }
  return null;
}

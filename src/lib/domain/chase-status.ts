/**
 * How each email row's status reads on screen (R34). Codes stay in the database; people see plain words.
 * "Sent" is shown only where a real mailbox confirmed it.
 */
export const CHASE_COMBINED_STATUS = "combined_chase_item";

const SENT_STATUS_WORDS: Record<string, string> = {
  prepared_not_sent: "Prepared, not sent",
  sending: "Sending",
  handler_marked_sent: "Marked as sent by staff",
  sent: "Sent from CAS's mailbox",
  simulated_sent: "Simulated (not sent to a real mailbox)",
  simulated_logged: "Recorded only (simulated)",
  simulated_received: "Simulated incoming",
  received: "Received",
  failed: "Not sent (failed)",
  [CHASE_COMBINED_STATUS]: "Included in a combined chaser",
  logged: "Recorded",
};

export function sentStatusWords(status: string | null | undefined): string {
  const key = String(status || "").trim();
  if (!key) return "—";
  return SENT_STATUS_WORDS[key] || key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

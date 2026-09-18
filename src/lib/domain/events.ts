export const CLAIM_EVENT_TYPES = [
  { key: "file_opened", label: "File opened" },
  { key: "accident", label: "Accident" },
  { key: "client_welcome_sent", label: "Client welcome sent" },
  { key: "initial_letter_tp_insurer", label: "Initial letter to third-party insurer" },
  { key: "liability_chase_sent", label: "Liability chase sent" },
  { key: "engineer_instructed", label: "Engineer instructed" },
  { key: "engineer_report_received", label: "Engineer report received" },
  { key: "internal_chase_sent", label: "Internal chase sent" },
  { key: "repairs_authorised", label: "Repair authorisation received" },
  { key: "repairs_started", label: "Repairs started" },
  { key: "repairs_complete", label: "Repairs complete" },
  { key: "vehicle_ready_notice_sent", label: "Vehicle ready notice sent" },
  { key: "vehicle_returned", label: "Repaired vehicle returned to customer" },
  { key: "hire_started", label: "Hire / courtesy started" },
  { key: "hire_ended", label: "Hire ended" },
  { key: "hire_pack_sent", label: "Hire pack sent" },
  { key: "payment_chase_1_sent", label: "Payment chase 1 sent" },
  { key: "payment_chase_2_sent", label: "Payment chase 2 sent" },
  { key: "rebuttal_sent", label: "Rebuttal sent" },
  { key: "total_loss_cessation_sent", label: "Total-loss cessation sent" },
  { key: "client_total_loss_update_sent", label: "Client total-loss update sent" },
  { key: "client_status_update_sent", label: "Client status update sent" },
  { key: "recovery_completed", label: "Recovery completed" },
  { key: "storage_started", label: "Vehicle entered storage" },
  { key: "storage_ended", label: "Storage ended" },
  { key: "outgoing_email", label: "Email sent" },
  { key: "incoming_email", label: "Email received" },
  { key: "outgoing_whatsapp", label: "WhatsApp sent" },
  { key: "incoming_whatsapp", label: "WhatsApp received" },
  { key: "outgoing_call", label: "Call made" },
  { key: "incoming_call", label: "Call received" },
  { key: "incoming_letter", label: "Letter received" },
  { key: "offer_received", label: "Offer received" },
  { key: "handed_to_solicitors", label: "Handed to solicitors" },
  { key: "case_closed", label: "Case closed" },
  { key: "document_generated", label: "Document generated" },
  { key: "liability_status_changed", label: "Liability status changed" },
  { key: "roadworthiness_changed", label: "Roadworthiness changed" },
  { key: "other", label: "Other" },
] as const;

export type ClaimEventType = (typeof CLAIM_EVENT_TYPES)[number]["key"];

export const KEY_DATE_TYPES: ClaimEventType[] = [
  "accident",
  "initial_letter_tp_insurer",
  "engineer_instructed",
  "engineer_report_received",
  "repairs_started",
  "repairs_complete",
  "hire_started",
  "hire_pack_sent",
  "total_loss_cessation_sent",
];

export function eventLabel(key: string): string {
  return CLAIM_EVENT_TYPES.find((t) => t.key === key)?.label || key.replaceAll("_", " ");
}

export type ChronologyDateMap = Partial<Record<ClaimEventType, string>>;

export function latestDates(events: Array<{ event_type: string; occurred_at: string }>): ChronologyDateMap {
  const map: ChronologyDateMap = {};
  for (const event of events) {
    const current = map[event.event_type as ClaimEventType];
    if (!current || event.occurred_at > current) {
      map[event.event_type as ClaimEventType] = event.occurred_at;
    }
  }
  return map;
}

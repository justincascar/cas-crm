export const CLAIM_EVENT_TYPES = [
  { key: "file_opened", label: "File opened" },
  { key: "accident", label: "Accident" },
  { key: "client_welcome_sent", label: "Client welcome sent" },
  { key: "initial_letter_tp_insurer", label: "Initial letter to third-party insurer" },
  { key: "initial_letter_own_insurer", label: "Initial letter to client's own insurer" },
  { key: "liability_chase_sent", label: "Liability chase sent" },
  { key: "liability_response_received", label: "Liability decision received" },
  { key: "liability_response_received_cleared", label: "Liability decision — cleared (correction)" },
  { key: "liability_response_chase_sent", label: "Liability response chase marked as sent" },
  { key: "liability_response_chase_paused", label: "Liability response chase paused" },
  { key: "liability_response_chase_resumed", label: "Liability response chase resumed" },
  { key: "liability_response_chase_cancelled", label: "Liability response chase cancelled" },
  { key: "engineer_instructed", label: "Engineer instructed" },
  { key: "engineer_report_received", label: "Engineer report received" },
  { key: "total_loss_figures_recorded", label: "Total-loss engineer's figures recorded" },
  { key: "total_loss_agreed_confirmed", label: "Total-loss agreed amount confirmed" },
  { key: "engineer_report_received_cleared", label: "Engineer report received — cleared (correction)" },
  { key: "engineer_report_chase_sent", label: "Engineer report chase marked as sent" },
  { key: "engineer_chase_paused", label: "Engineer report chase paused" },
  { key: "engineer_chase_resumed", label: "Engineer report chase resumed" },
  { key: "engineer_chase_cancelled", label: "Engineer report chase cancelled" },
  { key: "repair_authorisation_requested", label: "Repair authorisation / payment requested" },
  { key: "repair_payment_received", label: "Repair payment received" },
  { key: "repairs_authorised_cleared", label: "Repair authorisation / payment — cleared (correction)" },
  { key: "repair_authorisation_chase_sent", label: "Repair authorisation chase marked as sent" },
  { key: "repair_authorisation_chase_paused", label: "Repair authorisation chase paused" },
  { key: "repair_authorisation_chase_resumed", label: "Repair authorisation chase resumed" },
  { key: "repair_authorisation_chase_cancelled", label: "Repair authorisation chase cancelled" },
  { key: "internal_chase_sent", label: "Internal chase sent" },
  { key: "repairs_authorised", label: "Repair authorisation received" },
  { key: "repairs_started", label: "Repairs started" },
  { key: "repairs_complete", label: "Repairs complete" },
  { key: "vehicle_ready_notice_sent", label: "Vehicle ready notice sent" },
  { key: "vehicle_returned", label: "Repaired vehicle returned to customer" },
  { key: "hire_started", label: "Hire / courtesy started" },
  { key: "hire_ended", label: "Hire ended" },
  { key: "hire_end_date_review", label: "Hire end date needs a check" },
  { key: "hire_end_date_confirmed", label: "Hire end date confirmed" },
  { key: "hire_agreement_renewed", label: "Hire agreement renewed" },
  { key: "hire_agreement_renewal_cleared", label: "Hire agreement renewal — cleared (correction)" },
  { key: "hire_agreement_renewal_chase_sent", label: "Hire agreement renewal chase marked as sent" },
  { key: "hire_agreement_renewal_chase_paused", label: "Hire agreement renewal chase paused" },
  { key: "hire_agreement_renewal_chase_resumed", label: "Hire agreement renewal chase resumed" },
  { key: "hire_agreement_renewal_chase_cancelled", label: "Hire agreement renewal chase cancelled" },
  { key: "hire_pack_sent", label: "Hire pack sent" },
  { key: "payment_chase_1_sent", label: "Payment chase 1 sent" },
  { key: "payment_chase_2_sent", label: "Payment chase 2 sent" },
  { key: "rebuttal_sent", label: "Rebuttal sent" },
  { key: "total_loss_cessation_sent", label: "Total-loss cessation sent" },
  { key: "client_total_loss_update_sent", label: "Client total-loss update sent" },
  { key: "client_status_update_sent", label: "Client status update sent" },
  { key: "recovery_completed", label: "Recovery completed" },
  { key: "storage_started", label: "Vehicle entered storage" },
  { key: "storage_recovery_date_review", label: "Recovery date needs a check" },
  { key: "storage_recovery_date_confirmed", label: "Recovery date confirmed" },
  { key: "storage_end_date_review", label: "Storage end date needs a check" },
  { key: "storage_end_date_confirmed", label: "Storage end date confirmed" },
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
  { key: "hire_group_charged_override", label: "Group Charged set above the client's own vehicle group" },
  { key: "vehicle_handover_recorded", label: "Vehicle handover recorded" },
  { key: "vehicle_handover_finished", label: "Vehicle handover finished" },
  { key: "vehicle_handover_photos_added", label: "Condition photographs added to a handover" },
  { key: "vehicle_handover_scan_added", label: "Diagnostic scan attached to a handover" },
  { key: "liability_status_changed", label: "Liability status changed" },
  { key: "roadworthiness_changed", label: "Roadworthiness changed" },
  { key: "audatex_network_code_changed", label: "Audatex network code changed" },
  { key: "audatex_work_provider_code_changed", label: "Audatex work provider code changed" },
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

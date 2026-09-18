---
trigger: Final payment received from third-party insurer — this is the stop condition for all chasing on the case
audience: client (and internal record)
channel: email
---

Subject: Your claim {{claim_ref}} is now settled

Dear {{client_name}},

Good news — we've received full settlement of {{final_settlement_amount}} from the other
driver's insurer, and your claim, reference {{claim_ref}}, is now closed.

{{closing_summary}} (e.g. confirmation there's nothing further owed by you, or details of any
excess/balance already handled).

Thank you for instructing {{company_name}} — we hope the repair (or replacement, in the case of
a total loss) has gone smoothly. If you're ever unfortunate enough to need us again, you know
where we are.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}

---
Internal note for CRM automation: receipt of this payment is the trigger to stop all chase
sequences (05, 06) and mark {{claim_ref}} as closed. See 17-workflow-stage-map.md.

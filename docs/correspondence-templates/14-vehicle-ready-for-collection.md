---
trigger: Repair completed
audience: client
channel: email
---

Subject: Good news — your vehicle is ready — {{claim_ref}}

Dear {{client_name}},

Your {{vehicle_make_model}} ({{vehicle_reg}}) has now been repaired and is ready for
collection/delivery.

- Ready from: {{ready_date}}
- Location: {{collection_location}}
- {{collection_or_delivery_instructions}}

Please arrange to return the replacement hire vehicle at the same time, in the condition it
was provided (fuel level, no new damage), to avoid any additional charges.

If the collection date or arrangements don't work for you, let us know as soon as possible so
we can adjust.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}

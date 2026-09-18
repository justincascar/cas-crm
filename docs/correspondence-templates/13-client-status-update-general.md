---
trigger: Periodic case update (e.g. every 14 days while case is active, or on stage change)
audience: client
channel: email
---

Subject: Update on your claim {{claim_ref}}

Dear {{client_name}},

Just a quick update on where things stand with your claim for {{vehicle_make_model}}
({{vehicle_reg}}):

Current stage: {{current_stage_label}} (e.g. "vehicle in for repair", "hire pack sent to the
other insurer", "awaiting payment").

{{stage_specific_detail}}

There's nothing you need to do at this stage — we'll be in touch as soon as there's a
meaningful update, or sooner if we need anything from you. If anything has changed on your end
(contact details, how you're using the replacement vehicle, etc.), please let us know.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}

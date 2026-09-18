---
trigger: Vehicle recovered/in storage and ready for assessment
audience: engineer
channel: email
---

Subject: Engineer instruction — {{claim_ref}} — {{vehicle_reg}}

Dear {{engineer_name}},

We'd like to instruct you to inspect the following vehicle and provide a full repair report,
including a damage schedule, repair method, parts required, and labour hours.

- Claim reference: {{claim_ref}}
- Vehicle: {{vehicle_make_model}}, registration {{vehicle_reg}}
- Accident date: {{accident_date}}
- Vehicle location: {{vehicle_location}}
- Access/contact on site: {{site_contact_name}} ({{site_contact_phone}})

Please could you confirm a date for inspection and provide your report within
{{report_turnaround_days}} days of inspection. If you identify the vehicle is a likely total
loss, please flag this to us immediately rather than waiting for the full report, so we can
manage the replacement vehicle accordingly.

Please send the completed report, with photographs, to {{company_email}} referencing
{{claim_ref}} in the subject line.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}

import type { CorrespondenceSpec } from "./correspondence";

/** CAS supplied wording from docs/correspondence-templates. Copied as supplied — not paraphrased. */

export const CAS_LETTER_SPECS: CorrespondenceSpec[] = [
  {
    key: "initial_tp_insurer",
    title: "Non-fault initial letter (third-party insurer)",
    channel: "letter",
    audience: "insurer",
    eventType: "initial_letter_tp_insurer",
    legalCitations: false,
    required: ["client_name", "accident_date", "tp_insurer_name", "vehicle_reg"],
    // Structure follows the supplied Initial Letter ERS.doc. File-specific facts from that example are not copied.
    required: ["client_name", "accident_date", "tp_insurer_name", "vehicle_reg"],
    subject: "Uninsured losses — {{claim_ref}}",
    body: `Our Reference: {{our_reference}}

Policy Number: {{tp_policy_number}}
Our Client: {{client_name}}
Our Insured's Vehicle: {{vehicle_make_model}} {{vehicle_reg}}
Their Insured's Vehicle: {{tp_vehicle}}
Date, time and location of Accident: {{accident_date}}

Dear Sir / Madam

We act on behalf of {{client_name}} in respect of uninsured losses arising from the above road traffic accident.

Accordingly, we place you on notice of our client's claim.

Our client's claim includes {{losses_claimed}}. Supporting documentation follows by covering email.

We should be grateful if you would please:

1. Provide your claim reference
2. Confirm that you are the correct insurer / handler
3. Confirm that indemnity is in place
4. Confirm your position on liability

All future correspondence regarding this matter should be directed to ourselves.

Yours faithfully

{{sender_name}}
{{sender_title}}
{{company_name}}`,
  },
  {
    key: "engineer_instruction",
    title: "Engineer instruction",
    channel: "letter",
    audience: "engineer",
    eventType: "engineer_instructed",
    legalCitations: false,
    required: ["vehicle_reg", "accident_date", "engineer_name", "vehicle_location"],
    subject: "Engineer instruction — {{claim_ref}} — {{vehicle_reg}}",
    body: `Dear {{engineer_name}},

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
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "hire_pack_cover",
    title: "Hire pack cover letter",
    channel: "letter",
    audience: "insurer",
    eventType: "hire_pack_sent",
    legalCitations: false,
    required: [
      "client_name",
      "accident_date",
      "tp_insurer_name",
      "tp_claim_ref",
      "hire_start_date",
      "hire_end_date",
      "daily_rate",
      "total_hire_days",
      "total_hire_charge",
      "repair_cost",
      "report_date",
    ],
    subject: "Hire Pack & Repair Costs — {{claim_ref}} — {{client_name}}",
    body: `Dear Sirs,

**Our client: {{client_name}} | Your insured: {{tp_insured_name}} | Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

Following our letter of {{notification_date}}, please find enclosed our full hire pack and
repair invoice in support of this claim:

1. Signed hire agreement, {{hire_start_date}} to {{hire_end_date}} ({{total_hire_days}} days at
   {{daily_rate}}/day, total **{{total_hire_charge}}**)
2. Engineer's report dated {{report_date}}
3. Repair invoice {{invoice_ref}}, total **{{repair_cost}}**
4. Basic hire rate evidence supporting the rate charged
5. Mileage and usage records for the hire vehicle

In summary:

- **Need**: our client required a replacement vehicle for {{need_summary}} — their own vehicle
  being undriveable/off the road for the reasons set out in the engineer's report.
- **Duration**: hire ran for {{total_hire_days}} days, matching the repair timeline documented
  in the enclosed report and correspondence with the repairer/engineer. We have taken
  reasonable steps throughout to keep the hire period to a minimum.
- **Rate**: the rate charged is supported by the enclosed basic hire rate evidence and reflects
  a reasonable market rate for a like-for-like vehicle.

We request settlement of **{{total_claim_amount}}** within {{due_date}}. Please let us know if
you require anything further to progress this claim, or if you dispute any element of it —
in which case, please set out your reasons so we can respond directly.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_address}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "rebuttal_rate",
    title: "Rebuttal — hire rate",
    channel: "letter",
    audience: "insurer",
    eventType: "rebuttal_sent",
    legalCitations: true,
    required: ["tp_claim_ref", "daily_rate", "their_letter_date"],
    subject: "Re: {{claim_ref}} — Rate Dispute",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

Thank you for your letter of {{their_letter_date}} disputing the hire rate charged.

The rate charged of {{daily_rate}}/day is supported by the basic hire rate evidence already
provided, drawn from {{bhr_evidence_source}}, reflecting the lowest reasonably available rate
from a mainstream/local supplier at the relevant time — consistent with the approach set out in
**Stevens v Equity Syndicate Management Ltd** [2015] EWCA Civ 93.

We would draw your attention to:

- **Dimond v Lovell** [2000] 2 All ER 897 and **Copley v Lawn** [2009] EWCA Civ 580 —
  recoverable hire costs are properly assessed at the equivalent spot/basic hire rate, which is
  what has been claimed here.
- **Neil McBride v UK Insurance Ltd; Peter Clayton v EUI Ltd** [2017] EWCA Civ 144 — courts
  apply a non-exacting standard to basic hire rate evidence; we do not consider {{their_objection_summary}}
  meets the threshold to displace the rate evidence provided.
- **Bunting v Zurich** [2020] EWHC 1807 (QB) — a challenge to BHR evidence lacking real
  substance should not succeed.

If you have specific, comparable rate evidence of your own that you say undermines ours, please
provide it and we will review it. Otherwise, we invite you to withdraw this element of the
dispute and settle the claim on the basis already presented.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "rebuttal_need",
    title: "Rebuttal — need to hire",
    channel: "letter",
    audience: "insurer",
    eventType: "rebuttal_sent",
    legalCitations: true,
    required: ["tp_claim_ref", "their_letter_date", "need_evidence_summary"],
    subject: "Re: {{claim_ref}} — Need Disputed",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

Thank you for your letter of {{their_letter_date}} disputing the need for a replacement
vehicle.

Our client's need is evidenced as follows: {{need_evidence_summary}} (e.g. sole vehicle,
day-to-day use for work/family/commuting, no suitable alternative available).

We accept, per **Singh v Yaqubi** [2013] EWCA Civ 23, that need is not self-proving and rests
with the claimant to establish — which is why the above evidence has been provided. We do not
accept that {{their_objection_summary}} is sufficient to defeat need on these facts, per
**Watson Norie Ltd v Shaw & Nelson** (1967) 1 Lloyd's Rep 515, which requires only that the
hire be reasonably necessary to fill the actual transport gap our client faced.

If you say a cheaper or more readily available alternative existed (**Lagden v O'Connor**
[2003] UKHL 64), please specify what that alternative was and its cost, and we will consider
this against the evidence.

Please confirm your position, or settle this element of the claim, within {{due_date}}.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "rebuttal_duration",
    title: "Rebuttal — hire duration",
    channel: "letter",
    audience: "insurer",
    eventType: "rebuttal_sent",
    legalCitations: true,
    required: ["tp_claim_ref", "their_letter_date", "total_hire_days"],
    subject: "Re: {{claim_ref}} — Hire Duration Disputed",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

Thank you for your letter of {{their_letter_date}} disputing the {{total_hire_days}}-day hire
period.

The hire period reflects the documented repair timeline:

- Vehicle recovered/engineer instructed: {{engineer_instructed_date}}
- Engineer's report received: {{report_date}}
- Repair authorised: {{repair_authorised_date}}
- Repair completed and vehicle returned: {{repair_completed_date}}

Per **Clark v Ardington Electrical Services** [2002] EWCA Civ 510, a defendant remains liable
for hire during delays caused by the repair process itself, provided the claimant has not
failed to mitigate. Our client (and we, on their behalf) took the following steps to keep the
hire period to a minimum: {{mitigation_steps_summary}}.

If you consider a specific period within the above to be unreasonable, please identify which
dates you dispute and why, and we will respond directly rather than to a general assertion
that the period as a whole was too long.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "impecuniosity_disclosure",
    title: "Impecuniosity disclosure response",
    channel: "letter",
    audience: "insurer",
    eventType: "rebuttal_sent",
    legalCitations: true,
    required: ["tp_claim_ref", "their_letter_date"],
    subject: "Re: {{claim_ref}} — Financial Disclosure Request",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

Thank you for your letter of {{their_letter_date}} requesting financial information to assess
our client's impecuniosity.

Following **Holt v Allianz Insurance** and **EUI Ltd v Charles & Ors** [2018] EW Misc B7 (CC),
we recognise a reasonable request of this kind may properly be made pre-action, and our client
is happy to assist rather than leave this to be resolved later in the process.

{{disclosure_response_option_a_or_b}}

Option A — if disclosure is being provided now: Please find enclosed {{disclosure_documents_summary}},
which we say demonstrates our client could not have paid for hire without making sacrifices
they could not reasonably have been expected to make (**Lagden v O'Connor** [2003] UKHL 64).

Option B — if more detail on scope is needed first: Could you confirm precisely what financial
information you consider reasonably necessary for this purpose, so we can revert to our client
with a specific and proportionate request?

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "total_loss_cessation",
    title: "Total-loss cessation (third-party insurer)",
    channel: "letter",
    audience: "insurer",
    eventType: "total_loss_cessation_sent",
    legalCitations: false,
    required: ["tp_claim_ref", "settlement_amount", "settlement_date", "hire_cessation_date", "vehicle_reg"],
    subject: "Total Loss Settlement Received — {{claim_ref}} — Hire Ceasing",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

We confirm receipt of your total loss settlement offer/payment of {{settlement_amount}} dated
{{settlement_date}} in respect of {{vehicle_make_model}} ({{vehicle_reg}}).

Please note the replacement vehicle hire ceased/will cease on {{hire_cessation_date}}, being
{{cessation_basis}} (e.g. the date the settlement figure was accepted, or a reasonable period
thereafter to arrange a permanent replacement). Total hire charge to that date is
**{{total_hire_charge}}**, as previously evidenced.

Please confirm:

1. Settlement of the outstanding balance of **{{outstanding_balance}}** (total loss valuation
   plus hire charges to {{hire_cessation_date}}, less any interim payments already received).
2. Any requirements from you regarding collection of the vehicle/salvage, if applicable.

We consider this claim ready for final settlement on this basis and would be grateful for
payment within {{due_date}}.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "internal_chase",
    title: "Internal chase — repairer or engineer",
    channel: "letter",
    audience: "internal",
    eventType: "internal_chase_sent",
    legalCitations: false,
    required: ["vehicle_reg", "overdue_item", "original_due_date", "recipient_name"],
    subject: "Chase — {{claim_ref}} — {{overdue_item}} overdue",
    body: `Hi {{recipient_name}},

Following up on {{claim_ref}} ({{vehicle_reg}}) — {{overdue_item}} was due
{{original_due_date}} and we haven't received it yet.

Please could you let us know the current status and a revised date? This is holding up the
hire pack going out to the insurer, so the sooner we have it, the sooner we can close this off
and stop the hire clock running any longer than it needs to.

Thanks,

{{sender_name}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
];

export const CAS_EMAIL_SPECS: CorrespondenceSpec[] = [
  {
    key: "client_welcome",
    title: "Client welcome (intake)",
    channel: "email",
    audience: "client",
    eventType: "client_welcome_sent",
    legalCitations: false,
    required: ["client_name", "accident_date", "client_email"],
    subject: "Your claim with {{company_name}} — reference {{claim_ref}}",
    body: `Dear {{client_name}},

Thank you for instructing {{company_name}} following your accident on {{accident_date}}. This
email confirms we're now handling your case, reference **{{claim_ref}}** — please use this
reference in any contact with us.

Here's what happens next:

1. We arrange recovery and secure storage of your vehicle, {{vehicle_make_model}} ({{vehicle_reg}}), if this hasn't happened already.
2. We provide you with a replacement vehicle while yours is off the road.
3. We instruct an independent engineer to assess the damage and produce a repair report.
4. Once approved, we carry out the repair and return your vehicle to you.
5. We recover the cost of the repair and the replacement vehicle hire from the at-fault driver's insurer.

You don't need to pay anything upfront, and you don't need to deal with the other driver's
insurer directly — we'll handle that correspondence.

What we need from you:

- Confirmation of how the accident happened (a short written account is fine)
- Any photos, dashcam footage, or contact details you have for witnesses or the other driver
- Your vehicle logbook (V5C), insurance certificate and driving licence
- A short statement of means and your last three months' bank statements — we ask for this now,
  before your replacement vehicle goes out, rather than later. It's the evidence that supports
  your entitlement to a replacement vehicle on credit, and it's much easier for everyone to sort
  out at the start than to chase once your claim has settled.
- To let us know straight away if you're contacted directly by the other driver's insurer

If anything changes — new contact details, a change in how you're using the replacement
vehicle, or anything else relevant — please let us know as soon as possible, as this can affect
your claim.

If you have any questions in the meantime, reply to this email or call us on {{company_phone}}.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "payment_chase_1",
    title: "Payment chase 1 — first reminder",
    channel: "email",
    audience: "insurer",
    eventType: "payment_chase_1_sent",
    legalCitations: false,
    required: ["tp_claim_ref", "hire_pack_sent_date", "total_claim_amount"],
    subject: "Chase — {{claim_ref}} — Payment Outstanding",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

We refer to our letter of {{hire_pack_sent_date}} enclosing our hire pack and repair invoice
totalling **{{total_claim_amount}}**, for which we have not yet received payment or a
substantive response.

Could you please provide an update on the status of this claim, including whether it is
disputed and, if so, on what basis? If payment is simply outstanding, please arrange this
within {{due_date}}.

We would rather resolve this by agreement, and are happy to discuss by phone if that would
help move things along — please call {{company_phone}} or reply to this email.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "payment_chase_2",
    title: "Payment chase 2 — final warning",
    channel: "email",
    audience: "insurer",
    eventType: "payment_chase_2_sent",
    legalCitations: true,
    required: ["tp_claim_ref", "hire_pack_sent_date", "chase_1_date", "total_claim_amount"],
    subject: "Final Reminder Before Further Action — {{claim_ref}}",
    body: `Dear Sirs,

**Claim ref: {{claim_ref}} / your ref: {{tp_claim_ref}}**

We refer to our letter of {{hire_pack_sent_date}} and our follow-up of {{chase_1_date}}. We
have still not received payment of **{{total_claim_amount}}**, nor a substantive response
setting out any dispute.

This is a final opportunity to settle this claim, or to respond with your reasons for
disputing it, before we refer this matter to our solicitors with a view to issuing
proceedings. We reserve the right to claim interest and costs, including on a Part 36 basis
where applicable, if this becomes necessary.

Please respond within {{final_due_date}}.

Yours faithfully,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "client_total_loss_update",
    title: "Client total-loss update",
    channel: "email",
    audience: "client",
    eventType: "client_total_loss_update_sent",
    legalCitations: false,
    required: ["client_name", "client_email", "settlement_amount", "hire_cessation_date"],
    subject: "Update on your claim {{claim_ref}} — vehicle written off",
    body: `Dear {{client_name}},

I wanted to update you on your claim for {{vehicle_make_model}} ({{vehicle_reg}}).

The engineer has confirmed your vehicle is a total loss (an "economic write-off" — it would
cost more to repair than it's worth). We've now agreed a settlement figure of
{{settlement_amount}} with the other driver's insurer for the value of your vehicle.

What this means for you:

- Your replacement vehicle hire will end on {{hire_cessation_date}} — we'll arrange collection
  or let you know if you need to return it.
- {{ownership_or_finance_next_steps}} (e.g. if there's outstanding finance, how that's handled;
  if you own it outright, next steps for any personal items/registration).
- We're now finalising the claim for the full settlement amount plus the hire costs incurred
  while your vehicle was being assessed.

We'll let you know as soon as the claim is fully settled. In the meantime, if you have any
questions, reply to this email or call {{company_phone}}.

Kind regards,

{{sender_name}}
{{sender_title}}
{{company_name}}
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "client_status_update",
    title: "Client status update",
    channel: "email",
    audience: "client",
    eventType: "client_status_update_sent",
    legalCitations: false,
    required: ["client_name", "client_email"],
    subject: "Update on your claim {{claim_ref}}",
    body: `Dear {{client_name}},

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
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "vehicle_ready",
    title: "Vehicle ready for collection",
    channel: "email",
    audience: "client",
    eventType: "vehicle_ready_notice_sent",
    legalCitations: false,
    required: ["client_name", "client_email", "ready_date", "collection_location"],
    subject: "Good news — your vehicle is ready — {{claim_ref}}",
    body: `Dear {{client_name}},

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
{{company_phone}} · {{company_email}}`,
  },
  {
    key: "case_closed",
    title: "Case closed — payment received",
    channel: "email",
    audience: "client",
    eventType: "case_closed",
    legalCitations: false,
    required: ["client_name", "client_email", "final_settlement_amount"],
    subject: "Your claim {{claim_ref}} is now settled",
    body: `Dear {{client_name}},

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
{{company_phone}} · {{company_email}}`,
  },
];

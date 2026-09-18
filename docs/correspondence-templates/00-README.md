# CAS Email/Letter Template Library

Drop these into the CRM's templating layer and wire each one to the trigger described in its
front matter. All templates use `{{snake_case}}` placeholders — swap for whatever templating
syntax the CRM actually uses (Handlebars, Jinja2, template literals, etc.) if it isn't already
double-curly.

See `17-workflow-stage-map.md` for how these fit into the case lifecycle end to end, including
what starts and stops the "hire clock" and where chasing kicks in.

## Common variables used across templates

- `{{company_name}}` — Complete Accident Solutions Ltd
- `{{sender_name}}`, `{{sender_title}}` — person/role the letter goes out under
- `{{company_address}}`, `{{company_email}}`, `{{company_phone}}`
- `{{claim_ref}}` — CAS's internal case reference
- `{{client_name}}` — the CAS client (non-fault driver)
- `{{vehicle_reg}}`, `{{vehicle_make_model}}`
- `{{accident_date}}`
- `{{tp_insurer_name}}` — third-party (at-fault) insurer
- `{{tp_claim_ref}}` — the insurer's own claim reference, once known
- `{{engineer_name}}`, `{{report_date}}`
- `{{hire_start_date}}`, `{{hire_end_date}}`, `{{daily_rate}}`, `{{total_hire_days}}`, `{{total_hire_charge}}`
- `{{repair_cost}}`, `{{invoice_ref}}`
- `{{settlement_amount}}`, `{{settlement_date}}`
- `{{due_date}}` — payment deadline set in a given letter

## Numbering

| # | File | Audience | Fires when |
| --- | --- | --- | --- |
| 01 | client-intake-welcome | Client | New case opened |
| 02 | engineer-instruction | Engineer | Vehicle in for repair |
| 03 | insurer-notification-of-claim | TP insurer | Liability established, case opened |
| 04 | hire-pack-cover-letter | TP insurer | Repair done + report + hire agreement ready |
| 05 | payment-chase-1-first-reminder | TP insurer | No response N days after hire pack |
| 06 | payment-chase-2-final-warning | TP insurer | No response N days after chase 1 |
| 07 | rebuttal-rate | TP insurer | Insurer disputes the hire rate |
| 08 | rebuttal-need | TP insurer | Insurer disputes need to hire at all |
| 09 | rebuttal-duration | TP insurer | Insurer disputes length of hire |
| 10 | impecuniosity-disclosure-response | TP insurer | Insurer requests financial disclosure |
| 11 | total-loss-cessation-to-insurer | TP insurer | Total loss settlement figure received |
| 12 | client-total-loss-update | Client | Total loss settlement figure received |
| 13 | client-status-update-general | Client | Periodic case update |
| 14 | vehicle-ready-for-collection | Client | Repair complete |
| 15 | internal-chase-repairer-or-engineer | Internal/repairer | Report or repair overdue |
| 16 | case-closed-payment-received | Client + internal | Final payment received |
| 17 | workflow-stage-map | — | Reference: full lifecycle + stop conditions |

Every insurer-facing letter is written formally, on the basis it may end up in a court bundle.
Client-facing ones are plainer English. None of this is legal advice — check anything
substantive (limitation dates, Part 36, disclosure obligations) with your solicitor before it
goes out on a claim of any size.

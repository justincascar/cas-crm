# Outstanding dependencies (CAS to confirm)

Nothing below has been invented as a live connection. Prototype behaviour is labelled simulated.

## Accounts and providers

- Postcode lookup: free **postcodes.io** / OpenStreetMap is in use until CAS adds a licensed Royal Mail PAF key. To switch the drop-down to the full house list, create an [Ideal Postcodes](https://ideal-postcodes.co.uk/) trial (50 lookups, no card) and put the key in `IDEAL_POSTCODES_API_KEY`. Do not invent a key. Manual address entry remains available.
- Vehicle registration lookup provider. Must not be treated as keeper identification. Incomplete results must not infer transmission.
- MID / insurance checking: CAS currently uses an authorised **manual** lookup. Record results in the CRM. Assess a permitted integration only after the actual service and CAS access are identified. Do not scrape protected services.
- Email provider used by CAS for insurer correspondence (Outlook / Microsoft 365 is assumed unless told otherwise). Compose, file history and incoming logging work now; **live send/receive is not connected**.
- WhatsApp Business Platform: account, number, permissions, templates, costs. Intake can queue simulated photo requests, recovery-driver messages, client “on the way” messages, and the recovery/storage agreement. Staff can also send/file WhatsApp on the claim file. Live sending is not connected.
- Office telephone system (make/receive). Calls can be recorded on the file with an outcome; unanswered calls can create a call-back task. Live dialling is not connected.
- Credit recovery and storage agreement template (CAS wording). Prototype generates an unsigned placeholder from captured facts only.
- Electronic signing provider. Until connected, use upload-signed-copy.
- Hosting, backups and data location (UK/EU preference to be confirmed before any purchase). Do not purchase during prototype development.

## Templates and rules to review against real CAS documents

- Hire / credit-hire / courtesy agreements (mandatory fields, date counting, renewal wording).
- Letter library, including insurer “Dear Sir / Madam” style and chaser set.
- Hire Pack: CRM now collects the fields from CAS's supplied `Hire Pack.doc` and generates a pack from the file. Exact Word-for-Word layout/merge into the original .doc is still outstanding. Driver delivery/collection sheets are marked internal.
- The supplied pack's rental period is **89 days**; CRM operational alerts remain **88 days** as specified separately. Credit period in the pack is **51 weeks**. Review before live enforcement.
- Payment pack, loss-of-use chronology and bill layouts.
- Handover / return forms (mileage, fuel, condition, keys).
- Engineer instruction template.
- Pre-action / litigation templates. Do not issue proceedings without approval.

## Policy confirmations

- Storage billing end date practice (payment day vs a few days after) — CRM stores an explicit date rather than inventing a grace period.
- Qualifying-payment rule for total-loss off-hire countdown (implemented as a handler-confirmed event as a safeguard).
- Live chaser scheduling: demonstration uses **3 calendar days**; confirm business days and sending hours before activation.
- Insurer-specific intervals and nominated representatives.
- Production file-reference format (demonstration uses `TEST-`).
- VAT treatment for business clients.

## Stage 2+ product work (not blocked on accounts)

- Staff accounts, passwords, roles, and proof that another staff member can be authorised while a client cannot see others’ files.
- Client portal / mobile form with save-and-return.
- Server-side automation runner while browsers are closed.
- Document generation from real templates. Placeholder letters now generate from file dates; CAS wording still required.
- Backup, restore and export tests.

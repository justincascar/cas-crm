# Outstanding dependencies (CAS to confirm)

Nothing below has been invented as a live connection. Prototype behaviour is labelled simulated.

## Accounts and providers

- Postcode lookup: free **postcodes.io** / OpenStreetMap is in use until CAS adds a licensed Royal Mail PAF key. To switch the drop-down to the full house list, create an [Ideal Postcodes](https://ideal-postcodes.co.uk/) trial (50 lookups, no card) and put the key in `IDEAL_POSTCODES_API_KEY`. Do not invent a key. Manual address entry remains available.
- Vehicle registration lookup provider. Must not be treated as keeper identification. Incomplete results must not infer transmission.
- MID / insurance checking: CAS currently uses an authorised **manual** lookup. Record results in the CRM. Assess a permitted integration only after the actual service and CAS access are identified. Do not scrape protected services.
- Email provider used by CAS for insurer correspondence (Outlook / Microsoft 365 is assumed unless told otherwise). Compose, file history and incoming logging work now; **live send/receive is not connected**.
- WhatsApp Business Platform: account, number, permissions, templates, costs. Intake can queue simulated photo requests (including scene photographs from accident details), recovery-driver messages, client “on the way” messages, and the recovery/storage agreement. Staff can also send/file WhatsApp on the claim file and ask for scene photographs from Accident details. Live sending is not connected.
- Office telephone system (make/receive). Calls can be recorded on the file with an outcome; unanswered calls can create a call-back task. Live dialling is not connected.
- Credit recovery and storage agreement template (CAS wording). Prototype generates an unsigned placeholder from captured facts only.
- Electronic signing provider. Until connected, use upload-signed-copy.
- Hosting, backups and data location (UK/EU preference to be confirmed before any purchase). Do not purchase during prototype development.

## Templates and rules to review against real CAS documents

- Hire / credit-hire / courtesy agreements (mandatory fields, date counting, renewal wording).
- Letter library from CAS (`docs/correspondence-templates/`) is now wired. The **fault letter to the client's own insurer** and the **non-fault initial letter to the TPI** are real templates in the CRM (preview, generate, file as generated). Other letters/emails remain supplied templates or operational drafts. Solicitor sign-off still required before live sending. Letter before action is still not a sendable pack.
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
- Insurer-specific intervals and nominated representatives. Audatex network / work provider codes are stored per claim and suggested from the last saved values for the **same insurer name** (exact match). A shared insurer directory for codes is not built yet.
- Production file-reference format (demonstration uses `TEST-`).
- VAT treatment for business clients.

## Stage 2+ product work (not blocked on accounts)

- Staff accounts, passwords, roles, and proof that another staff member can be authorised while a client cannot see others’ files. **Local staff sign-in now exists** (see `docs/AUTH-NOTES.md`); Justin is an administrator and can manage staff logins. All signed-in staff still see every file, and it is still this PC only.
- Client portal / mobile form with save-and-return.
- Server-side automation runner while browsers are closed.
- Document generation from CAS letter/email templates (`docs/correspondence-templates/`). The fault own-insurer letter and non-fault TPI initial letter are now real templates in the CRM. Other letters remain supplied wording or operational drafts. Solicitor sign-off is still required before live use, and the office mailbox is still not connected.
- Backup, restore and export tests.

Staff forms now highlight the invalid field and jump to it on submit. Live mailbox, DVLA and WhatsApp sending are still not connected.

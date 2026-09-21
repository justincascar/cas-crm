# Progress

## Environment (2026-09-15)

- Inspected `Code` folder: only the build brief was present. Created `CAS-CRM`.
- Earlier visual prototype at cas-claims-workspace.justin380018.chatgpt.site required ChatGPT sign-in; **source was not accessed**. Dashboard design is original.
- Installed Node.js 24.19.0 LTS via winget. Git was already present. Python was not installed and was not required.

## Stage 1 — working dashboard (in progress / first running version)

Implemented:

- Persistent SQLite store with 12 fictional TEST claims spanning new enquiry, roadworthy reservation without charges, undriveable recovery/hire, fault courtesy, liability/engineer waits, repair auth, repairs in progress, ready for return, total-loss payment/salvage, qualifying off-hire countdown, day-80 unsigned renewal, litigation/offer review.
- Dashboard counts that open filtered lists; search; claim create/edit; notes; tasks; fleet availability and overlap-blocked reservations.
- File history with dated steps (initial TP insurer letter, engineer instructed, repairs started, hire pack, rebuttals, total-loss cessation, case closed, and related events). Letters and emails are generated from those dates using CAS's supplied templates in `docs/correspondence-templates/`. Missing fields are listed, not invented. Rebuttal wording includes supplied case-law citations and is flagged for solicitor sign-off before live use. Email compose/incoming logging is recorded on the file. Sending is simulated or, for engineer instructions, **prepared in the handler's own email client (mailto) — not auto-sent**. Genuine automatic sending is still pending connection of the Microsoft 365 mailbox `claims@cascar.co.uk` (decision made; not live).
- Hire Pack data collection and generation from the CAS Hire Pack.doc structure (hirer, additional driver, hire vehicle vs own vehicle, charges, mitigation including financial means, handover, cancellation notice). Storage & Recovery is generated as a standalone document, not as a hire-agreement page. Signatures are not fabricated. The 89-day pack wording versus 88-day CRM alerts is flagged for Justin; neither figure has been changed.
- Staff intake form covering client (owner/driver/owner/driver split), vehicle lookup, tax/MOT/insurance recording, damage, accident (maps link, police, witnesses, speeds, photographs taken at the scene with a simulated WhatsApp send-in), recovery charges, storage starting the same day as recovery, and up to three third parties with insurer autocomplete (generic telephone/email/address only) and TPI agent fields.
- Claim file screens matching the current CRM viewing pane (client, hire, damage diagram, fleet reserve, recovery, storage, loss of use dates, financial summary). Values persist in SQLite. Opening a file or reserving a vehicle still does not start charges.
- Duplicate Alpha screens (navigation, hire-car register, extra-charges, loss-of-use dates as a second chronology) are hidden. Communications sit on the file: simulated send/receive email and WhatsApp, recorded calls, and letter generation from file dates.
- Simulated postcode and registration lookups, clearly labelled.
- Distinct claimed / offered / agreed / received totals.
- Tests in `tests/` for the behavioural rules in the brief that can be checked without live integrations.

Labelled simulated / not live: vehicle lookups, correspondence sending, document files, WhatsApp, email, e-sign, MID API.

Staff sign-in (17 September 2026): username/password for the four demonstration handlers, hashed in SQLite, HTTP-only session cookie, server-side checks on pages and actions. Still this PC only; all signed-in staff see every file. Credentials: `docs/AUTH-NOTES.md`.

17 September 2026 — four focused fixes:

- Vehicle lookup stays simulated. If there is no DVLA key, or lookup fails, staff can still type make, colour, tax and MOT. The form is not blocked.
- Accident date cannot be after today in Europe/London. Checked in the browser and on the server.
- Date of birth shows a live age box. Drivers under 17 cannot be saved. Client/owner/hirer under 17 shows a warning and needs a tick to confirm. Future and over-110-year dates are rejected.
- Justin Roberts is an administrator. Sian, Tom and Megan are staff. Administrators can add, disable, reset passwords and change roles on `/settings/staff`. Standard staff cannot use that screen.

18 September 2026 — CAS letter and email templates:

- Unzipped CAS templates into `docs/correspondence-templates/`.
- “Create a document from the dates” can produce the supplied letters and emails, filled from the file. Repair commencement and liability chaser remain as operational drafts (not in the zip).
- Client/internal emails also fill the Communications send form as a simulated `OutgoingMessage`. Nothing is sent live.
- Hire-pack chase rules (05 → 06 → solicitor handoff) share the existing chase pattern: closed / disputed-awaiting-CAS / solicitor files are not chased; a rebuttal resets the clock; a partial payment reduces the balance; hire charges stop at vehicle return or total-loss cessation.
- Hire Pack terms in `cas-hire-terms.ts` were left unchanged.

18 September 2026 — Hire Pack fixes and initial notification letter:

- Storage & Recovery now uses “Your Own Vehicle Details” and is generated as its own document (`TEST-xxxx-SR`), including when there is no hire agreement. Solicitor-reviewed standalone wording is still to come.
- The 89-day pack cap versus 88-day CRM alerts is shown on Settings and the Hire Pack page. Justin (or the solicitor) still needs to confirm which is correct; neither number was changed.
- Mitigation questionnaire includes a financial-means declaration that refers to the intake statement of means and bank statements.
- Itemised extras, group charged and additional-driver licence/DOB fields from the supplied pack are captured as optional.
- Initial third-party notification letter follows the structure of the supplied Initial Letter ERS.doc (reference line, facts block, notice of claim, four-point request). File-specific facts from that example were not copied.

18 September 2026 — Accident scene photographs:

- Accident details (intake section 4 and the file screen) asks whether photographs were taken at the scene.
- If yes, staff can ask the client to send them in via WhatsApp. That is simulated and is not sent to a live number. Incoming photographs are filed under Email / WhatsApp / Calls. Photo file upload is still not in this prototype.

18 September 2026 — Third-party insurer autocomplete:

- TP insurance remembers generic insurer details (name, address, telephone, email) once they have been used.
- Typing the name offers those insurers and fills the shared contact details. Policy number and claim reference are not filled, because they differ on every file.
- Demonstration contacts (Admiral, Aviva, Zurich, Hastings, Ageas) use fictional `.example.test` addresses, not live switchboard numbers.

18 September 2026 — Third-party agent autocomplete:

- TPI agent remembers generic details (name, address, telephone, email and handler) once they have been used.
- Typing the agent name offers those firms and fills the shared contact details. The agent reference is not filled, because it differs on every file.
- Demonstration contacts (Keoghs, DAC Beachcroft, Horwich Farrelly) use fictional `.example.test` addresses, not live switchboard numbers.

18 September 2026 — Liability status and roadworthiness:

- Inspected first: the file already had `claim_type` (unknown / fault / non-fault) and `roadworthiness` (awaiting assessment / roadworthy / unroadworthy / needs review), plus separate CAS/insurer liability views. Those were not the two workflow facts. There was no Disputed / unclear choice. Intake silently defaulted to unknown and awaiting assessment. Saving Claim facts overwrote the values with no dated history.
- Staff can now set Liability status (Fault, Non-fault, Disputed / unclear, or Not yet decided) and Roadworthiness (Roadworthy, Unroadworthy, or Not yet decided) on the claim overview and on General details. The two answers are independent.
- Neither field defaults to Fault or Roadworthy. Unset is shown as Not yet decided. Changes are recorded in file history with who changed them and when.
- Hire-start and reservation rules were not changed. Opening a file still does not start charges.
- Seeded TEST files were not rewritten. TEST-0001 still stores `unknown` / `awaiting_assessment`, which now display as Not yet decided. TEST-0005 remains stored as non-fault (its circumstances mention a disputed junction, but that value was not silently changed).

19 September 2026 — Fault and non-fault notification letters, and Audatex codes:

- Inspected the existing document generator first (Hire Pack HTML branding, `wrapLetter`, preview, generate-and-file). The two new letters reuse that system. They are not a separate document store.
- **Now real (staff-previewable, filed as generated, not sent):**
  - Fault claim letter to the client's own insurer, offered when Liability status is Fault.
  - Non-fault initial letter to the TPI, offered when Liability status is Non-fault. This replaces the earlier placeholder TPI notification wording.
- Courtesy-vehicle sentences appear only when a courtesy vehicle is actually allocated on Hire/Fleet. Credit hire is not treated as courtesy.
- On Disputed / unclear (or Not yet decided), neither letter is auto-suggested. Staff pick manually.
- Missing facts are marked `[not yet on file]` in the preview and listed above the letter. They are not left blank and are not invented.
- Audatex network code and work provider code are free text on the claim (overview and Client insurer screen). They stay blank until staff enter them after the insurer has confirmed. Changes are recorded in file history. They are not filled from the insurer name.
- If another file already has codes for the **same insurer name** (exact match as typed: own insurer on Fault, third-party insurer on Non-fault), those last-saved values are pre-filled as a suggestion. They are marked as suggested and are not confirmed on this file until staff save. A saved correction on this file becomes the next suggestion for that insurer. A brand-new insurer name still starts blank. Matching is exact after trim — “Aviva” will not pick up “Aviva Insurance”.
- Generating a letter files it on the claim as generated. It does not claim to have been sent. Live mailbox send is still not connected.
- **Still placeholder / operational draft:** Hire Pack (layout vs Word original outstanding), Storage & Recovery standalone wording, repair commencement, liability chaser, hire-pack cover, rebuttals (solicitor sign-off still required), payment chases, total-loss and client emails, and any letter before action.

19 September 2026 — Engineer instruction (prepared, not auto-sent):

- Saved engineers list (name, address, email) under Settings → Engineers. Seeded with Andy Montgomery, Montgomery Assessors, Woodlands, Ham Lane South, Llantwit Major, Vale Of Glamorgan, CF61 1RU, andy.mont@hotmail.co.uk. Further engineers can be added; this is not hardcoded to one person.
- On Communications, staff pick an engineer from the dropdown. That name and address fill the engineer instruction letter.
- **Instruct Engineer** generates the letter as before and opens a pre-filled email (`mailto`) to the selected engineer's address, with the letter as the email body, in the handler's own email client. The CRM does **not** send it.
- After the handler has sent it themselves, **Mark as sent** logs it on the file history with the date and the handler's name, in the same way other correspondence is filed. Status is `handler_marked_sent`, not a live mailbox send.
- Microsoft 365 mailbox decision: **claims@cascar.co.uk**. Live send/receive is still not connected. Engineer instruction letters ask for the report to be returned to that address. Hire Pack company email remains `info@cascar.co.uk` as in the supplied pack.

19 September 2026 — Field-level validation:

- Invalid fields are marked on the field itself (red outline) with a short message underneath. This is not only a banner at the top of the page.
- On submit, every invalid field is highlighted. The page scrolls to the first one in reading order and puts the cursor in it, including fields further down a long form.
- Required-and-empty uses the same pattern as a wrong format (for example a mobile that is not 11 digits). The red highlight clears as soon as that field becomes valid.
- The same behaviour is used on the new claim form, client/file screens, Hire Pack, fleet reservations, login, communications, notes/tasks, and staff password forms.

21 September 2026 — Shared chase reminders (engineer report, liability response, repair authorisation):

- The engineer-report chase was refactored into a shared mechanism with a chase type. Liability response and repair authorisation/payment use the same clock, pause/resume/cancel, dashboard listing and prepared-email pattern. Nothing is auto-sent.
- Each type has its own Settings interval. A longer interval can be saved on an individual file with a reason (for example “agreed with insurer”). Changing the global default does not overwrite that override.
- Liability chase starts when a liability enquiry is recorded as sent. It clears only when staff log an insurer decision (accepted / rejected / partial) or pause/cancel. Disputed / unclear and not yet decided are not treated as a decision.
- Repair authorisation chase starts when staff log that a repair estimate or payment request has been sent. It clears when staff log authorisation or payment received.
- Prepared chaser emails to insurers use the email stored on Third party 1. If none is recorded, the screen says “No insurer contact on file” rather than guessing. TEST files currently have insurer names only — no correspondence email. The client's own insurer record still has no email field.

Blocked: provider accounts, per-file permissions, shared hosting, live DVLA, live mailbox send.

## Not yet claimed

Stages 2–5 (finer permissions, live integrations, payment packs from CAS templates, litigation issue, backups/restore/deploy). Working dashboard is not production readiness.

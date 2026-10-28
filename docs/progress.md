# Progress

## Environment (2026-09-15)

- Inspected `Code` folder: only the build brief was present. Created `CAS-CRM`.
- Earlier visual prototype at cas-claims-workspace.justin380018.chatgpt.site required ChatGPT sign-in; **source was not accessed**. Dashboard design is original.
- Installed Node.js 24.19.0 LTS via winget. Git was already present. Python was not installed and was not required.

## Stage 1 — working dashboard (in progress / first running version)

Implemented:

- Persistent SQLite store with 12 fictional TEST claims spanning new enquiry, roadworthy reservation without charges, undriveable recovery/hire, fault courtesy, liability/engineer waits, repair auth, repairs in progress, ready for return, total-loss payment/salvage, qualifying off-hire countdown, day-80 unsigned renewal, litigation/offer review.
- Dashboard counts that open filtered lists; search; claim create/edit; notes; tasks; fleet availability and overlap-blocked reservations.
- File history with dated steps (initial TP insurer letter, engineer instructed, repairs started, hire pack, rebuttals, total-loss cessation, case closed, and related events). Letters and emails are generated from those dates using CAS's supplied templates in `docs/correspondence-templates/`. Missing fields are listed, not invented. Rebuttal wording includes supplied case-law citations and is flagged for solicitor sign-off before live use. Email compose is recorded on the file. A real send from `claims@cascar.co.uk` happens only when `EMAIL_SEND_MODE` is exactly `live` and `CAS_M365_TENANT_ID`, `CAS_M365_CLIENT_ID` and `CAS_M365_CLIENT_SECRET` are all set. Credentials alone do not send. If the mode is missing or anything other than `live`, the send is simulated and nothing leaves the mailbox. A person still clicks Send. Incoming mail is not read.
- Hire Pack data collection and generation from the CAS Hire Pack.doc structure (hirer, additional driver, hire vehicle vs own vehicle, charges, mitigation including financial means, handover, cancellation notice). Storage & Recovery is generated as a standalone document, not as a hire-agreement page. Signatures are not fabricated. The 89-day pack wording versus 88-day CRM alerts is flagged for Justin; neither figure has been changed.
- Staff intake form covering client (owner/driver/owner/driver split), vehicle lookup, tax/MOT/insurance recording, damage, accident (maps link, police, witnesses, speeds, photographs taken at the scene with a simulated WhatsApp send-in), recovery charges, storage starting the same day as recovery, and up to three third parties with insurer autocomplete (generic telephone/email/address only) and TPI agent fields.
- Claim file screens matching the current CRM viewing pane (client, hire, damage diagram, fleet reserve, recovery, storage, loss of use dates, financial summary). Values persist in SQLite. Opening a file or reserving a vehicle still does not start charges.
- Duplicate Alpha screens (navigation, hire-car register, extra-charges, loss-of-use dates) are hidden. Saving loss-of-use dates stores them on that screen only and does not write the file chronology. Communications sit on the file: simulated send/receive email and WhatsApp, recorded calls, and letter generation from file dates.
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
- Microsoft 365 mailbox decision: **claims@cascar.co.uk**. Live send/receive is still not connected. Engineer instruction letters ask for the report to be returned to that address. The Notice of the Right to Cancel asks the client to email that same address.

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
- Dashboard load was slow because each card count re-ran the chase overlay, and each chase ran a separate query per file per type. Chase clocks now load in a handful of batch queries; card counts use COUNT without overlay. Schema setup runs once per database connection rather than on every SQL statement. The dashboard logs elapsed milliseconds and SQL statement count.
- Hire/Fleet reservations are recorded against the signed-in staff member, not always Sian. Empty Documents list rows (no generated body) are labelled as simulated placeholders.
- Hire agreement renewal is a shared chase type. It counts from the current signed agreement start (amber approaching from day 70, red due from day 80, red overdue from day 88), not from fleet booking dates, and not for courtesy/staff use unless a hire agreement is on the file. Logging a renewal adds a new agreement period and keeps the earlier ones. An ended hire never alerts. The supplied pack still says 89 days; the CRM operational limit stays 88 unless changed in Settings.

21 September 2026 — Real CAS fleet and stored V5Cs:

- Forty-five genuine fleet vehicles imported from V5C PDFs, tagged `is_real = 1`, kept separate from fictional TEST CAS 1–10. A TEST-data reset that deletes `is_real = 0` must not wipe them.
- V5C fields stored only where legible. Gearbox and seating left blank (not on a V5C). Vehicle class covers car, van, motorcycle, campervan, and wheelchair-accessible taxi.
- Each V5C PDF is copied into `%LOCALAPPDATA%\CAS-CRM\files` and linked from `documents` (type `V5C`, vehicle/fleet id). Staff can view the original from the vehicle record.
- Hire/Fleet can add a real vehicle, edit details, and soft-remove (never hard-delete). Removing a vehicle with an active or future reservation warns and requires confirmation. Booking history stays.

21 September 2026 — YT18 VJL V5C correction:

- YT18 VJL is an Audi Q7. The supplied folder was labelled A4, and the import stored model `S4 S LINE TDI QUATTRO AUTO` (a misread of D.3 `Q7 S LINE TDI QUATTRO AUTO` on the actual V5C). The record and stored filename now read Q7. Staff edits of make/model after import are not overwritten.
- All 45 stored V5Cs were compared to the vehicle records. No other confirmed make/model mismatch, and no V5C filed under the wrong registration. SF16 AWC's V5C is JPEG2000. It cannot be previewed in the CRM (the on-screen pages come out blank), so staff must download the original PDF. Its registration, make and model were left blank at import because the V5C could not be read.

21 September 2026 — SF16 AWC plate and diesel fuel:

- SF16 AWC's registration is taken from the supplied filename (`SF16 AWC`), not from the unreadable scan. Make is PEUGEOT. The model is marked unconfirmed, for a paper V5C or DVLA check. A blank registration on a future import uses the filename plate in the same way.
- Where a V5C shows fuel as HEAVY OIL, the fleet record stores Diesel. Other fuel words are left as read. A make or model a staff member has already typed is not overwritten.

21 September 2026 — Hire Agreement (4 pages) and GTA rating:

- Generating a Hire Agreement files the pages from the supplied Hire Pack.doc that apply to that file. The terms and the cancellation notice are always included, because they cover hire and storage together. The hire vehicle page is included only when a hire vehicle is allocated. The Storage & Recovery page is included only when storage or recovery has been arranged through CAS. A page that does not apply is left out. The claim states which parts are included and why. The agreement number is a TEST-HA sequence, not a continuation of real agreement 100773.
- GTA group is staff-set on the fleet vehicle and on the client's own vehicle, blank until classified. Group Charged defaults to the client's group. The daily rate is that group's GTA ceiling plus the markup in Settings (30% to start). The supplied vehicle's group is shown and is not used for the rate. A higher Group Charged warns and is logged. It is not blocked.
- The rate table stored is the supplied ceilings for 1 July 2026 – 30 June 2027. The July 2025 – June 2026 workbook is not used. That older file also listed SP11–SP13, which are not in the current table.

1 October 2026 — A part-payment does not clear the total-loss payment chase:

- The payment chase and the dashboard card “Total-loss payments awaited” stay on the file until the vehicle-damage amount received equals the agreed figure. That is the same test as the hire-end suggestion. A smaller payment leaves both showing. A later payment that brings the total up to the agreed figure clears both.
- The total-loss cessation letter uses the hire end on the booking when one has been confirmed, and uses Scheduled off-hire only when that hire end is still blank.
- Off-hire dates approaching no longer includes a file once that hire end is on the booking. It had been using hire status and Scheduled off-hire. TEST-0010 already has a hire end on the booking, so it leaves that card.

1 October 2026 — Bank statements are chased from the hire agreement:

- Driving licence, insurance certificate and the client's logbook still start their 24-hour chase when the client welcome is marked sent.
- Bank statements start when the hire agreement is generated (Generate Hire Agreement on the hire pack). That is the existing step that files the agreement. There is no separate “sent for signing” marker. If that agreement has not been generated, the bank-statement chase has not started. A welcome letter sent earlier does not make it overdue. Uploading the statements, or ticking them on the hire pack, still clears it. Generating the agreement again does not restart the 24 hours.
- The client welcome no longer asks for bank statements. The generated hire agreement asks for a short statement of means and the last three months' bank statements before the replacement vehicle goes out. That is the same document that starts the bank-statement chase.

1 October 2026 — The total-loss payment is entered once:

- The amount under Insurer payment on the total-loss screen is the only place staff record that money has arrived. That same running total feeds the hire-end suggestion. The payment chase and the “Total-loss payments awaited” card clear only when that total equals the agreed figure.
- The older “Qualifying payment for off-hire” line is not that entry. Nothing on screen sets it. It stays as it was. Scheduled off-hire is a separate date and was not changed.

1 October 2026 — A total-loss payment can suggest the hire end, and a person confirms it:

- When the vehicle-damage amount received equals the agreed settlement, and there is no salvage mismatch still flagged, the file suggests a hire end seven days after the payment that completed that total. It is a CAS working default, not a legal rule, and nothing is written until a person confirms it. Confirming sets the hire billing end on the hire booking, the same field a collection date would set, and records that confirmation on the file history.
- A partial payment, a missing agreed figure, a salvage sale that does not match the engineer's salvage figure, or an insurer answer that differs from what CAS asked, shows “Review before setting an off-hire date” and does not offer a date. Each later payment is added to the amount already received. The suggestion appears once the total matches and the salvage flag has gone, without typing the payment in again.
- If a hire end is already on the file and it is a different day, that date is left as it is and the two days are shown for a person to choose. Storage, the storage end date, the daily rate and the scheduled off-hire field are not changed.

1 October 2026 — Overview lists what is outstanding for a person:

- Each claim Overview has an Outstanding box. It lists open tasks that are due today or overdue, chases that are already due (liability response, engineer's report, repair authorisation, hire renewal), and three first steps that have not been marked sent: the liability notification, the engineer instruction, and the repair authorisation request. Several can show at once. If none apply, it says nothing is outstanding.
- A chase still inside its usual interval is left off. The liability line uses the same pending-insurer test as the awaited-liability dashboard card, so a straightforward fault file whose insurer position is already admitted does not get it. The repair line is left off a total-loss file, which is stored as not on a repair path. The handler's own next-action note is unchanged and sits separately under Claim facts.
- Client papers and total-loss payment now have agreed chase points, and both appear in this box when they are due. Driving licence, insurance certificate, the client's logbook (V5C) and bank statements are chased every 24 hours after the client welcome is marked as sent. There is no separate requested-on date; that letter is the request. Uploading the paper clears the chase at once. Bank statements can also be ticked as on the hire pack.
- Total-loss payment has two stages. After the notification to the insurer is marked sent, and there is no confirmation and no payment, the chase repeats every 3 days. When staff record that the insurer has confirmed they are sending payment, the 3-day chase stops and a 7-day wait starts, repeating every 7 days until the money is recorded as received. Payment arriving before a chase is due does not leave a chase on the file. Confirmation is stored separately from the amount received, and neither starts the off-hire countdown by itself.
- Settings has Payment details for insurers (account name, sort code, account number). They stay blank until staff type them. The total-loss notification includes them, or the line “Payment details not yet on file.” Nothing is invented, and nothing is sent automatically.

1 October 2026 — Opening a claim from the list shows Overview:

- The file reference on the Claims list already opened `/claims/{id}`, which is the Overview page. The File screens list was drawn on that page as well, so it was the first thing on screen. That list now appears only after File screens is opened, and on the other sections that already used it. Overview, Handover, Documents and Vehicles stay full width. The File screens themselves are unchanged.

1 October 2026 — Each claim has a Vehicles tab:

- The claim section row now includes Vehicles, in the same style as Overview, Handover, Documents, Repair evidence and Hire Pack. It is on every page of that claim.
- The client's own vehicle is on the left and each third-party vehicle is on the right, using the details already stored on the file. A file with no third-party vehicle says Not recorded. A file with no client vehicle yet says Not yet recorded. More than one third party is listed separately. Editing still happens on the existing vehicle and third-party screens.
- The Audatex network code and work provider code have moved off the Overview page onto this tab, under the client's vehicle. The same fields and suggestions are used. Repair evidence has a link to that tab. Overview now shows only the registration and make/model, with a link to Vehicles.
- A driver or mechanic cannot open the tab.

1 October 2026 — A claim can store tagged documents:

- Staff can upload a PDF or photograph onto a file, choose its type (V5C for the client's vehicle, V5C for a CAS vehicle, driving licence, insurance certificate, signed hire agreement, engineer's report, satisfaction note, correspondence, or other), and see what is on file. A type is required. The list also shows what is still missing for the papers named in the welcome letter, and for a later payment-request pack (signed hire agreement and engineer's report).
- A newer copy, such as a renewed insurance certificate, is stored as the next version. The earlier file stays on the claim and can still be opened. Two different documents of type Other are not treated as versions of each other.
- The same documents table and stored-file folder already used for fleet V5Cs are used here. A fleet V5C imported against a yard vehicle is unchanged. Nothing on this screen is attached to an email, generated, or signed.
- Office staff can open these documents. A driver or mechanic cannot, including by a direct link. There is still no client login.
- Known limitation: repair invoice and basic hire-rate evidence are named in the workflow map and are not separate types yet. Store those as Other. A file that is not a PDF or a photograph, or is over 12 MB, is refused.

1 October 2026 — Two development warnings on the handover phone page are cleared:

- The pre-scan and post-scan forms were marked with a form encoding as well as a server action. React warned that it would ignore that encoding. Those forms no longer set it. The signature form and the photograph forms remain ordinary posts to an address, with their own encoding. That warning did not drop or corrupt a signature or a photograph.
- For a short time the server still sent the older handover form, without the signature section, while the phone script had the new section. React rebuilt the form in the browser. The drawing pad is also no longer placed inside a label, which the browser would have rearranged. A fresh load now sends the same form from the server and the phone. The mismatch did not save a wrong time, a damaged signature, or a damaged photograph.

1 October 2026 — A handover can record a signature drawn on the CAS phone:

- At delivery, collection, recovery or return, the person handing the vehicle over can capture a signature on the driver’s or staff member’s own phone. It stores the printed name, how that person is connected to the claim (client, owner, hirer, driver, or other authorised person), the drawing, and the same “date and time this happened” already on the handover. That time is not a second clock, and it is not changed after save.
- Signing is optional. If the client is not there, or will not sign, the handover still saves, with a short reason such as “client not present”. The saved record then says Not signed. A missing signature does not mark the handover Incomplete. Incomplete is still only the missing condition photographs.
- A saved signature is locked with the rest of that handover. A correction is a new handover record. There is no edit of the original drawing.
- Known limitation: this is an operational confirmation captured on a CAS device. It is not an independently verified electronic signature, and the screen says so. It does not produce a satisfaction-note PDF, and it is not sent to the client’s own phone for them to sign there.

1 October 2026 — The handover page no longer shows a development error on the phone:

- Taking a photograph still sends itself as soon as the camera returns. That behaviour was a small script on the handover page. It was written as a raw script tag inside the page, which React does not run, and the phone showed an error overlay. The same script is now loaded with Next.js's own script component, so it runs and the overlay is gone.

1 October 2026 — My jobs today also lists the next 6 days:

- Below today and overdue, Upcoming this week shows hire delivery, hire collection, client recovery and client return assigned to the signed-in person from tomorrow through six days ahead, grouped by date. Each of those six days is shown. A day with no job says nothing is assigned.
- A job for today stays in the today list and is not repeated below. A job more than 6 days ahead is not shown. Marking a job Done removes it from the week list. The list reads the assigned date on the job, so a date change shows on the new day.
- The driver and mechanic demonstration jobs are still created for today only, and they are not one of these four types, so they do not appear as future placeholders. The dashboard and the chase reminders are unchanged.

1 October 2026 — An unfinished job stays on My jobs today until it is marked Done:

- A hire delivery, hire collection, client recovery or client return assigned for an earlier day, and not marked Done, stays on that person's My jobs today list. It is shown in red as Overdue, with the original assigned date. It keeps showing however many days have passed.
- A job for today is listed as before, and is not marked overdue. A job for a future date stays off the list until that day. Marking a job Done removes it from later days, the same as before.
- The demonstration jobs for the driver and mechanic logins are a vehicle handover and a repair for today only. They are not one of the four job types, so an old copy does not stay on the list as overdue. Engineer, liability and repair-authorisation chases are unchanged.

24 September 2026 — Total-loss notification uses the insurer email saved on Third party 1, and the letter is only what the insurer should see:

- Saving an email on Third party 1 now writes it onto the third-party record, including when that file did not have a third party yet. Prepare notification email reads that address straight away, and also the address already stored on the Third party 1 screen. TEST-0010 had the address only on the screen, which is why the button previously said no insurer email was on file.
- The drafted letter opens with Dear Sir / Madam, keeps the CAS reference, the two engineer's figures and the payment request, and includes the insurer's own claim or policy reference. If none is on the file, the line says [not yet on file]. It does not invent one.
- Notes for staff stay on the screen, above the prepare button. They are not in the letter. The same check was made for Instruct Engineer (draft notices are removed before the message is opened) and for the engineer-report, liability and repair-authorisation chasers. Those chasers no longer include the line that the reminder came from the CRM and had not been sent automatically. The screen still says the CRM has not sent it.
- The engineer's report is not attached to this email. That waits for the document storage and tagging stage, which is not built yet.

23 September 2026 — Total-loss files record what CAS asked the insurer for, as well as the insurer's answer:

- Staff can record the request as either the full pre-accident value, with the insurer collecting the salvage, or the net figure, with CAS retaining and disposing of it. That request is separate from the insurer's answer already on the file.
- Prepare notification email opens a pre-filled message in the handler's own email client, in the same way as Instruct Engineer. Mark as sent records it on the file history. Nothing is sent from claims@cascar.co.uk.
- If the insurer's answer is not the same as the request, the file shows a note to review the storage and recovery position. The note does not change any storage, recovery or hire date or amount. If either the request or the answer is still blank, there is no note.
- The pre-accident value, salvage value, suggested payment and disposal boxes from earlier today are unchanged.

23 September 2026 — Total-loss files record the engineer's figures and what happened to the salvage:

- On a file already marked total loss, staff can enter the pre-accident value and the salvage value from the engineer's report. Both boxes start empty. An empty box is not treated as zero, and no payment is suggested until both figures are there.
- Staff record whether the insurer is taking the salvage. If not, the file shows pre-accident value minus salvage value as a suggestion. It becomes the agreed vehicle-damage amount only when a person presses the button. The amount already paid is not changed. Hire and storage lines are not changed.
- If the insurer is taking the salvage, that suggestion is not shown and the disposal boxes are hidden. The insurer is expected to pay the full pre-accident value. Staff can still type a different offer or a different agreed amount. Those stay separate from the engineer's figures.
- Where CAS disposes of the salvage, staff record a sale to a third party (with the actual proceeds), a return to the customer (with the date, and a charge only if one was made), or a purchase by CAS. A difference between the sale proceeds and the engineer's salvage value is flagged. It is not added into the agreed or paid vehicle-damage amount. Disposal can be saved before the insurer's payment is agreed.
- These figures are typed in from the report. Reading them out of the report automatically is a later stage, and it is not built here.
- The seven-day off-hire calculation is still not wired to a payment on the file. This change does not call it.

23 September 2026 — Hire ends on the day the hire car is collected:

- Completing a Hire car collection job, including one written up later with a real date and time, now sets that booking’s hire end to that calendar day when the booking has no hire end yet. The date used is the day the collection happened, not the day the job was assigned. The daily rate, storage dates and the scheduled off-hire date are not changed.
- If a hire end date is already on that booking and it falls on a different day, it is left as it is. The file shows a check: use the date from the collection job, or keep the date already on the file. Nothing is overwritten until a person chooses. That choice is a CAS charging check, not a legal conclusion.
- A file with no hire booking is left alone. A total-loss file is left alone. The seven-day rule already exists as a calculation (`totalLossOffHireDate`: seven days after a handler-confirmed qualifying payment) and is covered by the existing tests. Nothing on a file calls it, so recording a payment still does not fill the scheduled off-hire date. That wiring is still outstanding. This change does not call it.
- Two people resolving the same check at once is not locked. The storage date check is the same. The last save stands. That is noted, not changed.
- Recording a hire-car handover on its own does not set the hire end. The collection job has to be marked Done.

22 September 2026 — My jobs today stays a list of jobs assigned for today:

- The list was already only the jobs assigned to the signed-in person for today. Dates such as 18/09, 14/09 and 21/09 on that page were the time the work happened, typed in when a job was written up afterwards. They were not the day the job is listed for. Each job now says the day it is assigned for, and Done or Not done.
- The Volkswagen Golf CAS 2 line labelled Vehicle handover is the old demonstration job, not one of the four job types. The copy on Justin's own list was left over from testing and has been removed. The driver login still receives one each day, so a phone trial has a job. The mechanic login still receives the demonstration repair.

22 September 2026 — Saving a handover opens that handover's own photograph list:

- After the details are saved, the page was jumping to the first Front on the file. On TEST-0003 that was an older five-shot handover, so a new customer's-vehicle record looked like it only had five shots. Each handover now has its own place on the page, and the phone is taken to the one just saved.
- The two customer's-vehicle handovers saved from the phone at 20:22 and 20:23 on 22 September 2026 are stored as seven shots, including Dash and Chassis number. The five-shot customer's-vehicle records above them were saved earlier in the day.

22 September 2026 — A hire car needs five photographs; the customer's vehicle needs seven:

- A hire car is one of our own fleet, so a new hire handover needs Front, Rear, Driver's side, Passenger's side and Interior. Finish handover appears after those five. Dash and Chassis number are not asked for.
- The customer's own vehicle still needs those five, then Dash and Chassis number, before Finish handover appears. Dash shows the mileage and any warning lights. Chassis number shows the plate that identifies that vehicle.
- A handover already saved keeps the set it was given. The hire car Justin photographed at 20:22 on 22 September 2026 was the hire handover entered at 11:44, which only ever had the original five. It was not a new hire handover.

22 September 2026 — A taken handover photograph leaves the list:

- On a handover, a required photograph that has been saved is no longer shown as Taken. The screen lists only the shots still to take, with a count such as 2 of 5 done for a hire car or 4 of 7 done for the customer's vehicle. When all of that handover’s photographs are saved, the list is empty and Finish handover is shown. Damage photographs stay in their own optional section. The photographs themselves are stored as before.

22 September 2026 — Handover photographs now include the dash and the chassis number:

- Dash and Chassis number were first added to every new handover. The entry above corrects that: a hire car stays on the original five, and only the customer's own vehicle needs all seven. Each shot still opens the camera and moves on to the next. Damage photographs stay optional.
- A handover already saved before this change keeps the original five photographs. It is not marked incomplete for want of Dash or Chassis number, and those two shots are not added to it.

22 September 2026 — Assign a job lists staff as well as driver logins:

- The Driver list on Assign a job was only accounts with the restricted driver login. Justin, Sian, Tom and Megan were missing, although they also do recoveries, deliveries and collections. That list, and the “driver who did this” list when a job is logged afterwards, now includes administrator and staff accounts as well as driver logins. A bodyshop / mechanic login is still only offered for Repair evidence. The save accepts those same people.
- The handover record’s own Driver who did this list was still driver logins only. It now includes the same administrator and staff accounts, so a handover can name the member of staff who did it. A bodyshop / mechanic login is not offered there.

22 September 2026 — Assign a job keeps the choices already made, and confirms beside the button:

- Ticking Already completed was adding a new dropdown into the form. The browser then put Job and Driver back to the first choice, and that reset was saved into the form, so Assign job stopped with “Please select an item in the list.” Those extra fields are now on the form from the start and only shown when the box is ticked. A change the user did not make on Job or Driver is put back.
- Assign job switches off as soon as it is pressed, so a second click cannot send the form again. After it saves, the confirmation sits directly above the button: the job is saved, and the button does not need pressing again.
- The accidental Hire car delivery saved on TEST-0003 at 19:28 on 22 September 2026, from that reset, was removed from this PC’s database. The return job and the recovery jobs on that file were left.

22 September 2026 — Storage ends on the day the client's vehicle is returned after repair:

- Completing a Return client's vehicle after repair job, including one written up later with a real date and time, now sets the file's storage end to that calendar day when the file has no storage end date yet. The daily rate, recovery charges, VAT and the hire end date are not recalculated or moved.
- If a storage end date is already on the file and it falls on a different day, it is left as it is. The file shows a check: use the date from the return job, or keep the date already there. Nothing is overwritten until a person chooses. That choice is a CAS charging check, not a legal conclusion.
- Typing the storage end on the Storage screen, with no return job, still works as before.
- This is the storage-end step noted when the recovery date was linked. Hire car collection now sets the hire end on a repairable booking. That is the later entry. The total-loss rule of seven days after a qualifying payment is still not calculated.

22 September 2026 — Storage is charged from the day the vehicle was actually recovered:

- Completing a Recover client's vehicle job, including one written up later with a real date and time, now sets the file's storage start to that calendar day when the file has no recovery date and no storage start date yet. Recovered on, on the Storage & Recovery page, uses that same storage start. The daily rate, recovery charges and VAT figures are not recalculated.
- If a recovery date or a storage start date is already on the file and it falls on a different day, it is left as it is. The file shows a check: use the job's date, or keep the date already there. Nothing is overwritten until a person chooses. That choice is a CAS charging check, not a legal conclusion.
- Typing the storage start on the Storage screen, with no recovery job, still works as before.
- This closes the gap noted when jobs were added: storage was still taken only from intake or the Storage screen. Returning the client's vehicle after repair is not linked to the storage end date. That end date is still an explicit date. Using the return job's actual time as a suggested end, with the same kind of check when an end date is already there, is a sensible next stage. It is not done here.

22 September 2026 — Assign a driver and a date, including a job written up afterwards:

- My jobs today had only “Assign a job for today”: a hire handover or a repair, always for today, with no delivery-versus-collection choice and no job for the client’s own vehicle. Staff now choose Hire car delivery, Hire car collection, Recover client's vehicle, or Return client's vehicle after repair, plus a driver and a date. The date starts as today and can be earlier or later. Who does it, and when, is entered by staff. The system does not choose either.
- A job for today or an earlier date can be marked already completed, with the driver who did it and the date and time it happened. Those are typed in. They are not the person signed in, and they are not the moment the form is saved. A future date cannot be marked already done. My jobs today lists only jobs whose date is today, across those four types, including one marked done today. A past date stays on that past date.
- The handover record keeps the same split: the time it happened and the driver who did it, separate from the time the record was saved and the person who typed it. On the phone, a driver doing the job now sees their own name and the current time already filled in, and can change both. Office staff typing it up later start with those boxes empty.
- Recovering or returning the client’s own vehicle is now a job in the same list. A driver who only has that job can open the handover. The demonstration driver’s existing daily test job on TEST-0003 is unchanged.
- Storage and recovery charge dates were not taken from the new driver or time in this change. The entries above link a completed Recover client's vehicle job to the storage start, and a completed Return client's vehicle after repair job to the storage end. Daily rates are unchanged.

22 September 2026 — Handover photographs save as they are taken, and cover the customer's own vehicle:

- A photograph taken on the phone was not stored. The camera only filled in a file box. Nothing was sent until Save, and that save was a script request. On the phone the picture was dropped when the camera closed, and the same kind of script request had already been failing to leave the phone at all (the sign-in “Load failed”). The screen still said Not taken yet, because Taken only appears after a save that reloads the page. Each shot is now its own ordinary form post, sent by the page itself when the camera returns, after a brief pause so the picture is in the form. The page then comes back on the next shot: Front, then Rear, then Driver's side, then Passenger's side, then Interior. After Interior it shows Finish handover. A phone that sends the picture without a file type is still stored when the bytes are a JPEG or a PNG.
- Damage photographs are optional and capped at six. Each one uses the same camera button, labelled Add another damage photo. Once the five standard photographs are saved, Finish handover is shown even if no damage photograph was added. It marks that handover finished and returns to My jobs today.
- The driver's old list only offered “Hire vehicle delivered to client” and “Hire vehicle collected from client”. The customer's own vehicle was already a kind of handover in the records (no hire booking attached), but the driver could not choose it and the check refused it. The first choice is now Hire car or Customer's vehicle. Hire car is handed to the customer or collected from the customer. Customer's vehicle is collected for repair or returned after repair. The saved record shows which of those four it was, and the registration: the hire car's, or the customer's own from the file. A driver assigned to that file today can record either. Mileage and fuel are still required and still locked once the details are saved.

22 September 2026 — Guided handover photographs:

- Each condition photograph is a named shot: Front, Rear, Driver's side, Passenger's side and Interior. Each shows Taken or Not taken yet. Damage photographs are a separate optional list, with no fixed number.
- Open camera is the phone's camera. The button is the file control itself, with the browser's camera hint (`capture="environment"`), so a tap is not handed to a general file chooser. A saved photo on the phone is still available underneath, if the camera does not open.
- The handover stays incomplete until those five shots are present. Damage photographs, and a diagnostic scan, do not clear that flag. Mileage and fuel stay locked once the record is saved.

22 September 2026 — Sign-in from the PC’s mobile hotspot:

- The hotspot is a separate address from the office Wi-Fi. The PC is 192.168.137.1 on the hotspot, and still 192.168.1.79 on the office Wi-Fi. The phone has to open the hotspot address.
- The styled page was already allowed. Sign in was a script request, and Safari reported “Load failed” because that request never reached the server. Sign in is now an ordinary form post to the same address as the page.

22 September 2026 — Sign-in from a phone on the office Wi-Fi:

- Opening the sign-in page from the PC's network address showed plain text, and Sign in did nothing. The page itself was served. The dev server then refused the stylesheet and the scripts, because the phone sends that network address as the request origin. Localhost on the PC does not, so the same page still looked normal there.
- Development now allows addresses on a 192.168 network to load those files. The dev server has to be restarted after that change.

22 September 2026 — Driver and mechanic logins:

- Two roles were added. A driver can complete a handover (mileage, fuel, photographs) only on a booking assigned to them today. A bodyshop / mechanic can add repair photographs, diagnostic scans and a geometry report only on a repair assigned to them today. Both are refused, on the server, if they open any other address.
- The four yes/no checks (spare wheel, tools, warning lights, tyres) are no longer on the handover form.
- My jobs today lists whatever is assigned to the signed-in person for today, including an administrator or a member of staff. If nothing is assigned, it says so. Office access is otherwise unchanged.
- Repair files are a new list on the claim (Repair evidence). There was no existing place that only held repair photographs and scan reports, so this is that place. Office staff can open it. A mechanic sees only that list.

22 September 2026 — Handover on a phone:

- On a narrow screen the sidebar is a Menu, and the claims list is a card with Open file and Handover, so a driver does not have to scroll sideways to reach the form.
- Condition photographs and diagnostic scans each have Take a photograph (the phone camera) and a separate choice for a file already on the phone. A missing scan still does not mark the record incomplete.
- There is still no driver-only login. Roles are administrator and staff. Anyone signed in can open every file. A driver login, if added, would need a new role. That is not built yet.

21 September 2026 — Diagnostic scan on a handover:

- A handover can also hold an optional pre-diagnostic scan and an optional post-diagnostic scan. Each is a file from the tool (PDF, image or text). There is no live link to the scanner.
- The scans sit apart from the condition photographs. A missing scan does not mark the record incomplete. Incomplete still means the condition photographs have not been added. Attaching a scan does not change the locked mileage, fuel or checklist.

21 September 2026 — Vehicle handover:

- Staff record condition when a hire vehicle is delivered or collected, and when the client's own vehicle is recovered or returned. Each record stores mileage, fuel level (Empty, ¼, ½, ¾ or Full), a short yes/no check (spare wheel, tools, warning lights, tyres visibly legal), a damage note and photographs.
- The record is timestamped and named to the staff member who saved it. It is not edited afterwards. A correction is a new record, with the reason in the note. Photographs can be added later; until then the record is marked incomplete and is still saved.
- The latest delivery handover fills mileage and fuel level on the Hire Agreement hire page. The latest recovery handover fills mileage and fuel on the Storage & Recovery page. Tyre depths in millimetres, a hand-drawn diagram, tax disc, CD magazine and sat nav disc are not on the handover screen.

21 September 2026 — Hire Agreement print layout:

- Printing used the on-screen sidebar grid. With the sidebar hidden, the agreement fell into the leftover 240px column, so a 4-part file ran to about 35 physical pages.
- Print is now A4 with ordinary margins and the full text width. The sidebar and the prototype banner are omitted. Each logical part starts on a new physical page. Clause wording, numbering and the “1 of 4” labels are unchanged. Those labels count logical parts, not physical sheets.
- Regenerated TEST-0003 (hire and storage: logical 1 of 4 to 4 of 4) prints to 10 physical pages. TEST-0004 (hire only: logical 1 of 3 to 3 of 3) prints to 9. Terms still include the supplied wording, including the 89-day rental period and “without demand. unless”.
- Stored V5C pages are still drawn as images by a separate route. That route was not changed.

21 September 2026 — Stored PDF viewer:

- Opening a stored V5C no longer embeds the raw PDF in the page (Chrome's plugin froze the CRM). Pages are drawn as images; the original can be downloaded. The rest of the screen stays usable if a page cannot be drawn.

Blocked: per-file permissions, shared hosting, live DVLA. Incoming mail is not built. Automatic no-click chasers are a later decision. Microsoft 365 send, where configured, lives only in this computer's local environment and is not stored in the project.

## Microsoft 365 outbound send (1 October 2026)

- A person still reviews each email and clicks Send. Nothing sends itself. Reading replies is not part of this stage.
- The mailbox is `claims@cascar.co.uk`. Credentials are environment variables only. They are not on the Settings screen, not in source code, and must not be committed.
- Set all three, or leave all three unset. Credentials alone do not send. From 13 October 2026 a real send also needs `EMAIL_SEND_MODE` set to the exact value `live`. If that flag is missing or anything else, the send is simulated.
  - `CAS_M365_TENANT_ID` — Directory (tenant) ID from the Microsoft 365 app registration
  - `CAS_M365_CLIENT_ID` — Application (client) ID
  - `CAS_M365_CLIENT_SECRET` — client secret value
- Put them in the process environment, or in a local `.env` file (git already ignores `.env`). `.env.example` lists the names with no values.
- The app registration needs Microsoft Graph application permission **Mail.Send**, admin consent, and permission to send as `claims@cascar.co.uk` only. Tests use a mocked mailbox, not a live one.
- A failed send stays prepared, is shown as a failure, and can be tried again. Invalid or expired credentials are reported as a configuration error. A second click while a send is in progress does not send a second copy. A successful send is logged on the file history with who sent it, when, and to whom.
- Hire pack cover letters are sent from the communications screen (fill the template, then Send). The hire pack document itself is still a file on the claim, not an email.
- Creating a new claim does not send mail by itself. The recovery-agreement note on a new file stays the existing simulated record.

## Send to, on the general email (2 October 2026)

- On Email / WhatsApp / Calls, the general Send email box now starts with **Send to**. Staff choose Client, Client's own insurer, Third party (insurer), Third party representative, Engineer (only when one has been instructed on the file), or Other / type manually. Third party representative is always in that list. If none is recorded, the screen says there is no email on file.
- Client's own insurer uses the Email already saved on the Client insurer screen. No new contact field was added. If that box is blank, the screen says there is no email on file. None of the saved email templates are written for the client's own insurer, so the list stays empty and the message is typed. The fault claim letter stays under Generate a document.
- Choosing a role fills that contact's saved email. If the role has no email, the box stays empty and the screen says there is no email on file. Nothing is invented. The address can still be typed or changed. A typed address is not replaced by another role until the person confirms.
- Third party representative uses the name already stored as the representative, or the third-party insurer's agent on Third party 1. The email is the agent's saved email, then the agent handler's email. A representative name on its own has no address, so the option appears and says no email is on file.
- Instruct Engineer and the chase screens are unchanged. Sending itself is unchanged.
- Send to is the first choice in that box. The template list then shows only templates written for that recipient. Client gets the client emails (welcome, status, total-loss update, vehicle ready, case closed). Third party (insurer) and a recorded representative get the two payment chases. Client's own insurer has no template in this list; the message is typed. Other / type manually shows every template. An instructed engineer has no template in this list; the message is typed, or Instruct Engineer is used.
- Hire pack cover, the initial insurer letter and the liability chaser stay under Generate a document. They are not in this email list. The client paper chase stays on its own prepared email.
- Tests: `tests/send-to.test.ts` (six cases, including the client's own insurer blank address, overwrite confirmation, and empty template list). Full suite: 254 passing, 0 failing.
- Next: reading incoming mail and matching replies to the right file. Automatic no-click chasers remain a separate decision.

## Documents on an outgoing email (2 October 2026)

- The general Send email box lists documents already stored on that claim. Each one starts unticked. Nothing is attached unless a person ticks it.
- A generated letter or hire agreement (the saved page) goes out as that page. An uploaded file, such as a V5C, licence, insurance certificate or handover photograph, goes out as the stored file. A document that is not on this claim cannot be attached.
- If the claim has no stored document, the box says so and the email can still be sent as text.
- An email with documents is saved as a draft, each document is attached on its own, and the draft is then sent. A file under 3 MB is attached in one call. A file of 3 MB or more is uploaded in pieces, which is the method Microsoft requires for a larger single file. A plain email with nothing attached still uses the single send call.
- The screen refuses a selection over 35 MB and does not send. 35 MB is Exchange Online's published default for a whole message. This app cannot read this mailbox's own limit. Graph will accept one file up to 150 MB only if an administrator has raised the mailbox limit. A failed send deletes the draft, is not marked as sent, and the ticked documents stay ticked.
- Saving that draft needs Microsoft Graph application permission **Mail.ReadWrite**, with admin consent, on the same app registration that already has Mail.Send. Without it, Microsoft refuses the draft and nothing is sent.
- The sent email on this file, and the file history, name the documents that went with it.
- Tests: `tests/email-attachments.test.ts` (six cases). Full suite: 253 passing, 0 failing.

## Claims mailbox only (2 October 2026)

- The CAS CRM app registration (application ID `6979ea43-e90c-4dba-a3d0-92d0047d9b6a`) is limited to `claims@cascar.co.uk`. Exchange Online application access policy, access right **RestrictAccess**, description “Restrict CAS CRM app to claims@cascar.co.uk only”.
- `claims@cascar.co.uk` is a shared mailbox, so Microsoft will not take that address as the policy scope on its own. The scope is the mail-enabled security group **CAS CRM claims mailbox** (`cas-crm-claims-mailbox@cascar.co.uk`), whose only member is the claims mailbox. Do not add other mailboxes to that group. Do not delete the group. Do not remove the policy to get a send working on another mailbox.
- Checked the same day: `Test-ApplicationAccessPolicy` returned **Granted** for `claims@cascar.co.uk` and **Denied** for `justin@cascar.co.uk`. Microsoft says the restriction can take up to 30 minutes to apply to live mail. The test already showed the denial.

## Financial circumstances, impecuniosity and mitigation (6 October 2026)

- A claim has a Financial circumstances section. Staff record employment, approximate income and benefits in the client's own words, and the client's own answer to whether they could have paid for a replacement without a sacrifice they could not reasonably have been expected to make. That question is drafted close to the Lagden test and is flagged for Justin to review. It is not a finding.
- The evidence checklist is Not started, Requested, Partial or Complete. Bank accounts, wage slips and benefit award letters are listed one by one. Files are stored with the existing document upload, tagged Impecuniosity evidence. The status changes only when a handler sets it. Uploading files does not mark it Complete, and Partial is not promoted on its own. A handler can note a disclosure concern. The system does not draft that note.
- If the client has no bank account or is paid in cash, their explanation can be saved. The section is not blocked.
- A later change of circumstances, or a correction of the mitigation statement, is a new dated entry. The earlier entry stays.
- The mitigation statement uses the Hire Pack questionnaire already in the CRM (offer of a replacement or not, personal liability, why a vehicle is needed, own vehicle unusable, no other suitable vehicle, statement of truth). There is no separate "how long" question on that page. Duration is recorded in the client's answer to why they need a vehicle. A signature is not added.
- An administrator can approve relying on impecuniosity. That flag is separate from the checklist. The impecuniosity disclosure letter, and an email that uses the assertion wording, is refused until the checklist is Complete and that approval is set. The screen states the reason. A generated hire pack leaves that assertion out until both are in place. A complete checklist does not mean the charges can be recovered.
- There is no client form for this. Staff enter it. Circumstances, the checklist, mitigation and concerns are new dated entries, so two people can add them at the same time and both are kept. Earlier dated entries stay. From 15 October 2026 a save that edits one screen no longer silently overwrites another person's save of that same screen.
- The research note was not in the project on 6 October. Justin supplied it on 7 October. It is stored at `docs/impecuniosity-legal-research.md`. Letters were not rewritten from it.
- Tests: `tests/impecuniosity.test.ts` (five cases: dated circumstances, checklist not promoted by files, approval gate on the letter and an asserting email, mitigation versions, hire pack withholding the assertion). Full suite before this stage: 254 passing, 0 failing. After: 259 passing, 0 failing.

## Send to — third party representative always listed (7 October 2026)

- Third party representative was left out of Send to when the claim had no representative recorded. Client, Client's own insurer and Third party (insurer) were already shown in that case, with “no email on file”. The representative option now stays in the list on every claim and uses that same message when no contact is saved. An engineer is still shown only after one has been instructed on the file.
- Tests: `tests/send-to.test.ts` now includes a case that the recipient list stays complete when the claim has no contacts. Full suite before this fix: 259 passing, 0 failing. After: 260 passing, 0 failing.

## Impecuniosity research note (7 October 2026)

- Justin's note is filed at `docs/impecuniosity-legal-research.md`. It is background for the evidence checklist and the approval gate. It is not legal advice, and it is not a finding on any file.
- The checklist already refused an impecuniosity document until a handler marked it Complete and an administrator approved relying on it. A disclosure concern stayed on the file. A complete checklist was already stated not to mean the charges can be recovered. Those rules are unchanged.
- The listed evidence set now also names household expenditure or commitments, and other income or support (savings, family help, a joint account), alongside every bank account, wage slips and a benefit schedule. Listing one still does not mark the checklist Complete. The screen says a gap stays visible.
- The ability-to-pay question is still the draft close to Lagden, flagged for Justin to review. Existing letters that already cite Lagden still say [2003] UKHL 64. The note now uses [2003] UKHL 64; [2004] 1 AC 1067, matching the letters' neutral citation.

## Pre-hire checks (7 October 2026)

- A hire agreement cannot be generated until two things are on the file, on every hire, including a fault courtesy file. Each person who will drive the hire vehicle needs a licence check. The file also needs bank-statement evidence. There is no administrator override and no control that approves it anyway.
- The people who will drive are: anyone recorded on the file as a driver; anyone named on Client driver details; and each additional driver named on the hire pack or on Additional drivers. An owner, hirer or client who is not one of those is not included. If nobody is recorded as a driver, the client is treated as the person who will drive. The licence number already stored on the file is not the check.
- Staff type what the free check at gov.uk/check-driving-licence showed: the check code, categories, points and endorsements, expiry, the date checked, and the system records who entered it. The CRM does not call DVLA. No DVLA account is waiting. Automated checking could be revisited only if CAS ever secures bulk DVLA access. Nothing here connects to an API.
- Bank statements are the existing Financial circumstances list. There is no second upload area. A listed bank account satisfies that half. A saved explanation that the client has no bank account, on the latest financial-circumstances entry, also satisfies it. The evidence checklist does not need to be Complete, and approval to rely on impecuniosity is a different gate. A stored file on that page is not labelled as a bank statement, so the file on its own does not count. Wage slips do not count.
- 21 days is the demonstration window used on screen. It is not a DVLA ruling. Superseded on 28 October 2026: a check older than the Settings window now blocks the agreement and the handover. See Hire checks (28 October 2026).
- The refusal is in `generateHireAgreementDocument`, before an agreement number is allocated and before the document is inserted. A direct call is refused. There is no separate preview-for-signing or mark-ready-to-sign step in this CRM. Generating the agreement is the step that files it, and the copy stays unsigned. The Hire Pack screen shows the same reason. The button is not the only block.
- Tests: `tests/prehire-checks.test.ts` (six cases: who counts as a driver, direct refusal with nothing filed, bank evidence missing, a saved no-bank explanation, an extra driver without a check, and a stale check still counting as recorded). Full suite before this stage: 260 passing, 0 failing. After: 266 passing, 0 failing.
- On 9 October 2026 a separate permission was added so one missing check can be overridden on that file. See the next section. The hard refusal remains for anyone who does not have that permission.

## Pre-hire check override (9 October 2026)

- There is a staff permission called `overridePreHireChecks`. It is a row in `staff_permissions` for that account. It is not the administrator role. It is not approval to rely on impecuniosity. Being an administrator does not grant it.
- Justin Roberts's account is the only grant. That is staff id `staff-justin`. The seed writes the row, and the migration writes it again for a database that already has his staff row, without wiping the database. Sian is not granted it. A later grant is a change to that table. The gate does not check the username.
- Two actions, recorded separately: override the licence check, or override the bank-statement check. Each one needs a typed reason. There is no override without a reason. Overriding one does not override the other. The override is stored on that claim only (`prehire_overrides`: who, when, which check, and the reason). It does not relax any other claim. The row stays if the missing evidence is added later. It is not deleted or hidden.
- Once that check has an override on the file, `generateHireAgreementDocument` no longer refuses for that check. The other check still refuses if it is missing and has no override. The permission is checked in `recordPrehireOverride`, which is the only way to write an override. `hireAgreementPrehireBlock` and `generateHireAgreementDocument` do not take a bypass flag and do not read the caller's role. A direct call from an account without the permission is refused. Staff without the permission see the existing hard refusal and no override form.
- Tests: `tests/prehire-checks.test.ts` (the earlier six cases, plus the permission flag against the administrator role, Sian and a second administrator refused on a direct call, each check overridden on its own, generation after the relevant override, the record kept after evidence is added, and the migration grant). Full suite before this stage: 266 passing, 0 failing (last confirmed on origin/main 04a87ad; not re-run before these edits). After: 271 passing, 0 failing.

## Payment-request pack ticks (9 October 2026)

- Choosing **Payment chase 1 — first reminder** (`payment_chase_1`) or **Payment chase 2 — final warning** (`payment_chase_2`) on Send email pre-ticks the payment-request pack that is already stored. There is no email template titled payment request. Both chases are emails staff use to ask the third-party insurer for payment, and they use the same selection. The hire pack cover letter stays under Generate a document. Those two names left the free-standing template list later the same day. See Tracked payment chase below. The pack selection itself was kept and now sits on the prepared chase email.
- The ticks are a review. Nothing is sent until the handler clicks Send. The handler can untick a document or tick others. A claim with none of the pack stored still sends as text if nothing is ticked.
- The pack is: the payment request letter (the stored hire pack cover letter, current version only), the current signed hire agreement, the client's V5C, the client's driving licence, the client's insurance certificate, the hire vehicle's V5C, and CAS's own insurance certificate. Compose does not generate the letter. If it is not already stored, the line says “Payment request letter — not on file”. Other gaps use the same pattern, for example “Signed hire agreement — not on file”. They are not skipped and not replaced with a different document.
- Older versions stay in the manual list, unticked. Only the current version of each item is pre-ticked. For the hire agreement, that is the current signed copy. An unsigned copy is not used in its place.
- A selection over 35 MB is refused by the existing mailbox limit (`MAILBOX_ATTACHMENT_LIMIT_BYTES` / `attachmentsExceedMailboxLimit`). Nothing is sent. The same refusal covers a manual selection.
- CAS's own insurance certificate did not already have a home. It is now a company file on Settings, not a document on one claim. Until a certificate is stored there, Settings and the payment-request email say “CAS's own insurance certificate — not set up”. No certificate file is invented. Storing one does not send an email. A newer copy becomes the one that is pre-ticked. The earlier copy stays in the manual list.
- Tests: `tests/payment-request-pack.test.ts` (eight cases). Payment chase 2 uses the same pre-tick as Payment chase 1: nothing stored, and the current version of all seven. Full suite before this stage: 271 passing, 0 failing (origin/main 59a0124). After the pack was added: 277 passing, 0 failing. After Payment chase 2 was included: 279 passing, 0 failing.

## Tracked payment chase (9 October 2026)

- Payment chase 1 and Payment chase 2 are no longer free-standing emails in the composer. They had no balance behind them. The wording is reused inside a tracked chase. Past `payment_chase_1_sent` and `payment_chase_2_sent` rows are kept. New sends still write those history events. They are not deleted.
- One chase follows the outstanding repair invoice. A separate chase follows the agreed total-loss settlement, and only on a total-loss file. Storage is not added into the repair figure, and there is no storage-payment chase. A claim can have both a repair chase and a settlement chase.
- The chase uses the same engine as the engineer-report, liability-response and repair-authorisation chases: one row per file, pause, resume, cancel, and the existing three-day reminder. That three days is the demonstration reminder interval already used by those chases. It is not an insurer payment term. After the first send is recorded, the next reminder is prepared when that interval has passed. An outage leaves at most one catch-up reminder, not one for every missed interval.
- Staff review the email and click Send. Nothing sends itself. The email states the outstanding figure and the bank details already stored under Settings. If the bank details are blank, it says payment details are not yet on file. It does not say “please arrange payment” with no figure.
- The insurer payment term (how many days until the money is due) is a Settings box with no default. Justin has not confirmed whether that is 14 days, 28 days, or another number, so no number has been written in. Until it is set, the prepared email says the term is not set and does not invent a due date.
- A part-payment is recorded on that head only, the balance goes down by that amount, and the chase pauses for review. It is not treated as paid. Staff can resume and the next email chases the amount still outstanding. Paying the outstanding balance in full stops that chase. Hire and storage are flagged for review. They are not closed. A total-loss full payment can still suggest a hire end seven London days later. Staff confirm that date. A partial payment does not suggest it. Storage end stays a date someone enters.
- A reply that disputes the figure, queries it, or makes a part-offer pauses the chase. An acknowledgement does not resolve it. Wording the system cannot classify is flagged and left as it is.
- A payment with no reference is flagged. It is not guessed onto a claim or a head of loss. Two figures logged quickly against the same balance: if the second is ticked as a correction within two minutes, it replaces the first so the money is not counted twice. A second payment that is not ticked as a correction is added, which is how total-loss receipts already worked.
- The document pack that used to pre-tick on Payment chase 1 and 2 now pre-ticks on the prepared payment chase. Current versions are ticked. Missing items are named. Nothing is sent until Send.
- Tests: `tests/payment-chase.test.ts`. A part-payment pauses, reduces the balance, and is not paid. Full payment stops the chase and flags hire and storage without closing them. A reminder is due after the interval. An outage leaves one catch-up reminder. Full suite before this stage: 279 passing, 0 failing. After: 288 passing, 0 failing.

## Review payment (12 October 2026)

- When money arrives on recovery, storage, hire, repairs, or total loss and does not cover the figure for that head, the file keeps one item for that head. It shows the amount received, the amount still outstanding, and the insurer's stated reason for paying less. If they gave none, it says "no reason given". A reason is never invented. Logging the payment does not open the choice. See the next section.
- If that head has an agreed figure, the outstanding amount is against the agreed figure. If nothing is agreed, it is against the claimed figure (claimed minus received). Claimed and agreed are not added together. A part-payment still reduces the balance and pauses the repair-invoice or total-loss settlement chase. The review is the decision on top of that pause. Storage still has no payment chase of its own.
- On a total loss, receipts are compared with the agreed pre-accident value minus salvage proceeds already on the file. Sale proceeds are used when a sale figure is recorded. Otherwise the engineer's salvage value is used, the same subtraction as the existing net suggestion. Nothing is subtracted when the insurer is taking the salvage. The two salvage figures are not added together. Example: agreed pre-accident value £13,150.00 and salvage £190.75, so the receipt is compared with £12,959.25. If salvage is recorded or corrected after the payment, the outstanding figure is worked out again from the figures then on the file.
- A payment that matches that figure stops the chase and flags hire and storage for review. It does not close them, and it does not write a hire end date. The existing hire-end suggestion still appears only when the amount received equals the agreed vehicle-damage figure on the file, and only when staff confirm it.
- **Accept as final** sets the agreed figure on that head to the amount received, records the shortfall as a write-off with the insurer's reason (or "no reason given"), and stops the chase on that head. It does not close hire or storage. It never runs on its own. It needs the permission `acceptPaymentSettlement`, a row in `staff_permissions`. The seed and the migration grant it to Justin Roberts's staff row (`staff-justin`) only. Sian is not granted it. Being an administrator does not grant it. The check does not read the username. A direct call from an account without the permission is refused.
- **Dispute / keep chasing** does not need that permission. The agreed figure stays as it was, or stays unset. The chase resumes for the balance still outstanding, and the grounds are the words staff type. A later payment that completes the figure stops the chase in the normal way and flags hire and storage without closing them.
- Each head is separate. A review on hire does not change storage, repairs, or the pre-accident value.
- A payment on a head that has no claim or invoice at all is flagged for manual reconciliation. No financial record is created from nothing. Two payments before the review are one item: a normal second payment is added, and a correction ticked within two minutes replaces the last figure so it is not counted twice.
- Tests: `tests/payment-review.test.ts`. Full suite before this stage: 288 passing, 0 failing. After: 301 passing, 0 failing.

## Payment decision is a separate step (12 October 2026)

- Logging a payment records the amount on one head and nothing else. It does not open Accept as final or Dispute. Staff can record the money and leave the file.
- If the amount does not cover that head, the chase pauses as it already did. The file and the dashboard then show **Awaiting decision** for that head, in the same amber list as the other chase reminders. It stays until someone opens it. It is not a popup. A second payment before any choice updates the received and outstanding figures on that same item. There is still one item per head.
- Opening Awaiting decision shows the figures then on the file, and Accept as final and Dispute / keep chasing, one under the other. Those two actions are unchanged, including the permission on Accept and the salvage figure on a total loss.
- After Dispute, a later payment reduces what is still outstanding. The chase is already going for the remainder, so it does not pause again and it does not open another Awaiting decision. A later payment that meets the figure still stops the chase in the normal way.
- After Accept as final, a later payment on that head is flagged under **Payments to review** on the file and on the dashboard. It is not added to the agreed or received figures.
- Tests: `tests/payment-review.test.ts`. Full suite before this stage: 301 passing, 0 failing. After: 306 passing, 0 failing.

## Head of loss screens (12 October 2026)

- Three screens open from the file: **Recovery and storage**, **Hire**, and **Vehicle damage**. Recovery and storage are two sections on one screen, and each keeps its own figures. Vehicle damage shows repairs, or total loss, whichever the file is now. It does not show both.
- Each section shows claimed, agreed, received, outstanding, and a status in plain words: nothing recorded yet, awaiting decision, active chase, paused, disputed, or settled. On a total loss the agreed figure is the pre-accident value minus salvage proceeds already recorded, until that shortfall is accepted. After acceptance, salvage is not taken off again.
- Accept as final and Dispute sit on that screen, with the payments, decisions, write-offs and chase activity listed underneath. Accept as final asks for confirmation of the write-off before it is saved. It still does not close hire or storage.
- The file and the dashboard keep the short Awaiting decision and Payments to review lines. Those lines, and the head names in the file's financial table, open the matching screen. Logging a payment still does not open the choice.
- Tests: `tests/head-screen.test.ts` and `tests/payment-review.test.ts`. Full suite before this stage: 306 passing, 0 failing. After: 311 passing, 0 failing.

## Chase name follows the file (12 October 2026)

- The repair-authorisation chase is unchanged underneath. On a repairable file it is still called **Repair authorisation chase**. On a total loss, including a file later declared a total loss, the same chase is called **Total-loss agreement chase**. The dashboard row and the file's next action use that name. The dashboard heading covers both. Full suite: 312 passing, 0 failing.

## Recovery screen charges (12 October 2026)

- The Recovery screen is grouped into recoverer, the recovery itself, what was collected, and charges. Out of hours, environmental and winch sit together. Each shows its fee beside the tick.
- Those fees fill in when ticked: out of hours £100.00 net, environmental £150.00 net, winch £95.00 net. They sit with the existing defaults, recovery £395.00 net and storage £39.00 a day. Unticking an extra takes it out of the total. A figure typed on that job is kept if the box is unticked and ticked again. The standard recovery charge fills in at £395.00 and can still be changed on the job.
- VAT and the total are worked out from the standard charge and the extras that are ticked. They are not typed again. Type of vehicle recovered uses the same list as the fleet: car, van, motorcycle, campervan, and wheelchair-accessible taxi.
- Tests: `tests/recovery-charges.test.ts`. Full suite before this stage: 312 passing, 0 failing. After: 318 passing, 0 failing.

## Agreed figures and payments on the head screens (12 October 2026)

- Each head screen now has **Record a payment** for that head only. It is the same payment action as on the file. Recovery and storage each have their own.
- **Record agreed figure** on Vehicle damage is the existing repair-invoice box when the file is repairable, and the existing total-loss buttons (**Use this suggestion as the agreed amount** and **Save this as the agreed amount**) when it is a total loss.
- Hire, recovery and storage now have their own **Record agreed figure** box. It stays blank until staff type the figure the insurer has agreed. It is not filled from the claimed amount. Saving it does not change the amount already received, and it does not pause, resume or cancel a chase that is already running. From then on, a payment on that head is measured against the agreed figure. If a short payment was already being compared with the claimed figure, the outstanding amount is worked out again from the agreed figure.
- Tests: `tests/agreed-head.test.ts`. Full suite before this stage: 318 passing, 0 failing. After: 323 passing, 0 failing.

## Recovery card fee and something else (12 October 2026)

- The Recovery screen Charges section has two more optional lines. **Card fee** is 4.5% of the other net charges (the standard charge and any ticked extras, before VAT). It is added only when ticked, on its own line, and VAT at 20% applies to it with the rest. It fills in from the current charges and changes if those charges change. A figure typed on the job is kept, including if the box is unticked and ticked again. Clear that figure to go back to 4.5%.
- **Something else** is for a charge that is not on the list, such as dealing with a fallen tree. Ticking it shows a description and an amount. The amount starts blank. There is no default. When both are filled in, the amount is added into VAT and the total in the same way as the named extras. A description without an amount, or an amount without a description, is refused and is not saved as £0. Unticking takes it out of the total and keeps what was typed.
- Tests: `tests/recovery-charges.test.ts`. Full suite before this stage: 323 passing, 0 failing. After: 327 passing, 0 failing.

## Offers on the Vehicle damage screen (12 October 2026)

- The Vehicle damage screen now keeps **Offers** apart from **Agreed**. Each offer has an amount, the date of the offer, and an optional note. A later offer is added to the list. The earlier one stays. The newest open offer is shown first; older offers, and any marked withdrawn or lapsed, stay visible underneath. Nothing is deleted.
- Recording an offer does not set the agreed figure. **Use this figure** copies that offer into the agreed amount and date so they can be changed before they are saved. The agreed figure can also be typed on its own, with the date agreement was reached. Saving it again corrects it. The amount already received is not changed. What is still outstanding is still the agreed figure when there is one, otherwise the claimed figure, minus what has been received.
- An existing file with an agreed figure and no dated offers still opens. The offer list says no offers are recorded. A single offered figure already stored without a date is mentioned, and is not turned into a history entry.
- **Use this figure** fills the agreed amount and date, brings those boxes into view, and highlights them. They were already being filled; they sit further down the page, so a press at the top did not show that anything had changed.
- **Reject** records that CAS declined the offer. An optional note is kept with it. The row stays, labelled Rejected, with the date. **Use this figure** remains available until Reject is pressed, and is not offered once the offer is Rejected, Withdrawn or Lapsed. Withdrawn means the insurer pulled it back. Lapsed means it expired.
- Pressing **Record offer** once does not insert two rows. A second save of the same amount, date and note, while that offer is still open, is ignored for one minute. That is what produced the two identical £13,000 rows on TEST-0009: two separate saves, 37 seconds apart, with the page loading again between them. It was not the development server inserting twice from one press.
- Hire, storage and recovery use this same offer list. Recording an offer does not change claimed, agreed or received.
- Tests: `tests/vehicle-offers.test.ts`. Full suite before this stage: 327 passing, 0 failing. After this correction: 335 passing, 0 failing.

## Live ledgers labelled (13 October 2026)

- The head screens remain the record of claimed, offered, agreed and received. Assessed damage and Financial summary were not rebuilt and still store what they stored before.
- On Assessed damage, the engineer’s valuation, labour, parts, VAT and total reserve are labelled as notes only. They do not update claimed, offered, agreed or received. Ticking Total loss still marks the file as a total loss. When the file is a total loss, the engineer’s report panel above those notes is labelled as the section that updates the vehicle damage ledger.
- Financial summary says plainly that nothing entered there updates the live ledgers or feeds automatic chasing, and links to the vehicle damage, hire, and recovery and storage ledgers.
- File screens, under Engineering / repairs, now includes **Vehicle damage ledger**. The vehicle damage diagram has the same link. Both open `/claims/[id]/heads/vehicle`, which shows repairs on a repairable file and total loss on a total-loss file.
- The hidden loss-of-use page still has the same fields. Saving it no longer writes dates into the file chronology. It is left as it is for the next stage, which is to turn it into an automated chronology.
- Financial summary and the Assessed damage notes stay as working notes, not the record of truth, until a later decision.
- Hire’s ledger still has no offer history. Recovery and storage do not have that list either.
- Tests: `tests/ledger-signpost.test.ts`. Full suite: 340 passing, 0 failing.

## Hire and repair chronology (13 October 2026)

- Each claim overview now has a Hire and repair chronology. It lists, in date order, only history lines the file already has: accident, recovery completed, engineer instructed, the initial letter to the third-party insurer, the initial letter to the client's own insurer, the engineer's report received, each chaser that was marked as sent, hire ended, and storage ended.
- It reads `claim_events`. It does not write a second log, and it does not change history or automations. A claim with only some of those steps shows those steps. A claim with none says so. It does not invent the missing ones.
- Where the stored note says the letter was generated (`Recorded from generated …`), the line is marked Generated only. Where the stored note says it was sent (`Marked as sent`, `Sent from`, `sent from`, `Sent by`, or the mailbox `sent to … from …` wording), the line is marked Sent. A note that says neither is shown as stored, and is not labelled sent.
- Inspection date, the report sent to the insurer, the vehicle received for repair, parts ordered, and repair completed are deliberately not on this list. They are not reliable history lines yet, and they are queued for the next two stages.
- The hidden loss-of-use dates are not used here.
- Tests: `tests/justification-chronology.test.ts`. Full suite: 344 passing, 0 failing.

## Email send mode (13 October 2026)

- `claims@cascar.co.uk` can send through Microsoft 365. That connection is unchanged. It sends only when `EMAIL_SEND_MODE` is exactly `live`. If the variable is missing, empty, or any other value, the mode is simulate, even when `CAS_M365_TENANT_ID`, `CAS_M365_CLIENT_ID` and `CAS_M365_CLIENT_SECRET` are all set.
- Every outbound email uses `sendOutboundEmail`. That includes the in-claim Send screen, prepared emails, attachment sends, chase mailbox delivery, document and payment-pack emails, and the engineer-instruction mailbox send. In simulate it records `simulated_sent` and does not call Microsoft Graph. In live it attempts the Graph send. If live is on and the credentials are missing or rejected, the screen shows the failure. It is not recorded as sent, and it does not quietly switch back to simulate.
- The bar on screen reads that same flag. Simulate says “Simulated — no real email will be sent”. Live says “LIVE SENDING ENABLED — this will send a real email”.
- The left sidebar footer uses that same sentence for the email half. Prototype, fictional test data, and simulated lookups stay as they are. Simulate no longer says a fixed “No live sending” that would still appear if the mode were live. Tests: `tests/email-send-mode.test.ts`. Full suite: 353 passing, 0 failing.
- Settings has “Check Microsoft 365 sign-in”. That asks Microsoft for an application token only. It does not send an email. Simulated day-to-day use does not need it.
- This computer is set to simulate in the local `.env`, which is not committed. Tests mock the network. They do not send.
- Tests: `tests/email-send-mode.test.ts`. Full suite: 352 passing, 0 failing.

## Repair steps on the hire and repair chronology (13 October 2026)

- The hire and repair chronology still lists every step it already showed: accident, recovery completed, engineer instructed, both initial insurer letters, the engineer's report received, each chaser marked as sent, hire ended, and storage ended. Generated only and Sent still come only from the note already stored on that line.
- Two repair steps are now included, from `claim_events`, when the file is being repaired. **Repairs started** is the event `repairs_started`. **Repairs complete** is the event `repairs_complete` (repair completed). They take their place by the stored `occurred_at`, then `recorded_at`, then id. The list does not put them in a fixed order and does not invent a date.
- Repair applies when the file is not a total loss and an engineer has been instructed, or a repair event is already on the file. A total loss shows none of these repair steps. A file with no engineer and no repair event, including a fault file that never went to repair, shows none of them either.
- Where repair applies and one of those two events is missing, the chronology says that step is not recorded. That line has no date and sits after the dated steps.
- Inspection date is still not recorded by the system. There is no dated history line for it, and it was not added.
- The report sent to the insurer is still not recorded. The engineer's report received is a different step and was already on the list. Sending that report on to the insurer is not a stored event, and it was not added.
- The vehicle received for repair is still not recorded. `repairs_started` is the start of the repairs, not the date the vehicle was received. A handover that collects the customer's vehicle is collection for repair, not receipt at the repairer. Neither was used as that milestone.
- Parts ordered is still not recorded. It was not added.
- The hidden loss-of-use screen still stores typed dates in `claim_screen_data` only. Saving it does not write `claim_events`. Those dates are notes, not history. None of them was copied into this chronology. The repair start date on that screen is not the `repairs_started` history line.
- The list remains read-only.
- A lapsed insurer offer stays on the vehicle damage offer list. It is not the current offer. Claimed, agreed and received are unchanged. That uses the same action as withdraw and reject.
- Tests: `tests/justification-chronology.test.ts` and `tests/vehicle-offers.test.ts`. Full suite: 358 passing, 0 failing.

## Hire and storage end dates (13 October 2026)

Three decisions, confirmed:

1. On a repairable claim, hire is charged up to the date CAS collects the hire car. That already worked. Completing the hire-collection job still writes `hire_episodes.billing_end_at`. That trigger was not changed.
2. On a repairable claim, storage of the client's own vehicle is charged up to the date the repair is authorised. The date is proposed on the claim. It is stored only when a handler confirms it, in the same way as the total-loss hire-end confirmation. A chase asking for authorisation does not close storage. A repair payment does not close storage.
3. Total-loss hire is unchanged. Hire still ends seven days after the qualifying payment, and only once a handler confirms that suggestion. `confirmTotalLossOffHire` was not changed.

Repair authorisation is already stored. There is no separate authorisation column. The date is the `occurred_at` of the history line `repairs_authorised` ("Repair authorisation received"). Authority and payment are separate events: `repairs_authorised` and `repair_payment_received`. If authorisation is withdrawn, the line is `repairs_authorised_cleared`. The latest unretracted authorisation is the date that is proposed. Nothing new was invented for that date.

Letters, the hire-pack agreement and the hire agreement take the hire period from the stored chargeable hire end (`hire_episodes.billing_end_at`). If that date is empty they say "Hire continuing" and the letter is flagged as missing that date. They do not fall back to the vehicle-return date, the collection date, the pack "Date in" note, or the scheduled off-hire date. There is no generated schedule of loss. The only schedule of loss in the system is a document title already on a seeded file. It was not given a hire period.

When the repaired vehicle has been returned and the hire car has been collected on a different Europe/London day, the claim shows both dates and a warning such as "Hire charged 2 days beyond vehicle return". The warning does not change the hire charge.

The physical return ("Repaired vehicle returned to customer") now sets `repaired_vehicle_returned`. It does not write the chargeable storage end. The car can still be at CAS after storage charging stops. "Vehicles in storage" still counts a vehicle that is physically on site. "Chargeable storage" drops it once the confirmed end date has passed. The end date itself is still a chargeable day.

A handler can type a different storage end. If it is not the authorisation date, a reason is required. Saving without that reason is refused. A confirmed date is not overwritten when authorisation is revised or withdrawn, or when the file is later marked a total loss. Those cases are flagged for review. The date already on the file stays until someone chooses.

Seeded hire and storage end dates already in the database were not rewritten. Reading a file only flags a mismatch.

`hire_episodes.collection_at` existed but the application never wrote it. Completing a hire-collection job now records that day when the field is empty, so the gap warning can compare it with the vehicle-return date. An existing collection date is left as it is. The hire charge is still `billing_end_at`.

Still not stored, so not used: inspection date, the report sent on to the insurer, the date the vehicle was received for repair, and parts ordered. The hidden loss-of-use screen is still notes only.

Tests: `tests/hire-storage-end.test.ts`. Full suite: 369 passing, 0 failing.

## Storage and recovery pages (14 October 2026)

Storage and recovery each have their own page. Storage is `/claims/[id]/heads/storage`. Recovery is `/claims/[id]/heads/recovery`. The old combined address `/claims/[id]/heads/recovery-storage` redirects: recovery when the link says so, otherwise storage. The old Storage and Recovery file-screen addresses redirect to those pages.

The storage charge is calculated. Days run from the start date to the confirmed chargeable end. A confirmed end is final and has no provisional label. When the end is only proposed, the days run to that proposed date, not to today, and the label is "Provisional, to proposed end [UK date], awaiting confirmation". Days run to today (Europe/London), labelled "Provisional to today", only when there is no end date of any kind. Both the first day and the last day are counted. Justin confirmed this counting rule on 14/10/2026. Storage from 22/09/2026 to 01/10/2026 is 10 days. The same inclusive count applies to hire. Hire agreement renewal alerts were not changed: they still use the agreement day number, where day 1 is the agreement start day, with the amber warning on day 70, the red alert on day 80, and the maximum on day 88. The daily rate starts at £39 (3900 pence) from Settings. A file with no rate of its own uses the current setting. Changing the setting does not change a rate already stored on a file. Changing the rate on one file needs a reason. Net is days times the rate. VAT is 20%, which was already the configured rate. The total is net plus VAT, in pence, shown as GBP. Staff do not type the net, VAT or total. That total is written as the claimed figure. Agreed and received are not changed when the days or the rate change.

A provisional storage figure is not put into a payment request as a final charge. Storage was never a payment-chase head (those heads are repairs and vehicle damage only). Letters and the hire-pack cover that state a money total leave an unconfirmed storage figure out of that total. Where a list of losses still has to mention storage, it says the figure is provisional and not final. The claim overview, the Financials page and the dashboard still show the figure, labelled provisional.

TEST-0005 keeps its proposed storage end of 01/10/2026 unconfirmed. With the £39 rate that is 10 days, £390.00 net, £78.00 VAT and £468.00 total. The recovery figure of £474.00 on that file is the recovery screen's calculated total: the £395 standard charge and no extras, plus VAT. It is not a free-typed total, and a second £395 is not added.

TEST-0003 had a hire collection date of 03/10/2026 on the booking with no hire end. That date was not written by the seed, and completing the Hire car collection job writes the collection day and the hire end together, so a real file cannot be left in that state by that job. Logging "Hire car — collected from the customer" on the handover screen does not write the collection date the file displays. The stray date was removed. A stored hire end is left as it is. TEST-0003's storage end of 14/09/2026, where that date is already stored, is not rewritten by reading the file.

## Decisions confirmed on 14 October 2026

- Repairable hire ends on hire car collection.
- Repairable storage ends on the earlier of repairs started and repair authorisation, confirmed by a handler. Updated by Justin on 15/10/2026. The 13 October note that it ended on authorisation alone is replaced by that rule.
- Storage and hire are both charged for the start day and the end day. Confirmed 14/10/2026. Storage from 22/09/2026 to 01/10/2026 is 10 days, and hire uses the same count.
- Hire agreement renewal alerts stay on day 70, day 80 and day 88. Day 1 of that count is the agreement start day.
- CAS’s default insurer payment term is Due on receipt. Invoices and payment requests say “Payment is due immediately upon receipt of this invoice.” It is never shown as 0 days. Confirmed by Justin on 14 October 2026. A different term can be stored for one insurer and is shown as that insurer’s own words. If none is stored, the default applies.
- Places that already count both the first and the last day: the storage charge, and a letter's hire day count (`total_hire_days`) when a stored hire end exists. The hire agreement and hire pack show Date in from that stored end, or "Hire continuing", and do not count days. The cessation letter uses the same stored end. The warning "Hire charged N days beyond vehicle return" is the gap between two dates, not the charge period. Renewal alerts were left on the agreement day number.
- Tests: `tests/storage-recovery-pages.test.ts`, `tests/rules.test.ts`, `tests/hire-collection-date.test.ts`, `tests/hire-storage-end.test.ts`. Full suite: 382 passing, 0 failing.

A missing start date shows "Start date missing" and no figure. A storage end cannot be proposed or confirmed until a start date is on the file. A proposed end is still only stored when a handler confirms it. TEST-0005 has a storage start of 22/09/2026 and a recovery on that day from Caerleon Road, Newport, carried out by Demo Driver. The proposed storage end of 01/10/2026 is still unconfirmed. TEST-0003's storage end was not rewritten.

Recovery and storage were already separate rows in `financial_lines` (`recovery` and `storage`). They shared one screen, not one money row. Nothing was merged or split, and no received or agreed figure was moved. The recovery claimed figure is the total the recovery screen already calculates (standard charge, extras and card fee, plus VAT). It is not a second £395 on top. Where that screen has not been saved, and a claimed figure is already on the file, that figure is left as it is.

A blank storage location is filled from the CAS premises default (Complete Accident Solutions Ltd, 171 Cwmgarw Road, Brynamman, Ammanford SA18 1DG, with the telephone and email already held for the company). A location someone has typed is not overwritten. The payment box says how much has been received against the agreed figure when there is one, otherwise against the claimed figure. If neither exists it says there is no figure to compare against yet. Driver and mechanic are refused the money routes on the server.

Hire was inspected and not changed. Hire dates sit on the delivery and collection screen and on the hire booking. Hire money sits on the hire head screen. That claimed figure is the amount stored on the hire line. It is not calculated from the days and the daily rate.

Saving Storage and saving another screen on the same file do not block each other. From 15 October 2026 a second save of Storage itself is refused if someone else saved Storage after the page was opened. The first person's details stay.

## Hire charge (14 October 2026)

Hire is calculated the same way as storage. The start is the day the replacement was handed over, from the handover record. A booking or a reservation does not start hire. Fault courtesy is not credit hire. The daily rate is the rate on the signed agreement (the rate set when the agreement was generated, or the rate recorded on that agreement). It is not the group of the car that was supplied.

Days run from that handover to the confirmed hire end. A confirmed end is final. When an end has only been proposed, the days run to that proposed date and the label is "Provisional, to proposed end [UK date], awaiting confirmation". Days run to today, labelled "Provisional to today", only when there is no end of any kind. Both the first day and the last day are counted. Staff do not type the days, the net, the VAT or the total.

A renewal is the same hire. Each day is counted once. If the renewed agreement records a different rate and the day that rate started, each agreement is its own line. The changeover day is not counted twice. If the file does not record the rate or the day it changed, the days are not split. A vehicle swap does not add a day and does not change the rate. Collision damage waiver, delivery and collection, and an additional driver are added only when the signed agreement records a rate for that extra. VAT is 20%.

A stored hire, storage or recovery claimed figure that does not match the calculation is flagged "Stored figure differs from calculation, review". Any signed-in member of staff except a driver or a mechanic can resolve it. "Use calculated figure" makes claimed follow the calculation from then on, including when the days change, and the history records the old stored figure, who did it, and when. "Keep stored figure" needs a reason. Claimed stays fixed and the flag becomes "Stored figure kept: [reason]". Where no stored figure exists, claimed is the calculation. Neither choice changes agreed or received. The claim overview, Financials and the dashboard use that same claimed figure. It is labelled provisional until the hire end or the storage end is confirmed. Recovery has no end date.

An unconfirmed hire total is left out of letter and payment-pack totals, in the same way as unconfirmed storage. The claim overview, the Financials page and the dashboard still show the figure, labelled provisional, until the end is confirmed. A letter about hire that is still running can show the daily rate and "Hire continuing". It does not state a total.

The chargeable hire end is still written only by completing the Hire car collection job, or by a handler confirming the total-loss suggestion. Typing a date on Delivery / collection does not write that end. Hire agreement renewal alerts were not changed: day 70, day 80 and day 88.

TEST-0008 is the file to open. It has a handover, a signed agreement, a signed renewal at another rate, and a vehicle swap. Its stored hire claimed figure is left as it was.

Confirmed, and already tested in `tests/hire-storage-end.test.ts`:

- `flags a confirmed or proposed storage end when the file is later marked a total loss, and does not change the date` — a repairable file changing to a total loss after authorisation.
- `asks for review when authorisation is revised or withdrawn, and does not overwrite a confirmed date` — authorisation revised or withdrawn after the storage end was confirmed.
- `refuses a manual storage date that differs from authorisation unless a reason is recorded` — a manual storage end with no reason is refused.

## Hire, storage and recovery offers and payment chases (14 October 2026)

Hire, storage and recovery use the existing insurer offer list. A dated offer can have a note. Withdrawn, lapsed and rejected offers stay on the list. "Use this figure" only fills the agreed boxes. It does not save the agreed figure. Recording an offer does not change claimed, agreed or received. The same offer submitted again within one minute is not recorded twice. Each offer is shown against the claimed figure, as a difference in pounds and as a percentage. Hire and storage can also record the insurer's offered days and offered daily rate. If both are entered and they do not multiply to the offer, the mismatch is flagged and the offer is still recorded.

Each of those three charges has its own decision: Awaiting decision, Accept, or Dispute. A dispute needs a reason (rate, period, need, or the staff member's own words). The charge stays open. Hire and storage are not closed. Accepting or disputing one charge does not change another.

Accept records the agreed figure. Accepting a figure below the claimed figure is a reduced settlement. That needs the permission `approveSettlement`, stored on the staff permissions table and granted only to Justin's staff row (`staff-justin`). It is not granted by the administrator role and it is not granted by username. Anyone else can propose acceptance. That waits for Justin and does not write the agreed figure until it is approved. A direct save without the permission is refused.

A payment chase for hire, storage or recovery uses the existing chase. It starts only when the figure is final and a payment request for that charge has been recorded as sent. Hire and storage are final when the end date is confirmed. Recovery has no end date, so it is final once the claimed figure is on the file. The chase follows the agreed figure if there is one, otherwise the confirmed claimed figure, minus what has been received. The interval stays three days unless that file already has its own interval. A part-payment pauses the chase for review. A full payment stops that chase and flags the other charges for review without closing them. A substantive reply pauses the chase. The file is checked again immediately before a send. An outage does not produce a backlog of chasers.

If CAS bank details are not entered in Settings, nothing is sent. The claim and the dashboard say "Bank details missing in Settings". Bank details are not invented. The insurer payment term was left as "not set" in that stage. That is replaced by Due on receipt in the next section. `EMAIL_SEND_MODE` stays `simulate` on this PC, so a send is not a live mailbox send.

TEST-0008 is the hire file to open for the offer. Its agreed hire figure is left as it was. TEST-0011 is the storage file to open for the chase, because its storage end was already confirmed. TEST-0005's proposed storage end is still unconfirmed. TEST-0003's storage end was not rewritten.

## Missing start dates, offer review, payment terms and bank details (14 October 2026)

A storage charge with no start date shows “Start date missing” and no claimed figure. It is not treated as one day. A storage end cannot be proposed or confirmed until a start date is on the file. A payment chase does not start, and an existing chase is paused. The confirmed end is left as it is, and the file is flagged “Storage start date missing, review”. Hire is the same: no handover means “Hire not started”, no figure and no chase. Typing a date on Delivery / collection still does not write the chargeable hire end.

TEST-0011 was in that state because the demonstration data gave it a confirmed storage end and no start date, and the demonstration chase then counted one day (£39 plus VAT, £46.80) and recorded a payment request. Staff could not confirm a new end without a start on the storage screen. The remaining route, confirming a storage end from a recovery-job review when no start date is on the file, is now refused as well. The one-day figure is no longer written. TEST-0007, TEST-0008, TEST-0010, TEST-0011 and TEST-0012 each have a confirmed storage end and no start date. Each is flagged. The ends were not changed. TEST-0005’s proposed storage end is still unconfirmed. TEST-0006’s money and TEST-0007’s £800 hire figure were not changed. TEST-0009’s vehicle-damage offers were not changed.

Where “Stored figure differs from calculation” is still unresolved, the offer’s difference also says “Claimed figure under review, comparison may change”. TEST-0008’s hire offer of £1,500.00 dated 01/10/2026 is still awaiting a decision. The agreed figure on that hire line is cleared. Received stays £0. The stored claimed figure and the unresolved flag are left as they are.

CAS’s default insurer payment term is Due on receipt, confirmed by Justin on 14 October 2026. Invoices and payment requests say “Payment is due immediately upon receipt of this invoice.” It is never shown as 0 days, and it is not shown as “not set”. A term stored for one insurer replaces the default and is printed as that insurer’s own words.

Only the permission `manageBankDetails` can change the bank details in Settings. It is on Justin’s staff row (`staff-justin`), in the same way as `approveSettlement`. It is not granted by the administrator role and not by username. The server checks it. Each change is in the audit history: who, when, and the old and new values, with only the last four digits visible. A queued chaser is checked again before it sends and uses the details then in Settings. The dashboard says “Bank details changed on [date] by [user]”. Incoming email, an attachment, a client submission and an import cannot change the bank details. The sort code must be 6 digits and the account number 8 digits. If the details are missing, chasers are still not sent, and the claim and the dashboard still say “Bank details missing in Settings”. No real bank details are stored in the code or the test data.

Hire agreement renewal alerts were not changed: day 70, day 80 and day 88.

Tests: `tests/start-date-bank-terms.test.ts`, with the existing charge, payment-chase, pre-hire and follow-up tests updated for the new rules. Full suite: 406 passing, 0 failing.

## Repair progress on the chronology (14 October 2026)

The hire and repair chronology can now show the inspection booking, the inspection attendance, the engineer’s report sent to the insurer, the vehicle received for repair, and parts ordered. Parts delayed can be recorded more than once. Each is a dated `claim_events` row: the date it happened, who recorded it, and a note. Once saved, the row is not edited. A correction is a new entry, “Correction of a repair step”, and the original stays.

Staff record them with Record step on Engineering (inspection booked, inspection attended, report sent to the insurer) and on Repair evidence (vehicle received, parts ordered, parts delayed, repairs started, repairs complete). A bodyshop / mechanic login may record the workshop steps and is refused the inspection and insurer steps. Justin confirmed that split on 15/10/2026. It is checked on the server.

A genuine live send of the engineer’s report from the CRM records “Engineer's report sent to insurer” by itself. A simulated send does not. The screen says “Simulated, not recorded as sent”. If the report was sent outside the CRM, staff record it by hand, with who it was sent to.

On an open repairable file, a missing required step is shown as “not recorded”, without a date. Parts delayed is not shown as missing. A total loss does not gain those blank lines. A step already recorded stays if the file later becomes a total loss. Steps can be saved out of order. The chronology sorts them by the date on the row.

The gap rule below was updated on 15/10/2026. The 15 inclusive days noted here was a proposed review prompt. Justin confirmed 7 real days. See Decisions confirmed on 15 October 2026.

TEST-0008 has a full demonstration repair history, including one explained gap (“awaiting parts”) between repairs started and repairs complete. TEST-0007 has an unexplained 15-day gap between the inspection booking and the inspection attendance. No other file was backfilled. Hire money, agreed figures, TEST-0006’s money, TEST-0007’s £800, TEST-0009’s vehicle-damage offers and TEST-0005’s unconfirmed storage end were not changed. Hire agreement renewal alerts stay on day 70, day 80 and day 88. No live email was sent.

Tests: `tests/repair-progress.test.ts`. Full suite: 414 passing, 0 failing.

## Storage end and repair-progress gaps (15 October 2026)

Three decisions, confirmed by Justin on 15/10/2026:

1. On a repairable claim, storage stops on whichever is earlier: the date repairs started or the date the repair was authorised. It is still only proposed until a handler confirms it. If only one of those dates is on the file, that date is proposed. A later date that is after the earlier one does not move an unconfirmed proposal. A confirmed storage end is not rewritten. If a confirmed storage end is later than repairs started, the file says “Storage end is after repairs started, review”.
2. The repair-progress gap threshold is 7 days. The next day counts as 1 day. A gap of 7 days is flagged. 6 is not. The setting is `repair_progress_gap_days`. A stored 15, which was the previous code default, is updated to 7. A different number saved by a handler is left as it is.
3. A bodyshop / mechanic login may record the workshop steps (vehicle received, parts ordered, parts delayed, repairs started, repairs complete). It may not record inspection or insurer steps. The server checks the role.

Before this change, a gap compared consecutive recorded steps in a fixed conceptual order (inspection booked, inspection attended, report received, report sent, repair authorisation, vehicle received, parts ordered, each parts delay, repairs started, repairs complete), skipping any step that was not on the file. It did not sort that list by date, and it did not compare fixed pairs only. The day count included both the first day and the last day. The threshold was 15. There was no “nothing since the last step” flag. A total loss produced no gap flags.

The gap is now the real days between each repair-progress step and the next one by date. Recovery completed, engineer instructed and the repaired vehicle returned are included. Chasers and letters stay on the chronology and do not reset the gap. On an open repairable file, the last step is also compared with today. Open means the repaired vehicle has not been returned and the claim is not closed. The wording is “No progress recorded for [n] days since [step] on [date]”. An explanation of that open flag comes back after another 7 days with no new step: “Still no progress recorded for [n] days since [step], last explained [date]”. An explanation of a gap between two steps still clears that pair only. A total loss no longer expects workshop steps. A gap between the steps that still apply, and no progress since the last of those steps while the claim is not closed, is still flagged. Workshop “not recorded” lines are not added. A workshop step already recorded stays on the chronology.

TEST-0007’s demonstration inspection attendance was 15/09/2026, after the report received on 02/09/2026. That attendance was moved to 02/09/2026, earlier the same day as the report. Recovery completed 31/08/2026, engineer instructed 01/09/2026, inspection booked 01/09/2026, report received 02/09/2026 and repairs started 07/09/2026 were not moved. The report is not before the inspection. The last repair-progress step is repairs started on 07/09/2026, so the file shows no progress since that step. The £800 hire balance was not written off (£100 received, £800 outstanding).

TEST-0008 still has repairs started on 01/09/2026 before repair authorisation on 11/09/2026. The stored storage end of 11/09/2026 is not rewritten. There is no storage start date, so no new end is confirmed. The file says “Storage end is after repairs started, review”. The earlier “awaiting parts” note was an inclusive count of 21 days from repairs started to repairs complete. Those dates are 20 real days, and authorisation on 11/09/2026 splits them into two gaps of 10 days. The note now says that, and it does not clear either gap. Hire money, the £1,500 offer awaiting decision, and the unresolved stored-versus-calculated flag were not changed.

TEST-0005’s proposed storage end of 01/10/2026 is still unconfirmed. TEST-0003’s storage end of 14/09/2026 is unchanged. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. Hire agreement renewal alerts stay on day 70, day 80 and day 88. No live email was sent.

Tests: `tests/repair-progress.test.ts` and `tests/hire-storage-end.test.ts`. Full suite: 421 passing, 0 failing.

## One save must not silently overwrite another (15 October 2026)

Each screen a person edits has its own version, loaded with the page and sent back with the save. If someone else saved that same screen after it was opened, the later save is refused. The message is “[Name] changed this on [dd/MM/yyyy HH:mm] after you opened it. Your changes have not been saved.” It lists the fields the other person changed and the entries that were not saved, and it offers “Reload the latest version”. The first person’s change stays. Saving different information on the same file is not a clash. Client details and Storage are separate.

Notes, file history, chronology events, new offers, corrections, gap explanations and financial circumstances are new entries. Two people can add them at the same time. They are not version-checked.

Where two screens write the same stored fields, they share one version. A save from either is refused if the other changed those fields after the page was opened. Nothing is merged and nothing is overwritten. The shared pairs are: Claim facts and Accident (circumstances and location); Claim facts and the insurer screen (own insurer); Claim facts and a liability chase (insurer position); Client details and the hire pack (date of birth, licence number, telephone); the vehicle screen and the hire pack (GTA group); the vehicle screen and third party 1 (registration, make, model); Storage details and the recovery-date job (storage start); Storage details and the storage-end confirmations (chargeable end); the recovery screen and the recovery-date job (recovered date); hire-end confirmation and the total-loss off-hire date (hire billing end). The General screen and the file status form already share the general screen version. Audatex on the insurer screen and on Vehicles already share the insurer screen version. Storage rate is only written from the storage rate form. Fleet vehicles are not the client’s vehicle.

A payment, an agreed figure and an offer each carry a one-time key. The server records a key only after the row is saved. A double-click, a resubmit or a retry of that same key shows the original result and does not write a second row. A missing key is refused and nothing is recorded. A new key is always recorded, even when the amount is the same. This replaces the one-minute silent drop.

If the same amount was recorded on the same charge within the last 10 minutes, the screen asks “£[amount] was recorded on [charge] at [dd/MM/yyyy HH:mm] by [name]. Is this a second, separate payment?” Yes records it. Cancel leaves the file unchanged. An identical open offer asks the same kind of question and is kept when the person confirms it. It is not dropped.

Removing a fleet vehicle, editing one, and creating or changing a booking are version-checked. A stale version does not delete or overwrite. A vehicle that already has an active or future booking is not removed unless the person confirms that removal. A booking opened before the vehicle was removed, or before it was edited, is refused. The booking does not point at a removed vehicle.

A chase writes its own reminder fields and re-reads the file first. It does not write hire, storage or client details. If it does change a field on a screen someone has open, the refusal names the job, for example “Payment chase”. A storage-end proposal still does not confirm the end.

Bank details use the same version check. Only Justin’s staff login (`manageBankDetails`) can change them, and the existing audit remains (who, when, old and new masked except the last 4 digits). Sort code stays 6 digits and account number 8 digits. Incoming email, attachments, client submissions and imports still cannot change them.

If the session has expired, the person is sent to sign in. The form is not kept across that redirect. A version clash does keep the unsaved entries on screen.

The old “later save is kept” warning has been removed from Storage and from Financial circumstances.

TEST-0005’s proposed storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. Hire agreement renewal alerts stay on day 70, day 80 and day 88. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/optimistic-concurrency.test.ts` and `tests/two-user-saves.test.ts`. Full suite: 467 passing, 0 failing.

15 October 2026: `TotalLossPanel` imported `sectionVersion` twice. The second import is removed. The same save had also dropped `SaveClashNotice`, `RecordVersionField`, `VehicleOffers` and `formatUkDate`; those imports are restored. No other duplicate declaration was found.

15 October 2026: The type check and the production build are clean. `npm run typecheck` checks the application, then checks the tests separately. `npm run check:pages` uses the production build, starts it on a free port, signs in as the Justin test user from `docs/AUTH-NOTES.md`, and opens every main page. It does not save a form and it does not send email.

## Daily claims desk (15 October 2026)

The dashboard is arranged as a working daily screen. Business rules and calculations are unchanged, apart from a new Outstanding column on the money table.

Today’s work sits under the tiles. One row per claim, the most overdue item first, then due today, then anything later. “Overdue by [n] days” counts real days: the next day is 1. Due today says “Due today”. A future date is not called overdue. “+n more” opens that claim’s other items.

Empty chase sections are not shown on their own. Their names are one line: “Nothing due: …”. The explanation under a heading stays word for word and opens from “?”.

Outstanding is worked out on each claim: the agreed figure if there is one, otherwise the confirmed claimed figure, minus what has been received. Those amounts are then added up by head of loss. A provisional figure, a “Start date missing” figure, or no figure is not used as a confirmed claimed figure. Confirmed and provisional claimed totals are separate rows. Where money received is higher than the agreed figure, the row is labelled as an overpayment. On the current data that is TEST-0010 vehicle damage: £8,200.00 received, £6,700.00 agreed. The total-loss record has a PAV of £8,200.00 and salvage of £1,500.00. The figures were not changed.

Active hire counts claims whose hire is active or approaching off-hire. On hire / courtesy counts fleet vehicles marked on hire. On 15 October 2026 those counts are 7 and 6. TEST-0010 is the extra claim: its hire is still active, and its fleet vehicle is in maintenance.

My claims / All claims is at the top. Justin’s login opens on all claims. Every other handler opens on their own. The choice is kept for that person’s browser session, so the next person who signs in on this PC still gets their own default. The server applies it to the desk, including the tiles that count claims.

Repair gaps on open claims stay on the dashboard. Open means the repaired vehicle has not been returned and the claim is not closed; a total loss stays open until the claim is closed. Gaps on finished claims are on “Gaps to explain before any dispute”, linked from the desk, and still show on the claim. The 7-real-day rule is unchanged.

Every top tile opens its filtered list. Fleet available opens Hire / Fleet filtered to available vehicles.

The database path stays in the footer for this stage.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. Hire agreement renewal alerts stay on day 70, day 80 and day 88. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/dashboard-desk.test.ts`. Full suite: 477 passing, 0 failing.

## Today’s work, second stage (16 October 2026)

Staff can do the ordinary desk jobs from Today’s work without opening the file first. The existing colours and wording stay. Approving a settlement, changing bank details, accepting a reduced figure, and a letter before action are still not buttons on a row.

An overpayment no longer reduces money owed on another head. Outstanding on a head is never below £0. The extra is its own “Overpaid, to review” row on the money table and in Payments to review. Courtesy with no comparison figure stays “none”.

A hire that is still active while the assigned vehicle is not marked on hire is flagged: “Fleet record conflict: [registration] is marked [status] but is on hire to [reference]”. TEST-0010 shows this. The vehicle was not taken out of maintenance, and the hire was not reassigned. The existing tile note remains.

Item titles no longer repeat the word “Overdue”. The when-column still says “Overdue by [n] days”. The day count is unchanged.

Today’s work is still one row per claim. The row is that claim’s highest item. “+n more” opens the rest. Deadline comes first (litigation deadlines that have a source, hire agreements past the 88-day limit, settlement approvals waiting for Justin, fleet record conflicts, and an open claim with no next action and no due date), ordered by days overdue. Then money still running with a repair-progress gap, ordered by the daily rate times the days with no progress. The row shows “£[amount]/day running”. The rate is the hire daily rate plus the storage daily rate already on the file, and only while that charge is still running. Then everything else, most overdue first. The labels are Deadline, Money running and Other.

From a row, staff can log a call, prepare the chaser email, record a repair step on the same form as the file, wait until a date, or open the claim. A call, a wait and an undo are filed on the claim history. A promised date sets the wait to the day after that date. A wait needs a reason, hides the item until that date, and does not delete the chase or the earlier entry. The usual maximum is 14 days. A longer wait needs `extendedWait`, which is stored only on Justin’s staff row (`staff-justin`). It is not granted by the administrator role and not granted by the username. The server checks it. Waiting on a chase pauses it and starts it again on that date. Undo is available for 10 seconds. Preparing a chaser still uses simulated sending, still refuses a payment email when bank details are missing in Settings, and still rechecks before a send. Nothing is sent live.

Every claim page has a summary that stays on screen while scrolling: the file, client, registration, insurer and reference, handler, liability and roadworthiness as stored, the stage, the daily running charge, a money table that matches the dashboard (outstanding never below £0, overpayment separate), the next action, and the open flags. Saving a claim with no next action warns the handler and still saves. No next action was invented for the existing files.

Lists use the same columns: File, Client, Item, When, Handler. Red is overdue, amber is due within 2 days, green is later, and grey is waiting until a set date. Hire renewal alerts stay amber at day 70 and red at day 80 and day 88.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/desk-stage2.test.ts` and `tests/dashboard-desk.test.ts`. Full suite: 487 passing, 0 failing.

## Claim page summary (16 October 2026)

The claim summary stays at the top of the file in the normal page flow. After it scrolls away, one slim bar stays pinned: reference, client, registration, running cost per day, confirmed outstanding, and the next action with its due wording. Clicking the bar returns to the full summary. The full summary is not pinned.

Open flags show as a count with a Show / Hide toggle. Each flag is its own line.

The claim heading under the tabs is removed. The summary is the header. ← All claims goes back to the claims list. Overview, correspondence, file screens, handover, documents, vehicles, repair evidence, Hire Pack, pre-hire checks, financial circumstances, recovery, storage, hire and vehicle damage are one wrapping row of tabs.

The simulated-email sentence is only in the top bar, from `emailSendBanner()`. A live-mode warning still shows on sending screens. The separate Outstanding box on the overview is removed. Provisional outstanding is labelled “Provisional, not final” with the figure. “none” is only used when the figure is final and nothing is owed. A stored figure that still differs from the calculation is marked “Figure under review”. Outstanding is still never below £0, and overpayments stay separate. No calculation, hire-renewal alert, bank-detail rule, storage-end rule or Today’s work order was changed.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/claim-summary-bar.test.ts`. Full suite: 493 passing, 0 failing. Type check: 0 errors. Production build passed. Page check: 58 pages, including 14 TEST-0008 screens that fit a 1280px laptop with no sideways scroll.

## Opening a page does not write; money running needs a real rate (19 October 2026)

Opening Recovery, Storage or Hire no longer records a charge. Each page shows the empty state and a Record button. The charge is written only when that button is pressed. The dashboard and chase lists no longer create rows just by being opened.

Today’s work puts a claim in Money running only while hire or storage is still accruing at a daily rate above £0. The hire rate is the signed agreement rate. The storage rate is the rate stored on the file, or the £39 default only where the storage page would use it. A proposed storage end already in the past is “Confirm storage end (proposed [date])” under Other. A charge that is still open without a rate is “Daily rate missing”. £0/day is not shown.

TEST-0008 had no recovery line in the demonstration data. The £474.00 recovery charge was created by opening the Recovery screen, and that line was removed from the database on this PC. TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

`next-env.d.ts` is generated by Next.js and is no longer tracked. The page check confirms the database is unchanged after every page is opened.

Tests: `tests/page-open-writes.test.ts`. Full suite: 498 passing, 0 failing. Type check: 0 errors. Production build passed. Page check: 58 pages, 14 TEST-0008 screens fit a 1280px laptop with no sideways scroll, and the database was unchanged.

## New claim form and recovery charges (19 October 2026)

The new-claim form keeps a draft on the server as staff type. The dashboard lists it under New enquiries / incomplete. A draft does not send a message, start a charge or write history. Create claim does that. Discarding a draft asks for confirmation. If two people save the same draft, the later save is refused and names who saved it and when.

Ticking “Client needs a replacement vehicle” records the hire request. It does not book a car or start hire. The next action becomes “Pre-hire checks and choose a vehicle”.

Recovery fees are tick boxes. Standard recovery is filled in at £395. Environmental £150, winching £95, forklift £85 and out of hours £100 are filled in when ticked. Specialist winching, skates/dollies, waiting time, second operator and a manual charge are typed, and each needs a short reason. The fees live in Settings. Changing a setting does not change a fee already stored on a file. Each charge is its own line, plus VAT at 20%, on the Recovery page, the agreement and the payment-pack wording.

An inherited charge records the company, the net and the VAT from the receipt, and a receipt can be uploaded. It is labelled “Inherited charge (paid to [company])”.

A recovery time sits next to the recovery date. The server refuses a recovery before the accident. Storage still starts on the recovery date only when recovery is recorded.

TEST-0013 is left as it was typed. £195 stays in the note and is flagged “Inherited recovery charge needs review: £195 was typed in a note”. The recovery time stays 09:00 and is flagged “Recovery time needs review: 09:00 is before the accident at 14:30”. No company, VAT or corrected time was invented.

The credit recovery and storage agreement is still waiting for CAS-approved wording. It can be kept as a draft marked “DRAFT – wording not approved by CAS”. It is not sent, including when email is in simulate mode. Create claim does not send it. Photo requests, “recovery on the way” and the recovery job to the driver can still go out under the usual simulate rules.

Weather, purpose of journey, road surface and lighting are lists. Other needs the typed words. Every phone box warns if the number is not a UK number of the right length, and Save anyway keeps an overseas number and records that choice. More than one witness can be added. Liability, roadworthiness and handler sit just after the client details.

Postcode and registration lookup say “Lookup not connected yet – please type the details” while no live service is connected. The insurance check records a manual askMID result in the history. It does not look the vehicle up.

An item whose wait-until date has passed comes back on Today’s work by the list itself. A paused chase resumes when the server starts and again every 30 minutes. Opening the dashboard does not do that write.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/new-claim-recovery.test.ts`. Full suite: 510 passing, 0 failing. Type check: 0 errors. Production build passed. Page check: 58 pages, 14 TEST-0008 screens fit a 1280px laptop with no sideways scroll, and the database was unchanged.

## Claim page around the 10 steps (19 October 2026)

The claim page is now the 10 steps. The old 14 tabs are seven: Steps, Details, Hire, Money, Documents, Messages and History. Old addresses still open and redirect to the matching tab. The driver and mechanic screens are unchanged.

Each step is read from the file history. There is no separate status field. A step that cannot be read from an event stays Not started, and the page says so. Opening a page still writes nothing.

Step 7, agreeing the repair estimate with the client, had no existing event that meant that. The button records `repair_estimate_agreed_with_client`: the date, who, and a note. It does not change the agreed figure. A total loss still uses the existing `total_loss_agreed_confirmed` event.

Staff can mark a step Not needed only with a reason. That is a new history line. The server refuses a blank reason.

The stage line and the next action on the claim page come from the current step, unless staff have already typed a next action (including “Pre-hire checks and choose a vehicle”, a wait, or a promised date). A typed next action is left as it is. The claims list still shows a due chase in the next-action column, as before. Nothing is written when the page is opened.

A draft saved twice in the same millisecond now gets a distinct version, so the later person is still refused. The two-person rule is unchanged.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/claim-steps.test.ts`. Full suite: 521 passing, 0 failing. Type check: 0 errors. Production build passed. Page check: 68 pages, 24 claim screens fit a 1280px laptop with no sideways scroll, old addresses redirect, and the database was unchanged.

## Steps for each kind of claim (21 October 2026)

Justin confirmed the fault-claim steps on 21 October 2026. That confirmation replaces the proposal that was waiting in the decision log.

A step is Not needed only when someone has answered no, or has marked it not needed with a reason. The server refuses a blank reason. If nobody has answered, the step says Not decided yet and both the main button and Not needed stay available. Hire on TEST-0013 is that case.

The next action and its due date come from the first open step, the same step as the stage line. A next action staff have typed is kept and shown as a note. It does not replace the step. Today’s work uses the same step. Opening the page does not write that next action into the database.

The words on a step are To do, Not started, In progress, Waiting on someone, or Done. In progress is used only when something has actually begun.

A repairable non-fault claim no longer asks the client to agree the repair estimate. Older `repair_estimate_agreed_with_client` history lines are kept. Staff choose an engineer, an Audatex estimate, or both. The report step is done only when every chosen item has been received. Audatex figures are typed by hand. There is no link to Audatex. Recording them does not change claimed, agreed or received.

A fault claim uses the ten steps in the decision log. The third-party letter is not created. The client’s car is not recorded as returned before the excess is on the history, unless that save is by Justin’s staff row using `releaseWithoutExcess` and a reason. The invoice is the authorised amount minus the excess. Changing a file from non-fault to fault, or from repairable to total loss, switches the steps and keeps the history.

Where a demonstration file was marked complete with no history event, a demonstration event was added using a date already stored on the file. TEST-0008 recovery uses the roadworthiness assessment date, because no separate recovery date is stored. Its engineer instruction uses the inspection booking already on the file. Its storage end uses the storage end already stored. TEST-0009’s report-received flag has no stored report date, so no report event was added and that step says it cannot be told from the history. TEST-0009 was not converted into a fault claim. TEST-0004 is the demonstration fault file.

Saving a recovery date, a storage end, or a salvage outcome now writes the matching history event. A flag on its own does not mark the step done.

TEST-0005’s storage end is still unconfirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

Tests: `tests/claim-steps.test.ts`. Full suite: 527 passing, 0 failing. Type check: 0 errors. Production build passed. Page check: 68 pages, 24 claim screens fit a 1280px laptop with no sideways scroll, old addresses redirect, and the database was unchanged.

## Open decision — 19 October 2026

- Recovery mileage charging is undecided. The mileage box has been taken off the new-claim form. Justin has not decided how mileage will be charged. A mileage amount already stored on a file is left as it is.
- Fault-claim steps were confirmed by Justin on 21 October 2026. They are no longer a proposal. A fault claim uses: basic details; recovery if the car is undriveable; a courtesy car if one is needed, with no daily charge to an insurer; notify the client’s own insurer and record their claim number; send the Audatex estimate to that insurer, with no engineer; authorisation received via Audatex; repairs done; excess paid by the client; car returned to the client; then invoice the client’s own insurer for the authorised amount minus the excess. The third-party insurer letter is not sent. The car is not recorded as returned before the excess is paid unless the staff row has `releaseWithoutExcess`. That permission is on Justin’s staff row only. It is not granted by the administrator role or by a username. A total loss, including a fault file later marked a total loss, keeps the total-loss steps.

## Not yet claimed

- Remove the database path from the dashboard footer before live use. It is there now so a handler on this PC can see where the file is kept. It should not be shown once the system is in live use.
- Financial summary and the Assessed damage notes fields remain non-authoritative working notes, pending a later decision on whether to keep them.
- Loss-of-use is earmarked for redesign into an automated chronology. Its current fields stay in place until that stage. They are typed notes on the hidden screen. The hire and repair chronology does not read them.
- Finer permissions beyond the named staff permissions, live integrations, payment packs from CAS templates, litigation issue, and backups/restore/deploy. The working dashboard is not production readiness. `extendedWait` is only on Justin’s staff row.

## Create claim and the journey test (27 October 2026)

Create claim was staying on New claim. The “Skip other number” tick was being checked as a telephone, and the Save anyway tick was too. A skipped number is no longer checked and is not stored. A refused save now says what is wrong, at the top of the form, and the box is highlighted. The telephone rule is unchanged.

`npm run test:journeys` drives the three new-claim screens in a browser after `npm run build`. It uses its own database. It does not use the demonstration database, does not confirm a storage end, and does not send email. A stage is not finished until that check passes with `npm test`, `npm run typecheck` (zero errors), `npm run build`, and `npm run check:pages` (database unchanged on open). The plain note is `docs/CLAIM-JOURNEY-AUDIT.md`.

Finish on 27 October 2026: 529 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: the database was unchanged on open and no claim page scrolled sideways. The three journey checks passed on their own database.

The walk files on this PC are TEST-0015 Audit Repair, TEST-0016 Audit Totalloss, and TEST-0017 Audit Fault. TEST-0013’s two flags were left as they were. TEST-0005’s storage end was not confirmed. TEST-0009’s vehicle-damage offers, TEST-0006’s money, and TEST-0007’s £800 were not changed. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`.

## One hire (27 October 2026)

Hire is one tab, in order: whether a car is needed, the existing pre-hire checks, choose a car, the hire pack, handover, then the car on hire. Opening any page does not start hire and does not write a charge.

A reservation is not hire. Hire starts on the handover date, when the handover is completed. The car is marked on hire then, step 3 is done, and the dashboard on-hire count uses those saved records.

Only a free, suitable car is offered. A booking on the same London calendar day is an overlap. The server refuses a clash even if the screen is bypassed: “This car has just been booked on [CAS ref]. Please choose another.” Changing or cancelling the car releases the reservation. A repeat submit does not create a second reservation, job, or history line.

A delivery creates one job for the driver login, with the file, the client, the telephone, the address, the car, and the date and time. The client collecting the car does not create a job. Changing the car, date, or address updates that job. Cancelling cancels it. A collection job can be arranged when hire is to end. It does not set the chargeable end. Repairable hire still ends on confirmed collection. Total-loss hire still ends seven days after the qualifying payment, with handler confirmation.

The rate is taken from Settings when the car is chosen and is stored on that hire. Changing Settings later does not change it. A swap or a renewal keeps one hire. The day count does not restart.

The agreement is 89 days. Alerts start on day 80 and are overdue on day 88. That margin is deliberate. It replaces the earlier amber warning from day 70. Hire charges are not changed by the alert. Earlier notes in this log that leave 89 against 88 as undecided, or that start an amber warning on day 70, are superseded by this decision.

A fault file uses the same choose-a-car and handover steps for a courtesy car. It does not file a hire agreement or a hire pack. There is no daily charge to an insurer.

The pack uses the existing CAS wording. E-signature is not set up. Staff print, sign, and upload. The full licence number is stored once on the client or driver record and reused. Missing details are listed with a link. A draft is still saved.

Known issue 26 (hire split across screens) and known issue 27 (no driver job) are closed. Known issues 24 and 25 were closed on 28 October 2026. See Hire checks (28 October 2026). The order in the paragraph above (checks before the car) is superseded by that decision: the car and the pack draft are no longer blocked by the checks.

Recovery mileage charging remains undecided. That is the open decision from 19 October 2026.

## Hire checks (28 October 2026)

Reversible. Choosing a car, and drafting the pack, are no longer blocked by the pre-hire checks. The checks block only two actions: producing the final hire agreement for signature, and completing the handover.

After Hire needed is Yes, the Hire tab keeps all five steps on the page: Hire needed, Choose a car, Pre-hire checks, Hire pack & agreement, Handover. A step that cannot be done yet stays visible and says what it is waiting for.

A non-fault credit hire needs a current licence check for every person who will drive, and a bank-statement check. The bank-statement check is a stored bank statement, a bank account already listed on Financial circumstances, or a saved explanation that the client has no bank account. The upload is the same document Financial circumstances shows. There is no second copy. A fault courtesy car needs the licence check only. It does not ask for bank statements, and it still does not create a credit-hire agreement or a hire pack that uses credit-hire wording.

The licence number already on the file is not this check. Staff open the current GOV.UK page (https://www.gov.uk/check-driving-information) themselves. The CRM does not call DVLA. Saving “OK to drive” marks that person’s check done. “Problem found” leaves it not done. An upload is labelled “Licence check – [name] – [date]” and is stored on the claim. A bank statement is labelled “Bank statement – [client] – [date uploaded]”.

A licence check counts as current at the agreement and at the handover if it was done within the Settings window. The default is 21 days, the same period as a GOV.UK check code. 21 days is the demonstration window until Justin confirms it. It needs Justin's confirmation. It is not, by itself, a ruling that CAS must use 21. A check older than that window blocks the agreement and the handover until it is rechecked or overridden. This replaces the 7 October rule that age did not stop generation or handover.

The evidence checklist does not need to be Complete, and approval to rely on impecuniosity is a different gate. Wage slips do not count as a bank statement.

An override still needs `overridePreHireChecks` on that staff row. That permission is not the administrator role. It is not the username. Justin’s staff row (`staff-justin`) has it. Each override needs a reason, stays on the file, and covers one check on one file only. The form is not shown to anyone without the permission. An override already on the file is one line: who, the date, and the reason.

Bank statements and licence-check uploads are office staff only. A driver or a mechanic who opens the file address directly is refused. Signing stays print, sign and upload. E-signature is not set up. The agreement text is the existing CAS template. Unapproved wording still cannot be sent.

Choosing a car still only reserves it. Hire and charges still start at the completed handover. The agreement is still 89 days. Alerts still start on day 80 and are overdue on day 88. Repairable hire still ends on collection with handler confirmation. Total-loss hire still ends 7 days after the qualifying payment, with handler confirmation.

Finish on 28 October 2026: 539 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 68 passed, 0 failed, database unchanged on open. Journey checks passed on their own database, including the new hire checks. No live email was sent. `EMAIL_SEND_MODE` stays `simulate`. TEST-0001’s stored override was not rewritten. TEST-0005’s storage end was not confirmed. TEST-0009’s vehicle-damage offers, TEST-0006’s money, and TEST-0007’s £800 were not changed.


## Hire fixes after the reviewer's walk-through (28 October 2026)

Reviewer tested f5c0ffe as Sian on TEST-0015, TEST-0016 and TEST-0017. These decisions replace the earlier wording where they differ.

**One availability rule.** A car is not free for a date if it has an open booking or hire on that date, if it has a booking or hire that has not been returned or closed (whatever its planned end), or if its fleet status is on hire, reserved, maintenance, off road or sold. Choose a car, the server reserve check, a swap, a staff booking on Hire / Fleet and the dashboard fleet counts all use `fleetAvailability` (`src/lib/db/fleet-availability.ts`). Where the status and the bookings disagree, the data is not changed. The car is held back and listed on **Fleet records to check** on Hire / Fleet. A person can confirm an overdue booking is still with the customer, close a booking that was never handed over, or open the car or the file. Confirmed collection now closes that file's booking and marks the car available if nothing else holds it.

**Daily rate.** Reserving a car stores the Settings rate for the group charged (the pack's group, otherwise the client's own group) on the hire, with the date it was taken and the group. Later Settings changes do not change it. The agreement uses that stored rate. If there is no group, the Hire tab says "Daily rate missing" and asks for the group charged. No rate is invented. A stored rate can be taken again only before the agreement and the handover.

**Final agreement.** Refused until the file has the hirer's name, address and date of birth, licence number and expiry, the car, a planned handover date, the daily rate, the group charged and why a hire car is needed. Each missing item is listed with a link. The pack fields can still be saved as a draft with gaps. There is one Produce button.

**Licence check.** If the person has no licence number, the check card asks for it. It is saved to that person's record. The check cannot be saved as OK to drive without it. The expiry on the check fills the person's licence expiry if it was blank.

**Handover (reversible, needs Justin's confirmation).** A credit-hire handover needs the daily rate and the signed hire agreement, uploaded on the handover form or the driver's handover page (a photograph is fine). It is filed as "Signed hire agreement", agreement 1 is recorded as signed at the stored rate, and the signed date is the upload. An account with `overridePreHireChecks` can hand over without it, with a reason kept on the file. A fault courtesy car needs neither. Completing the handover on the Hire tab also marks the delivery job done.

**Status wording.** The new-claim form no longer stores step guidance as a next action. Old intake guidance is not shown as a note. The claims list position and next action come from the steps, the same as the claim page.

**Driver jobs.** Office staff choose the driver when reserving a delivery (default: unassigned, shown clearly). Driver jobs (`/driver-jobs`) lists overdue deliveries, collections, recoveries and returns, then today to a month ahead, with the claim, type, address, time, driver and status. The office can change the driver there.

**TEST-0015.** History left intact. The header and Hire tab say "Daily rate missing" with the fix form, and the signed-copy upload is offered. Nothing was deleted.

**Screens.** Finished steps fold to one line with Change. The fault file shows no rate wording. History and messages use plain words. The claim tab row wraps. `check:pages` also checks 1024px.

Questions are in `docs/QUESTIONS-FOR-JUSTIN.md`.

## Justin's answers (28 October 2026)

**Daily rate.** Daily rate = the GTA figure for the group charged + an uplift %. The uplift stays a Settings value (30% until Justin confirms the figure). GTA rates change each year, so the GTA table now lives in Settings (`gta_rate_tables`) with the date it applies from and its source. The table in force on the reservation date gives the rate, which is stored on the hire and never changed. A new table is added on Settings with its date, source and figures; earlier tables are kept as entered and two tables cannot share a date. No GTA figure is invented: the only table so far is the supplied 2026–27 table, copied once from the figures already in the CRM. If no table is in force, no rate is taken and the file says "Daily rate missing". The group charged list on the Hire tab comes from the table in force.

**Real fleet.** CAS's real V5C cars stay visible on TEST files under "Details missing – check before offering".

**Signed agreement (confirmed).** A credit-hire handover needs a signed hire agreement on file. An authorised override with a reason is still allowed. The client may sign beforehand or on the doorstep. The signed paper copy can be uploaded on the Hire tab before the handover, or on the handover form at the handover. Agreement 1 is recorded on the hire when the car is handed over (or at upload, if the car is already out), at the stored rate, with the signed date being when the copy was filed. E-signing is not built; it is the next job (known issue 36).

**Courtesy-car agreement.** Justin will supply an approved template. Fault files keep no agreement until then.

**Still open.** The 21-day licence window and recovery mileage.

**Small fix.** Links to a step on the Hire tab (for example Set the daily rate) now land with the heading clear of the slim bar.

Finish on 28 October 2026 (after these answers): 568 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed on their own database. `EMAIL_SEND_MODE` stays `simulate`.

Finish on 28 October 2026: 564 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed on their own database. `EMAIL_SEND_MODE` stays `simulate`.

## E-signing, two routes (J2, 28 October 2026)

Credit-hire agreements can now be signed electronically. Either route satisfies the handover rule. The paper copy upload still works.

**Route (a), signing link.** On the Hire tab, once the agreement is produced, "Send signing link" sends a one-time link to the client's email. Email stays simulated: the email is filed on the claim (Messages) with the link, and nothing reaches a real mailbox. The link works once, expires after 7 days, stops working when a newer link is sent, and refuses if the agreement has been produced again since. The client's page has no CAS login and no staff menus. It shows the agreement, then a name box, a drawn signature and an "I have read and agree" tick.

**Route (b), doorstep.** "Client signs on this phone" on the driver's handover page (at the top of the delivery record and again before Finish), or "Client signs on this screen" on the Hire tab. The page hides the staff summary because the client holds the screen. A driver can use it only on a file assigned to them today.

**Audit trail.** Each signature is a row in `esign_requests`: the agreement document and version, a SHA-256 fingerprint of the text signed, the route, who sent the link or witnessed the doorstep signature, when, the signer's typed name, the drawn signature, the device (browser user agent) and the network address. The only thing kept of a link is a fingerprint of it; the link itself is only in the filed email.

**Signed PDF.** The CRM builds the PDF on this computer (`src/lib/documents/signed-pdf.ts`, using the canvas library already in the project): the agreement text as signed, then a signature page with the drawn signature and the audit trail. It is filed as "Signed hire agreement". Agreement 1 is recorded on the hire at the handover, at the stored rate, as before.

**Safeguards.** An agreement produced with details missing cannot be signed; a new version must be produced. The CRM's note about which pages are included is left off what the client sees and the PDF. Courtesy cars have no agreement to sign until Justin's template is approved.

Finish on 28 October 2026: 574 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed, including the client signing through the link. `EMAIL_SEND_MODE` stays `simulate`.

## Recovery, step 2 (J3, 28 October 2026)

**Record the recovery.** Step 2's Record recovery opens one form at the top of the recovery screen: where the car was recovered from, and the date and time it arrived at the yard. The standard recovery fee (£395 from Settings) is shown ticked for the handler to confirm. Environmental (£150), Winching (£95), Forklift (£85) and Out of hours (£100) are tick boxes at their Settings fees; a changed fee needs a reason. Specialist winching, skates/dollies, waiting time and second operator are typed amounts with a reason, and there is a manual charge with a description. Every amount is plus VAT. Nothing is charged until Record recovery is pressed. The history line lists each charge and the total. Once recorded, the step folds to one line with Change. Charges cannot be changed there once the recovery head has an agreed figure or a payment.

**No silent charge at intake.** The new-claim form uses the same fee boxes. If the recovery date and time are left blank, nothing goes on the file; the choices are kept and offered again on step 2. If the date and time are entered, the recovery is recorded then, as before.

**Storage starts from arrival at the yard.** Recording the recovery sets the storage start to the arrival day. A different storage start already on the file is not overwritten; it is flagged for a person to choose on the storage screen, as before.

**Wording.** The agreed box on the recovery and storage money screens now says "Agreed recovery figure" or "Agreed storage figure", with a matching hint (it said "Agreed repair invoice"). The day-count note no longer says "Confirmed 14/10/2026"; it is a plain example. TEST-0005 shows the proposed storage end as provisional. Its storage end was not confirmed. The older recovery screen's Charges section is hidden on step 2 so fees are entered once; its saved figures are kept.

**Still open.** Recovery mileage. The 4.5% card fee is not on the new form (question 6).

Finish on 28 October 2026: 580 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed, including step 2 on the new repairable file. `EMAIL_SEND_MODE` stays `simulate`.

## Letters and engineer, steps 4 to 7 (J4, 28 October 2026)

**A letter marks its step.** Generating a letter on Messages marks its step done as sent, dated with the letter date, and the history says who marked it sent. The CRM still does not post or email the letter. Tick "Hold back the step. This letter has not been sent." to file the letter without marking the step. Emails are not marked by generating them; they are marked when the email is recorded as sent. The repair commencement letter does not mark repairs started, because that is a fact with its own date. The person who is signed in is recorded as the author, not the file's handler.

**Insurer email.** The Send email box offers "Initial email to the third-party insurer" when the recipient is the third-party insurer. It uses CAS's supplied initial-letter wording unchanged. Recording it as sent marks step 4.

**Steps 5 to 7 in one click.** After choosing engineer, Audatex or both, each of these is a button with a date that starts as today: Engineer instructed, Audatex estimate sent, Record report received (upload optional), Record estimate received, and Sent to the insurer. A future date is refused. Sent to the insurer needs the report or estimate received first and is recorded once. The Audatex reference and figures are optional when the estimate is sent; if any figure is typed, the reference and total are still required. Engineer instructed starts the engineer chase as before.

**Fault files.** A fault file already showed the client's own insurer and Audatex instead of the third-party letter and the engineer. Now Messages also hides the third-party insurer letters and email on a fault file (initial letter and email, liability chaser, hire pack cover, the three rebuttals, total-loss cessation), and the CRM refuses to produce or send them there. The problems list on a fault file no longer lists Send liability notification letter, Instruct the engineer or Request repair authorisation, and the driving licence, insurance certificate, V5C and bank statement chases are not started on a fault file. "1 open flags" now reads "1 open flag".

Finish on 28 October 2026: 586 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed, including steps 4 to 7 on the new repairable file and the fault file's letters and problems list. `EMAIL_SEND_MODE` stays `simulate`.

## Repairs, return and endings, steps 8 and 9 (J5, 28 October 2026)

**Step 8.** Once the report is sent to the insurer, step 8 has an "Authorisation received" button with a date that starts as today. An authorised figure and a reduction with its reason are optional and folded away. They are shown on the step and in the history. They do not change claimed, agreed or received. Recording it twice is refused.

**Step 9 on a repairable file.** Repairs started, Repairs complete and Car returned to the client are one click each with a date, in that order. A date before the earlier step, or in the future, is refused. Repairs started is offered once authorisation is recorded or step 8 is marked not needed.

**Hire end, repairable.** The driver's Hire car collection job no longer sets the hire end by itself. It records the collection day and proposes it. Step 9 shows "Hire car collected on …" with a Confirm hire end button, only after repairs are complete and the car is back with the client. The handler can change the day, but not to before the car was returned. A booking that already had a different hire end still goes to the existing review, as before.

**Storage end.** When repair authorisation or repairs started gives a proposed storage end, step 9 shows it with Confirm storage end. Nothing changes until the handler confirms.

**Total loss.** Step 9 shows the hire end proposed 7 days after the payment that settled the vehicle damage, with Confirm hire end. If the payment does not match the agreed figure, the salvage sale does not match, or a shortfall is disputed, it shows the reasons for a person to review instead of a date. The total-loss figures now also keep the salvage category (A, B, S or N) and a disputed shortfall with what it is about. A disputed shortfall is flagged and is never added to agreed or paid. Pre-accident value, salvage, payments received, salvage collection and sale proceeds were already kept.

**Repairable to total loss.** The repair history stays on the file and is listed under Earlier repair history on the total-loss step.

Finish on 28 October 2026: 590 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 69 passed, 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed, including steps 8 and 9 on the new repairable file with the storage end and hire end confirmed. `EMAIL_SEND_MODE` stays `simulate`.

## Money and chasing, step 10 (J6, 28 October 2026)

**Already in place and checked.** Each head of loss is its own ledger line (repairs or vehicle damage, recovery, storage, hire, other). Claimed, offered, agreed, received, outstanding and overpaid stay separate; an offer is never counted as received. A reply that is only an acknowledgement or an out-of-office does not resolve a chase. A chase is due once its interval has passed and stays one chase however long it waits, so an outage leaves no backlog: one email goes and the clock restarts from that send.

**Financials.** The Financials list now shows quantity × rate, net, VAT and gross for each line, and outstanding and overpaid beside claimed, offered, agreed and received. A provisional hire or storage figure shows outstanding as Under review.

**Aged debt.** Financials → Aged debt lists every head with money still owed (agreed figure, or a confirmed claimed figure, less received), grouped 0–30, 31–60, 61–90 and over 90 days from the day the payment request for that head was sent, and Not requested yet.

**Sending hours and the check before each send.** Chaser sending hours are a Settings value: Monday to Friday, 09:00 to 17:00 UK time until CAS confirms them (question 8). Once the mailbox is live, a chase email outside those hours is refused and nothing is sent. Immediately before any chase email goes, the chase is worked out again from the file: if a reply is on file, or it is paused or cancelled, nothing is sent. Payment chases keep their own fuller check (paid in full, bank details). Email stays simulated.

**Draft invoices.** The Money tab has a Draft invoice button for each head. It builds a plain invoice from the figures on the file (quantity × rate, net, VAT, gross, received, balance), files it on the claim and sends nothing. It says it is a draft, because CAS's invoice template, numbering and VAT number have not been supplied (question 7). A head with no charge is refused.

Finish on 28 October 2026: 595 tests passed, 0 failed. Type check: 0 errors. Production build passed. Page check: 70 passed (Aged debt added), 0 failed, no sideways scroll at 1280px or 1024px, database unchanged. Journey checks passed. `EMAIL_SEND_MODE` stays `simulate`.

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

Blocked: provider accounts, per-file permissions, shared hosting, live DVLA, live mailbox send.

## Not yet claimed

Stages 2–5 (finer permissions, live integrations, payment packs from CAS templates, litigation issue, backups/restore/deploy). Working dashboard is not production readiness.

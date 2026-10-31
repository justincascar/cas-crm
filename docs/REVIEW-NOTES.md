# CAS CRM — Review notes

Written by the reviewer, Claude (Cowork), after testing the app in the browser as a member of staff. Claude Code: fix everything under **Open** before starting the next job in `docs/JOB-LIST.md`. When a note is fixed, move it to **Fixed** with the commit hash. Each fix follows the usual rule: the finish routine passes, and you click through it as `sian` on a NEW claim.

## Open

Nothing open. R42–R47 from the retest of 31 October 2026 (afternoon) are fixed below.

**Not independently verified:** R30 automatic sending. Nothing is sent until Justin approves a chaser's wording (question 27); Settings → Automatic chasers now shows each chaser's full wording beside its switch (R46). Retest when he has.

## Fixed

- **R42** fixed in 4be50b3: the notes about where a letter's wording came from ("Wording is taken from CAS's supplied letter and email templates…", the solicitor sign-off and operational-draft notes) are shown on the screen above the sheet only, print-hidden, and are no longer put in the letter, its text, an email or an attachment. Letters stored before the fix: unsigned ones and emails not yet sent were cleaned once; signed ones are left as stored and cleaned whenever shown, printed or attached. Notes for staff inside a document (the draft invoice's note, the agreement's and pack's notes) show on screen in a dashed box marked "Note for staff, not printed" and never print or go out; draft invoices print headed "Draft invoice — …". Printed to A4 as `sian`: TEST-0041's new initial letter, TEST-0040's earlier initial letter, a rate rebuttal, an engineer instruction, two draft invoices, TEST-HA-000012 (agreement and pack), a Storage & Recovery Agreement, a credit recovery and storage agreement and TEST-0039's chronology. None carries the line.
- **R43** fixed in 4be50b3: after a swap, Hire step 4 leads with the current signed agreement (TEST-0039: TEST-HA-000012, signed 13:04) and lists the earlier ones under "Earlier agreements (replaced)", each with its own signature. The Documents list shows a produced agreement as "Signed – see signed copy" (signed on screen, by link, or printed and uploaded), "Replaced" (a later agreement was produced before it was signed), or "Unsigned".
- **R44** fixed in 4be50b3: step 10 reads "Paid in full dd/mm/yyyy" once the money received meets the agreed figure, the confirmed claimed figure or the recorded recovery charge (TEST-0039 recovery: "Paid in full 31/10/2026"); a claimed repair estimate reads "Claimed £1,500.00 · awaiting authorisation" (or "authorised, awaiting payment"; a total loss "awaiting settlement"); running figures read "£93.60 so far, including VAT".
- **R45** fixed in 4be50b3: the document header and the Documents list use plain kinds ("Hire agreement", "Letter", "Invoice (draft)"), never stored codes. Settings: the chase intervals say they are used by the automatic chaser once Justin approves a chaser's wording; the card fee is added when "Paying by card" is ticked in Record a payment; "Agreement maximum days" is now "Overdue from day (the agreement period is 89 days)", with "Agreement period 89 days" and "Agreement overdue from day 88".
- **R46** fixed in 4be50b3: Settings → Automatic chasers has "Read the wording" beside each switch: the full subject and body, made by the same code that sends it on a TEST file, inside a database step that is rolled back so nothing is filed, sent or changed. Where no TEST file has that chaser due, a labelled illustration with example figures is shown (the payment chasers show the first request and the reminder). The combined email for two chasers to the same recipient is shown too.
- **R47** fixed in 4be50b3: starting set-up again already replaced the key and removed the unfinished set-up; a code from the earlier key is refused and nothing is switched on until a code from the newest key is entered. Now covered by a test. AUTH-NOTES.md says how Justin sets up his authenticator, and that the other demo logins do not ask for one (required for an administrator only; question 29 asks whether all staff should use one before live use).
- **R27** fixed in df15389: the agreement (and a swap's new agreement) is refused until the client's own car group is on the file or a reason it cannot be classified is recorded, and, when the group charged is above the group of the car supplied, until a written reason is recorded. Both are entered in the group check on the Hire tab, kept on the file and shown in the history. The rate stays on the group charged; the agreement wording is unchanged. A different car or group charged needs its own reason.
- **R28** fixed in df15389: the swap is in two steps. Choose the replacement car, then any of its gearbox, seats, fuel, colour or group missing from the fleet record are boxes on the swap form, saved to the fleet record. The swap is refused without them, and asks for a reason when the group charged is above the replacement car's group.
- **R29** fixed in df15389: a swap's agreement has the next agreement number, version 1, titled "replacement car …, replaces TEST-HA-…". Its note names the replacement car. Hire step 4 shows the earlier agreement with its own signature and the new one on its own line as "awaiting signature" (then its own signature). Once signed, the new number becomes the file's agreement number.
- **R30** fixed in df15389: the server checks the due chases every five minutes, whatever is open, inside the sending hours. Each rule has an "Approved by Justin" switch in Settings → Automatic chasers, off until he approves its wording (question 27); only approved rules send. Before each send the file is checked again (answer on file, pause, closed or solicitor file, a reply from the recipient, bank details for payment chases). Email is simulated: each chaser is produced from its template, filed on the claim and in Communications marked simulated, and restarts the chase clock, so after an outage a chase sends once. Automations is worked out from each file, so a chase whose answer is on file reads "Done" (TEST-0039's engineer row included). The fictional chases due since September were paused once with a note.
- **R31** fixed in df15389: chasers due to the same recipient on the same file in one run go in one email that lists each item in its own template wording, with one greeting and sign-off. Each item's clock restarts.
- **R32** fixed in df15389: step 6 asks for repairable (estimate net, VAT, gross, checked to add up), total loss (pre-accident value, salvage category, salvage deduction) or not yet known, with the report upload optional. Repairable puts the estimate on the Repairs head as claimed; total loss saves the total-loss figures and puts the pre-accident value less salvage on the vehicle damage head as claimed. Offered, agreed and received are not touched. "Not yet known" keeps the task at step 7.
- **R33** fixed in df15389: on a credit-hire file the chronology (screen and print) lists the hire started, the swap, each signed agreement, renewals and payments received (in words, for example "Recovery payment received: £474.00."). A step entered with today's date takes the time it was recorded; earlier rows stamped 09:00 on the day they were recorded are placed at the time recorded.
- **R34** fixed in df15389: Automations and Communications (and the file's message lists) show plain words, never stored codes. "Sent" appears only with a mailbox's confirmation: the TEST-0001, TEST-0003 and TEST-0004 rows stored as sent were corrected to simulated, each with a history note. Stale "Reminder only — not auto-sent" wording was taken off the chase reasons.
- **R35** fixed in df15389: step 10 shows a running hire or storage charge as "Running since dd/mm/yyyy · £X so far · not yet invoiced" (or "draft invoice produced").
- **R36** fixed in df15389: the choose-car and swap lists use the fleet's vehicle type: free and matching cars, then cars with details missing, then "Other vehicles (vans, motorbikes, campervan, taxis)", each closest to the client's car first (gearbox, seats, group). Missing details read "details missing: gearbox, seats, group". The dashboard has a "Fleet details to complete" count.
- **R37** fixed in df15389: with "no bank account" recorded, the bank statements chase does not start (the Documents tab says so), and the agreement and Hire Pack ask only for the statement of means.
- **R38** fixed in df15389: once signed, Hire step 4 is one line with Change; the readings form and the print-and-upload instruction are gone; the means explanation in the pack fields is two lines.
- **R39** fixed in df15389: a vehicle with a registration but no make prints the registration alone (the gap still shows on screen). The supplied notification template lists repairs, hire and related losses such as recovery and storage, so the initial letter lists the heads recorded on the file.
- **R40** fixed in df15389: TEST-0013's possibly real client and every copy of his name, email and mobile in the development data were replaced with fictional ones (Mr Iolo Testwr, example.com, 07700 900 range); tests no longer use a real-looking name. The TEST files use a fictional engineer (Rhodri Testun, Example Assessors, engineer.test@example.org). CAS's engineer stays in Settings → Engineers marked live use only: he cannot be chosen on a file and nothing is sent to him from this CRM; TEST files that named him were moved to the fictional engineer with a note. Files already stored as PDFs were not edited.
- **R41** fixed in df15389: every generated letter, chaser, invoice, pack, the Storage & Recovery Agreement and the printed chronology show and print on CAS's headed paper: the logo, tyre track and red bar taken from the .docx (not redrawn), and a two-line plain-text footer read from Settings → Company details (seeded from the headed paper; administrators can change it). The address block at the top of letters and invoices is gone. The supplied Hire Pack and hire agreement pages keep their layout and wording, with only the logo added at the top of the first page. The CRM menu shows the logo. Printed to A4 from Edge: TEST-0040's initial letter, TEST-0039's recovery invoice, TEST-0039's chronology and TEST-0040's swap agreement; the logo is sharp, the footer is on every page, and no text runs under the red bar. Questions 7 and 26 updated. The website header and footer carry the logo, and the footer the company and VAT numbers (CAS-Website e640db6, local).

- **R23** fixed in 2731113: only names, addresses, postcodes and registrations (and a vehicle's make, model and colour) are given capitals; descriptions, notes, reasons, condition notes, letters and emails keep exactly what was typed, on every staff screen, the new-claim form and the client form (which never changed case). Phone keyboards start sentences with a capital instead of every word.
- **R24** fixed in 2731113: on a litigation file only Justin, or the person Justin records as the instructed solicitor (their CRM sign-in), can verify a court date; everyone else can add one with its source and it stays "needs verification", enforced on the server and with no button shown.
- **R25** fixed in 2731113: the card fee is the Settings % of the gross amount being paid (VAT included), then VAT on the fee; every invoice line reads "Card fee 4.5% of £X"; fees recorded earlier keep their net basis and say so; the screen wording says the same; questions file notes that the VAT treatment is to be confirmed with CAS's accountant.
- **R26** fixed in 2731113: Swap the car on a running hire records the old car's return (mileage, fuel, condition) and the new car going out, holds the new car, and produces a complete new hire agreement from the Hire Pack with the new car's details, mileage and fuel out and the date and time (wording unchanged). The car changes only when the new agreement is signed on screen or the signed paper copy is uploaded, or on Justin's override with a reason; a swap can be cancelled. One continuous hire: start date and day count unchanged; the earlier signed agreement is marked superseded and linked; the new signed agreement becomes the latest agreement, so the 80/88-day alerts follow it, and the Hire tab shows "Hire day N · current agreement day N (signed …)". Choose a car on a running hire is refused and points to the swap. The Hire Pack has no box for the hire car's condition, so condition is kept on the swap record and the history. Solicitor note added. Questions 16, 17, 19 and 21 marked answered.
- **R22** fixed in eb9b355: a chosen hire car shows make, model, registration, gearbox, fuel, seats, colour, GTA group, current mileage and where it is; they carry into the hire pack, the agreement, the handover and the driver job; missing ones are boxes on the Hire tab, saved to the fleet record once; Hire / Fleet has "Fleet details to complete" (V5C fuel and colour used, gearbox, seats and group never guessed); Settings has make-and-model rules that suggest a group only when they agree.
- **R19** fixed in 7bf709f: card-fee tick removed from the recovery and new-claim forms (saved fees kept, with a history note); "Paying by card" on Record a payment and on each draft invoice adds a separate card fee (Settings % of the net amount being paid, plus VAT) on any head, in its own ledger, shown beside the head totals and as its own invoice line, never in the charge, received or outstanding. Question 16 asks Justin to confirm the net basis.
- **R20** fixed in 7bf709f: GTA paragraph approved as written; no draft mark; still off unless ticked on the rebuttals and the hire pack cover letter.
- **R21** fixed in 7bf709f: only Justin can authorise claiming recovery or storage without a signed Storage & Recovery Agreement, with a written reason kept on the file and shown in the history, the chronology and the Recovery page. Questions 13, 14 and 15 marked answered.
- **R17** fixed in 2967ad7: the standalone Storage & Recovery Agreement is the supplied Hire Pack Storage & Recovery page, the relevant supplied definitions and clauses (copied line by line) and the supplied notice of the right to cancel; signed on screen or by paper upload from the Recovery page; recovery and storage payment requests are refused until it is signed (or a signed hire agreement included the page); the customer invoice names the signed agreement; question 10 updated.
- **R18** fixed in 2967ad7: the clause 5.3 citation and doorstep signing and cancellation rights are under "For your solicitor" in QUESTIONS-FOR-JUSTIN.md. The terms were not edited.
- **R13** fixed in 37b2895: recording step 7 (report sent to the insurer) starts the 3-day chase, worded for repair payment, the total-loss payment (pre-accident value less salvage) or the insurer's decision; when the outcome is not set the handler gets a task to set it. Existing chase rules unchanged.
- **R14** fixed in 37b2895: Settings shows the sending hours (Monday to Friday, 09:00 to 17:00 UK time) as confirmed by Justin.
- **R15** fixed in 37b2895: Card fee tick on the Record the recovery and new-claim forms, off by default, worked out on the ticked charges, VAT on the fee as the old screen, its own line; percentage in Settings. VAT on the card fee is question 13.
- **R16** fixed in 37b2895: optional not-a-GTA-subscriber paragraph on the three rebuttals and the hire pack cover letter, off by default, above the sign-off; draft-marked so it cannot be sent or attached until Justin approves the wording (question 14). Questions 6, 8, 9 and 11 marked answered.
- **R1** fixed in 69cec49: mileage and fuel out, transmission (saved to the fleet record), licence date of issue and date out (booked date and time) are needed before the agreement is produced; the doorstep screen takes mileage and fuel first and re-produces the agreement; the agreement shows a dash, never "Missing — not guessed" or "not entered".
- **R2** fixed in 69cec49: handover time defaults to now with the booked slot as a hint; a time before the electronic signature is refused unless a reason is given.
- **R3** fixed in 69cec49: the handover record says how and when the agreement was signed (electronically, paper copy, or authorised override); the handover sheet signature is worded separately.
- **R4** fixed in 69cec49: a delivery job closes when the hire starts; Driver jobs has a Done today group; open deliveries for started hires were closed with a history note (TEST-0004, TEST-0015); TEST-0004's old collection was cancelled with a note.
- **R5** fixed in 69cec49: insurer letters and the insurer email show the insurer's claim reference and policy number, whichever are held; they do not ask for a reference already held; the date prints once.
- **R6** fixed in 69cec49: no code word; one line "Email: simulated – nothing leaves the CRM"; Messages folds into sections with the likely next action first (the letter for step 4).
- **R7** fixed in 69cec49: step 10 says Not started until a charge is recorded (recovery, hire and storage).
- **R8** fixed in 69cec49: Recovery shows charges only once the recovery is recorded; recoverer details under More; offer, agreed, payment and dispute under one Money section, closed until there is something to do.
- **R9** fixed in 69cec49: the list is "Open claims by next step" with All / Need action today / Overdue filters; each count opens its matching list.
- **R10** fixed in 69cec49: group charged is suggested from the client's own car with the reason (or says why not); the header names the actual next hire item: Pre-hire checks, Hire agreement – sign, Handover.
- **R11** fixed in 69cec49: only office staff are offered or accepted as claim handlers.
- **R12** fixed in 69cec49: rebuttals and the impecuniosity response show "Needs Justin's approval"; a new approveLegalCorrespondence permission (Justin) approves; marking sent or emailing is refused until approved. No letter-before-action or court template exists yet; any added later goes on the same list.

<details><summary>Reviewer's note R22 (30 October 2026)</summary>

**R22 — Choosing a hire car must show and carry over all of its details (from Justin, 30 October 2026).**
When Justin selected a hire car, the gearbox, GTA group and fuel type didn't come through. Most of CAS's real fleet cars were imported from V5Cs with transmission, seats and group missing ("transmission not recorded · seats not recorded"), and the hire agreement showed the supplied car's group as "not classified".

What to do:
- **When a car is chosen,** show its full details next to it:
  - make, model and registration
  - gearbox, fuel, seats, colour
  - GTA group
  - current mileage
  - where it is
- Carry every one of those into the hire pack, the agreement, the handover and the driver job automatically. Never ask for them again.
- **If any of those details are missing on the fleet record,** show the missing ones as boxes right there on the hire screen. Whatever staff enter is saved to the fleet record once, so the next hire has it.
- **Help complete the real fleet records in one go.** Add a "Fleet details to complete" list on Hire / Fleet, showing each car with what's missing and quick boxes to fill it in.
  - Where the V5C data already held gives fuel or colour, use it.
  - Never guess gearbox, seats or GTA group. Staff enter those.
- **Suggest the GTA group for the supplied car** from its make and model only where Settings has a clear rule. Otherwise staff choose it.
- **Test:** choose a car with complete details and confirm all of them appear on the agreement. Then choose a car with missing details, fill them in on the hire screen, and confirm they're saved to the fleet record and appear on the agreement.

</details>

<details><summary>Reviewer's notes R19–R21 (30 October 2026)</summary>

**Justin's answers, 30 October 2026.** When these are done, mark questions 13, 14 and 15 answered in `QUESTIONS-FOR-JUSTIN.md`.

**R19 — Move the card fee to the point of payment.**
Justin: VAT is added to the card fee, but the fee is only known when the invoice is paid, because that's when CAS learns the payer is using a card.

What to do:
- Remove the card-fee tick from the "Record the recovery" form and the new-claim form. Keep any figures already saved, with a history note.
- When a payment is recorded against an invoice, or a draft invoice is prepared for payment, add "Paying by card". When ticked, it adds a separate card-fee line:
  - the % from Settings, on the net amount being paid
  - plus VAT
- Show it on the invoice and on the money totals, kept separate from the recovery charge itself so it's never double-counted.
- This applies to whichever head of loss is being paid (recovery, storage, repairs or hire), not just recovery.

**R20 — GTA paragraph wording approved by Justin, as written.**
Remove the draft marking. Staff can tick it on the rebuttal letters and the hire pack cover letter. It stays off unless ticked.

**R21 — Override for recovery and storage claims without a signed agreement: Justin only.**
- A recovery or storage payment request may be recorded as sent without a signed Storage & Recovery Agreement only by Justin's authorised override.
- The override needs a written reason, which is kept on the file and shown in the history and the chronology. Same pattern as the hire handover override.

</details>

<details><summary>Reviewer's notes R17–R18 (29 October 2026, evening)</summary>

**R17 — Use the recovery and storage wording CAS already supplied (answers question 10).**
The supplied Hire Pack terms (`src/lib/documents/cas-hire-terms.ts`, taken from Hire Pack.doc) already define "Storage & Recovery Charges" as part of the "Total Charges" the customer must pay (definitions, and clauses 1.1, 1.5, 2.2 and 2.17).

What to do:
- Use that existing wording. Do not write new terms.
- Make sure a client who has recovery or storage but NO hire car still signs the Storage & Recovery Agreement, with the relevant definitions and clauses from the same supplied terms attached, before charges are claimed. Use the same signing routes as the hire agreement: on screen or paper upload.
- The customer invoice for recovery and storage refers to that signed agreement.
- Update question 10 in `QUESTIONS-FOR-JUSTIN.md` to say the wording comes from the supplied Hire Pack. Justin only needs to send a newer version if one exists.

**R18 — Flag for legal review only; do not change the wording.**
Add to `QUESTIONS-FOR-JUSTIN.md`, under "for your solicitor":
- Clause 5.3 cites the Consumer Credit (Exempt Agreements) Order 1989. The reviewer understands that Order was replaced in 2014, when consumer credit moved to the FCA, so the citation may need updating.
- Doorstep signing and the client's cancellation rights.

Do not edit the terms. This note is for Justin's solicitor to confirm.

</details>

<details><summary>Reviewer's notes R13–R16 (29 October 2026, evening)</summary>

**Justin's answers, 29 October 2026 (evening).** Make these changes. When done, mark questions 6, 8, 9 and 11 answered in `QUESTIONS-FOR-JUSTIN.md`.

**R13 — Chase starts automatically when the report goes to the insurer.**
When step 7 is recorded (report or estimate sent to the third-party insurer), the every-3-days chase starts automatically. It must chase the right thing for the outcome on the file:
- **Repairable:** chase for repair authorisation, using the wording "arrange payment of repairs" where appropriate.
- **Total loss:** chase for the total-loss payment (pre-accident value less salvage, per the file).
- **Outcome not recorded yet:** use neutral wording ("your decision on the vehicle damage claim") and flag it for the handler to set the outcome.

The chase follows all the existing rules:
- a substantive reply pauses it
- an acknowledgement or out-of-office does not resolve it
- the claim is rechecked before each send
- staff can pause, resume or cancel it

**R14 — Chaser sending hours confirmed.** Monday to Friday, 09:00 to 17:00 UK time. This is already the default; mark it confirmed.

**R15 — Card fee as an optional tick.** Add the card fee (4.5%) to the new "Record the recovery" form:
- as an optional tick, off by default
- calculated on the ticked recovery charges
- shown as its own line
- with the percentage held in Settings

Note in the questions file whether VAT applies to the card fee. Default: the same VAT treatment as the old screen used; Justin to confirm.

**R16 — CAS is NOT a GTA subscriber (confirmed).** Add an optional paragraph that staff can tick to include in insurer letters and emails, off by default, shown on the rebuttal letters and the payment pack. Draft wording, for Justin to approve in the questions file; the CRM must not treat it as approved until he does:

> "Complete Accident Solutions Ltd is not a subscriber to the General Terms of Agreement (GTA). GTA rates, rate reductions, protocols and dispute-resolution procedures do not apply to this claim."

The daily rate stays as Justin decided: the GTA figure for the group plus the uplift %, used as CAS's own price list.

</details>

<details><summary>Reviewer's original notes (29 October 2026)</summary>

**Test of 29 October 2026.** The reviewer created TEST-0026 (non-fault, unroadworthy) through the new-claim form, then took it through:
- recovery (standard fee plus winching)
- the hire steps: real-fleet car CN16 AYS reserved for Demo Driver, rate S3, licence check, "no bank account", hire reason
- the agreement, the on-screen signature and the handover
- a preview of the initial letter to the third-party insurer

**What worked well:**
- the 10 steps on the claim
- no silent recovery fee
- recovery £490 + VAT = £588
- storage £39 a day from arrival
- the address taken from the file
- the car step folding to one line
- the daily rate stored (£66.53, S3)
- clear lists of what's missing
- the handover refused without a signed copy
- the on-screen signature
- hire started, with the next action moving on to "Send letter"

### Serious

**R1 — The signed agreement shows gaps and placeholder text to the client.**
The agreement TEST-HA-000006 that the client signed on screen showed:
- "Date out: Missing — not guessed"
- "Transmission: Missing — not guessed"
- "Date of issue: Missing — not guessed"
- mileage and fuel at delivery as "not entered"

Fix:
- **Date out** comes from the reservation date and time, updated at handover.
- **Mileage and fuel out** are entered BEFORE the client signs on the doorstep. The order is: enter mileage and fuel → client signs → complete the handover. The signed PDF must contain them.
- **Transmission** comes from the fleet record. If the car's details are missing, let staff fill them in from the hire screen (saved to the fleet record).
- **A client-facing document never prints "Missing — not guessed".** Treat these as mandatory before signing, apart from genuinely optional fields such as "Date in: Hire continuing", and list them with links.

**R2 — Handover time defaults to the reserved slot, so the history says the car went out before it was signed.**
The handover form defaulted to 15:00 (the reserved slot). The handover was completed at about 15:31, after the agreement had been signed at 15:31. The history now says "Hire started 29/10/2026 15:00", before the signature.

Fix:
- Default the handover time to now. Keep the slot as a hint.
- Refuse, or warn about, a handover time earlier than the signature time, unless a reason is given.

**R3 — The handover record says "Not signed" when the agreement was signed electronically.**
TEST-0026's history: "Vehicle handover recorded … Not signed." The agreement was signed electronically. The handover record must reflect the agreement's signed status, saying how and when it was signed.

**R4 — Driver jobs don't match reality.**
- TEST-0026's delivery job (Demo Driver, 29/10 15:00) doesn't appear anywhere on Driver jobs after the handover. If it was closed automatically, show it under "Done today"; it must not vanish.
- TEST-0015's delivery job (28/10 10:00) still shows Overdue, although hire started on 28/10. Close any delivery job whose hire has started, as a data repair with a history note.
- TEST-0004's delivery and collection jobs have been overdue since September. Tidy that fictional data.

**R5 — The initial letter to the third-party insurer leaves out their claim reference.**
TEST-0026 had the third-party insurer's claim reference EX-123456 entered at intake. The preview shows "Policy Number - [not yet on file]" and asks the insurer to "confirm your claim reference".

Fix:
- Insurer letters must show the insurer's claim reference and the policy number, whichever are held, and only show "[not yet on file]" when neither is held. This is a project rule: every insurer letter carries the CAS reference and the insurer's reference.
- Don't ask for a reference we already hold.
- The date is printed twice. Print it once.

### Clutter and wording

**R6 — The Messages page shows staff a code word and repeats warnings.**
- It shows "EMAIL_SEND_MODE". Never show code words to staff.
- It repeats the "not sent / simulated" warnings about four times. Replace them with one status line, e.g. "Email: simulated – nothing leaves the CRM".
- Engineer, email, WhatsApp, calls and documents are all on one long page. Split them into clear sections that fold away, or tabs, with the most likely next action first. For step 4, that's the initial letter.

**R7 — Step 10 wording on a new claim.**
Before anything was recorded, step 10 said "Recovery: Figure final. No payment request recorded." Show "Not started" until recovery is recorded.

**R8 — The Recovery page still shows the old blocks.**
Below the new "Record the recovery" form, the old "Recovery details" block showed a £474 charge before anything was recorded ("No recovery recorded yet · Net £395 · VAT £79 · Total £474"). It's followed by the old recoverer form, the agreed figure, payments, the dispute and offers, all on one page.

Fix:
- Show charges only once the recovery is recorded.
- Fold the old recoverer details away under "More".
- Put the money actions (offer / agreed / payment / dispute) under one "Money" section, closed by default until there's something to do.

**R9 — The dashboard count doesn't match the list.**
"Need action today: 7", but Today's work lists 18 claims. Make the count match the list. Alternatively, rename the list "All open claims by next step" and add a filter showing only the 7 that need action today.

**R10 — Hire step guidance.**
- "Group charged" lists 46 groups with no help. Pre-select or suggest a group from the client's own vehicle (and say why), so staff aren't guessing.
- While the car is reserved and the checks or agreement are in progress, the header still says "Next action: Arrange hire". Make it name the actual next item, e.g. "Pre-hire checks", "Hire agreement – sign" or "Handover".

**R11 — The new-claim form offers drivers and mechanics as handlers.**
The Handler dropdown offers Demo Driver and the mechanic. Only office staff can be claim handlers.

### Approval rule

**R12 — Rebuttal letters need Justin's approval before sending.**
"Rebuttal — hire rate / need / duration" and "Impecuniosity disclosure response" are case-specific legal arguments.
- Generating a draft is fine.
- Marking one as sent, or emailing it, must require Justin's approval (the approveSettlement-level permission, or a new approveLegalCorrespondence permission on Justin's staff row), with a clear "Needs Justin's approval" state.
- Check the same applies to any letter-before-action or court template.

</details>


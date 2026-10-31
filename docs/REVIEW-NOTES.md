# CAS CRM — Review notes

Written by the reviewer, Claude (Cowork), after testing the app in the browser as a member of staff. Claude Code: fix everything under **Open** before starting the next job in `docs/JOB-LIST.md`. When a note is fixed, move it to **Fixed** with the commit hash. Each fix follows the usual rule: the finish routine passes, and you click through it as `sian` on a NEW claim.

## Open

**R49 — QR code on the authenticator set-up.** Part done in 14f366d: the set-up page now says each new set-up gives a new key (signing in again, pressing "Set up an authenticator app" again, or after the 5-minute step expires) and to remove the old CAS CRM entry first. A plain refresh of the page keeps the same key, so the line says what really makes a new one. **Still open:** the QR code needs a QR encoder. None is in the CRM; Claude Code asked to install the `qrcode` package from npm (MIT) and had no answer, so nothing was downloaded. Question 30.
Justin set up his authenticator by typing the key, and was caught out when the page reloaded with a new key. Fix:
- Show a QR code of the same key, made on the server with no outside service, so it can be scanned instead of typed.
- Add one line: "If you refresh this page you get a new key: remove the old CAS CRM entry from your app first."

**R55 — Rebuild the Recovery page as four steps (Justin approved, 31 October 2026).**

**Today's problems:**
- It only records the end ("When the car has arrived at the yard … Storage starts that day").
- "Where the car was" is free text.
- It re-asks condition and the not-driveable reason.
- It always assumes the CAS yard.
- Ten charge lines show before anything has happened.
- The same details sit in "Record the recovery", "Recovery details", "More – recoverer details" and "Car movements".

**Build one Recovery page with four steps.** Each step folds to one line with Change once done, like the claim steps.

**Step 1 — Where is the car now?**
- Choose one:
  - **Accident scene** (filled from the intake location)
  - **Client's home** (filled from the client's address)
  - **Client's work** (address box, saved to the client)
  - **Roadside elsewhere** (postcode, road or landmark, optional map pin)
  - **Police or council compound** (name, address, reference, release fees)
  - **Another garage** (name, address)
  - **Other**
- Then:
  - Who is with the car, and their phone
  - Where the keys are
  - Access notes: low height or car park, locked or damaged wheels, needs skates or dollies, in a ditch
- Condition and the unroadworthy reasons come pre-filled from the intake (R52) and can be edited here. Don't ask twice.
- "Recovery not needed" (for example roadworthy and the client keeps the car) with a reason, which closes the page to one line.

**Step 2 — Book it.**
- Who: a CAS driver (staff with the driver role) or an outside recovery firm (saved recoverers, the same type-ahead as insurers, with their reference).
- Booked date and time.
- This creates the driver's job, like delivery jobs, with the location, contacts, keys and access notes.
- Optional "Recovery on the way" message to the client (simulated, using the existing template).

**Step 3 — Collected.**
- Date and time collected, photos at collection (optional), and the condition at collection if different.
- Charges appear here and nowhere earlier:
  - Standard recovery £395 + VAT, ticked and overridable with a reason, as now.
  - A "+ Add extras" control for the existing extras and amounts (environmental, winching, forklift, out of hours, specialist winching, skates/dollies, waiting time, second operator, manual charge).
- **Out of hours** is suggested (ticked, with "why" shown) when the collection time falls in Settings → Out-of-hours times. Defaults confirmed by Justin: before 08:00, after 18:00, Saturdays and Sundays. Bank holidays: a setting, off until Justin confirms. Staff can untick it with a reason.

**Step 4 — Delivered to.**
- **CAS yard** (default), **a repairer** (saved repairers type-ahead), **the client's home**, or **other** address.
- Arrival date and time.
- **Storage starts only when the car is delivered into storage:** the CAS yard, or another storage address on the file. Delivery to a repairer or home starts no storage and says so.
- Delivery fills the movement record automatically.

**Also:**
- **Below the steps:** Money (closed until there is something to do), the Storage & Recovery Agreement, and the movement history built automatically from steps 2–4, plus "Record another movement" for later moves (keep the required-by-accident or convenience question).
- **Remove the duplicate blocks.** Fold "More – recoverer details" into step 2. Fold the old "Recovery details" into the step summaries.
- **Existing files keep their recorded data,** mapped into the steps with a history note. Nothing is recharged.
- **The claim's step 2 and the dashboard** show the stage, for example "Recovery booked 14:00 – Rhodri", "Collected – on the way to the yard", "At the yard since 31/10/2026 19:10".
- **Fault claims** use the same page.
- **Test as `sian` on a new claim:**
  - roadside → booked → collected at 19:30 (out of hours suggested) → CAS yard: storage starts at arrival
  - client's home → repairer: no storage
  - "recovery not needed"
  - check the driver job is created and phone-width works for the driver

**R58 — Urgent roadside recovery: send the truck first, and the client signs on the driver's phone (Justin approved, 31 October 2026). Build it together with R55.**

Example: a caller is stuck on the A467 roundabout and needs recovery now. Nobody knows the extras (oil granules, winching, skates) until the driver arrives.

1. **"Urgent recovery" button** on the dashboard and the claims list. It asks only for:
   - name
   - mobile
   - where the car is (free text, plus an optional map pin)
   - registration
   - "Anyone hurt or in danger?" (Yes / No). Yes shows one line: "Tell them to call 999 if anyone is hurt or in danger."

   It creates the claim (CAS reference at once) and the recovery job (R55 step 2, booked now), and assigns or notifies the driver. Everything else stays in the draft for the office to complete later. File set-up items stay "Not yet known" (R50).
2. **Driver's phone screen on arrival:**
   - **Photos**, at least one of the car in place.
   - **Extras actually used**, ticked by the driver with the default price shown. Environmental, winching, specialist winching, skates/dollies, waiting time, second operator and forklift each need at least one photo, or a written reason why no photo was possible. Photos are kept with time and place and filed on the claim.
   - **The client signs the Storage & Recovery Agreement on the driver's phone before the car is loaded.** Use the existing R17 agreement and on-screen signing.
     - The screen above the signature shows the standard recovery £395 + VAT and lists the possible extras with their prices, marked "charged only if needed, with photo evidence".
     - The extras the driver has ticked are listed. Extras added after signing are shown to the client on the delivery or follow-up screen.
   - **If the client can't sign** (hospital, unfit, police-directed removal, not present), the driver chooses the reason and adds photos. A signing link is offered to send later (simulated). Until it's signed, recovery and storage can be claimed only with Justin's existing override (R21).
3. **Cancellation wording:** use the express-request wording and cancellation notice from CAS's supplied Hire Pack / Storage & Recovery Agreement only. **Don't write new legal wording.** Add a tick, which the client must tick, recording that they asked for the recovery to start straight away; use the wording already in the supplied documents if there is any. If there isn't, leave a clearly marked placeholder for the solicitor and add the question below.
4. **Questions file, "For your solicitor":** add "Roadside signing: a recovery agreed and started at the roadside is likely to be an off-premises contract under the Consumer Contracts Regulations 2013. Please confirm:
   - the express-request and acknowledgement wording, so the recovery can start within the 14-day cancellation period (reg. 36), and what the client pays if they cancel after work has begun (reg. 37)
   - whether any exception applies to urgent roadside recovery
   - the effect if the cancellation information isn't given at the roadside"

   Justin's view: clients can waive the right. The solicitor confirms the exact position and wording.
5. **Test** on a phone-width screen, as the driver and as `sian`:
   - urgent recovery created in under a minute
   - the driver job appears
   - the driver adds an environmental extra with a photo, and the client signs, then collected → CAS yard: storage starts at arrival
   - a second run where the client can't sign (reason recorded, link offered, claim blocked without Justin's override)

**R61 — TEST-0042 (Justin's test): recovery lost, and the signed agreement has no Storage & Recovery page (31 October 2026).**

What happened on TEST-0042 (Miss Aria Roberts):
- Justin entered the recovery with deliberate mistakes. The form wiped everything (R59), and **no recovery was ever saved**: the history has no recovery entry, and step 2 is still "To do".
- He then did the hire. Hire Agreement TEST-HA-000013 was signed on screen at 16:44. Because no recovery was recorded at that moment, the agreement correctly left out the Storage & Recovery page. In practice CAS *did* recover and store the car, so the client signed nothing covering recovery and storage.
- The reviewer then recorded a recovery on TEST-0040 with no mistakes, and it saved correctly ("At the yard from 31/10/2026 15:30 · £474.00"). So the save works; the loss is the R59 wipe.

Fix:
1. **When recovery or storage is recorded after the hire agreement was signed without the Storage & Recovery page,** say so plainly on the Recovery page, the claim's next step and the dashboard: "The signed hire agreement TEST-HA-000013 does not cover recovery and storage. Get the Storage & Recovery Agreement signed." Offer the existing on-screen, link and paper routes.
   - Today the Recovery page says "This client has a hire car. Once the hire agreement is signed with its Storage & Recovery page, nothing more is needed here" even when the signed agreement doesn't include that page (TEST-0040, TEST-0042). Only show that sentence when the signed agreement actually includes the page.
2. **Before the hire agreement is produced on an unroadworthy, non-fault file with recovery "needed" but not recorded,** ask: "Recovery not recorded yet – record it now so the agreement includes the Storage & Recovery page?" with a link. Staff can carry on without it, with a reason.
3. **Payment requests** for recovery and storage stay refused until a signature covers them (R17). Check this is enforced on TEST-0042 once its recovery is recorded.
4. **Leave TEST-0042 for Justin** to finish as a test: record the recovery, then sign the Storage & Recovery Agreement on screen.

**R63 — Step 4 "Send letter" should prepare the right letters automatically (Justin, 31 October 2026).**
Today, clicking "Send letter" on step 4 leads to "Choose who this is going to", then "Choose a CAS email template", then "Fill from this file". Justin's rule: the first letters are always the same for a given kind of file, so the CRM should prepare them filled in and addressed. Staff only check and send.

Clicking step 4 "Send letter" opens a **"First letters" page** with the right pack already prepared:

**Non-fault file:**
1. **Initial letter to the third-party insurer**: the existing "Non-fault initial letter (third-party insurer)" wording.
   - Addressed to the third-party insurer's email from the file. If a third-party representative (agent) is recorded, send to the agent and copy the insurer.
   - It must carry:
     - the CAS reference, and their claim reference and policy number where held (R5)
     - client, both vehicles, accident date, time and location
     - **the MID search**: date searched, registration searched, result, insurer and policy number found. Add this as a short block in the letter if the template has no place for it, and show Justin the wording in the Read-the-wording style (R46).
   - It asks them to confirm: that they are the insurer and indemnity is in place, their claim reference, and their position on liability. Don't ask for anything already held (R5).
2. **Client welcome**: the existing "Client welcome (intake)" email, to the client's email.
3. **Client acceptance of services / authority**: see question 30 below. Until Justin supplies or approves the wording, show "Waiting for CAS's wording" and don't generate it.

**Fault file:**
1. **Letter to the client's own insurer**: the existing "Fault claim letter (client's own insurer)", reworded per Justin. In short: CAS has been asked by their policyholder to carry out the repairs. Please provide your claim reference and **network (approved repairer) code**, so the repair can be networked to CAS.
   - Include: client and policyholder, policy number, vehicle, accident date, and the CAS reference.
   - Mark the new wording as draft until Justin approves it, the same as R16. Don't add legal or contractual statements.
2. **Client welcome**: as above, worded for a fault claim. Repairs and courtesy car only; don't promise recovery of losses from a third party.

**On the page:**
- Each letter shows a preview, its recipient (changeable), what's missing (with links to fix), and "Generate" (letter or PDF) or "Send" (email, simulated). There's also "Send all".
- Step 4 is done when the insurer letter is sent or marked sent, and the existing chase starts.
- Add a "Network code" field to the file: insurer's claim reference and network code, on the client's own insurer panel. Fill it when the insurer replies.
- **In the general "Send email" section,** choosing a recipient should pick the matching template and fill it straight away. Remove the separate "Fill from this file" click.

**Questions file:**
- **Question 30:** "Client acceptance of services / authority form. Supply CAS's current wording, or ask the reviewer to draft one for your solicitor to approve. Until then it isn't generated."
- **For your solicitor:** "Wording of the fault-claim letter asking the client's own insurer for a network code (not legal advice, check only)."

**Test:**
- a non-fault file with the MID recorded: the pack is prepared, the insurer letter shows the MID block and the references, step 4 completes and the chase starts
- a fault file: own-insurer letter asking for the claim reference and network code
- a file with no insurer email: "missing" with a link

**R64 — Letters by liability status, and new draft documents (Justin, 31 October 2026). This extends R63.**
The reviewer has drafted the missing documents in `docs/correspondence-templates/drafts/CAS-document-drafts-31oct2026.md`:
- client instruction and authority (the "acceptance of services")
- fault repair authority
- the own-insurer letter asking for the claim reference and network code
- the own-insurer notification on non-fault claims
- split-liability letters to the insurer and the client
- the letter for liability disputed or not yet known
- a courtesy car agreement outline

None is approved.

Do this:
1. **Liability status choices** on the file: Non-fault, Fault, Split (with the percentages), Disputed, Not yet known. Map existing values.
2. **The "First letters" page (R63)** picks its pack from the table at the top of the drafts file:
   - **Non-fault:** the initial letter to the third-party insurer, plus Draft 4 to the client's own insurer, plus the welcome and Draft 1.
   - **Fault:** Draft 3 to the client's own insurer, plus the welcome (fault wording) and Draft 2. **Never** the initial letter to the third-party insurer.
   - **Split:** Drafts 5a and 3, plus 5b and Draft 1.
   - **Disputed or not yet known:** Drafts 6 and 4, plus the welcome and Draft 1.

   When the status changes, offer the new status's letters and keep the earlier ones on the file.
3. **Add each draft as a template, word for word,** on CAS headed paper.
   - Each is marked "Waiting for Justin's approval" and can be previewed, but can't be sent, marked sent or signed until Justin approves it in Settings (the R46 / R16 pattern).
   - Drafts 1, 2, 4 and 5 also need the solicitor's sign-off. Record that on the approval: "Approved by Justin on … · solicitor checked on …".
   - Draft 7 (courtesy car) is an outline only. Show "Waiting for CAS's wording" and generate nothing.
4. **Signed documents.** Drafts 1 and 2 are signed like the hire agreement: on screen, by link or on paper. The signed copy is filed. The tick at clause 10 (Draft 1) or clause 9 (Draft 2) is required to sign.
5. **Missing-data rules** as written in the drafts:
   - leave out reference lines that aren't held
   - leave out the MID sentence when there's no MID record
   - the one-line account in Draft 6 is typed or checked by the handler, never generated
6. **Split liability.** On a Split file, show a warning on the Hire tab: "Split liability – check with Justin before continuing credit hire." Justin decides per file.
7. **Questions file:** replace question 30 with "Read the drafts (link to the drafts file) and approve or change each one". Add the drafts file's "Points for the solicitor to check" under "For your solicitor".
8. **Test:** one file of each liability status. Check the right pack appears, a fault file never offers the third-party initial letter, unapproved drafts can't be sent, and changing Non-fault to Split offers 5a and 5b.

**R65 — Step 5: one-click engineer and Audatex instructions (Justin, 31 October 2026).**
Today, step 5 is "Engineer, Audatex estimate, or both → Save choice", then a bare "Engineer instructed" button. Nothing is produced or sent, and the engineer gets nothing from the CRM. Justin wants step 5 to send the instruction, with everything the engineer needs, in one click.

Build:
1. **Step 5 shows the right buttons for the choice:**
   - **Engineer:** "Send instruction to [engineer]". Default: Settings → Engineers → the default engineer, which is CAS's engineer on live files. TEST files use the fictional engineer (R40 stays). The engineer can be changed from a drop-down.
   - **Audatex:** "Send to [staff member] for Audatex". Send it to the staff member set in Settings as the Audatex estimator (question 31), and create their task "Prepare Audatex estimate – [CAS ref]", due today.
   - **Both:** both buttons, plus "Send both".
2. **One click sends (simulated until the mailbox is live).** The email is built from the engineer instruction template (`02-engineer-instruction`) on headed paper, with a PDF attached and the file's photos attached. A small "Preview first" link is optional, not a required step.
3. **CC:** the file's handler by default, plus any extra CC addresses set in Settings (for example a shared claims mailbox). The Audatex email CCs the handler.
4. **Everything the engineer needs, filled from the file:**
   - **References:** CAS reference and the handler's name and phone.
   - **Client:** name and mobile, to arrange access.
   - **Vehicle:** make, model, registration, colour, fuel and mileage if known.
   - **Where the vehicle is now (R55):** address, contact, keys and access notes.
   - **Damage:** accident date and a short circumstances summary, the damage areas (R52 diagram list) and the description, roadworthiness and the "safe to drive" answers.
   - **Insurer:** third-party insurer and their references, and the liability status.
   - **What CAS needs back:** inspection date, report, repair estimate, and, if uneconomical, the pre-accident value and salvage category. Use the template's wording for this list; if the template lacks an item, add it as a short bullet and show it in the R46-style wording check for Justin.
5. **Missing items stop the send and list themselves with links** (R56 style), for example "No vehicle location" or "No photos – send anyway?". Photos are a warning, not a block.
6. **After sending:**
   - step 5 shows "Instruction sent to Rhodri Testun 31/10/2026 17:10" (on TEST)
   - the engineer report chase starts (existing rule; R48 sentence; needs Justin's approval to auto-send)
   - the email is filed in Communications and the history
   - "Mark as instructed by phone" stays as a fallback, with a note
7. **Settings → Engineers:**
   - default engineer
   - extra CC addresses
   - Audatex estimator (staff drop-down)
8. **Questions file:** add question 31, "Who prepares Audatex estimates, and should anyone else be copied in on engineer instructions?" Default: the handler prepares the estimate and is the only CC.
9. **Test on a TEST file:**
   - Engineer: one click sends; the email has every item above, the PDF and photos; the handler is CC'd; the chase starts
   - Audatex: the task is created for the estimator
   - Both
   - a file with no vehicle location is blocked, with the link

**R66 — Steps 5 to 8: every action on the Steps page, no jumping between screens (Justin, 31 October 2026).**
Justin, on TEST-0042, total loss:
- **Step 6 figures:** he typed the step 6 figures (pre-accident value £10,000, category S, salvage £1,000). They saved: the history and Money show £9,000 claimed. But the step 6 line only says "Done · 31/10/2026", so he thought they'd gone.
- **Step 7 "Agree valuation"** opens `/details/assessed-damage`: a long page with a "Viewing pane / File screens" menu, engineer's notes, "Record step", "Correction" and the total-loss panel. Nothing on it is about the client agreeing.
- **Step 8 "Send valuation"** opens the general Messages page.
- **Each step's "details" link** goes to a different screen (Details, Messages, Documents, Assessed damage, Money).

Rule for steps 5–9: **each step is a card on the Steps page that does its job in place.** Fill in, one button, done. Its finished line says what happened, in figures. "Details" links are only for history and corrections.

**Step 5, Instruct:** as R65.

**Step 6, Engineer's report received.** The card asks for:
- the date received
- the report upload (PDF), filed as "Engineer's report"
- the outcome: Repairable, Total loss, or Not yet known
  - **Repairable:** the estimate (net, VAT, gross, checked to add up)
  - **Total loss:** pre-accident value, salvage category, salvage value, and "What CAS asks the insurer for" (the existing choice)
  - **Total loss, also:** "Any finance on the vehicle?" (No / Yes + lender)

The finished line shows the figures, for example "Total loss · £10,000 pre-accident · Cat S · salvage £1,000 · claiming £9,000 · report on file". "Change" makes a correction entry, as now.

**Step 7.**
- **Total loss: "Agree valuation with the client".** One button: "Send valuation to client". It produces Draft 8a from `docs/correspondence-templates/drafts/CAS-document-drafts-31oct2026.md`, with the report attached (on by default, can be unticked). It sends by email with a signing link, or offers on-screen or paper signing.
  - The client's answer (A accept and release, B accept and keep, C dispute) and the finance answer are recorded on the file when signed.
  - **A or B:** step 7 is done, and B sets the request to net of salvage.
  - **C:** step 7 shows "Client disputes valuation". It creates a task, attaches the client's reason or evidence, and stops step 8 until a handler resolves it.
- **Repairable: "Send report and estimate to the insurer"**, as R63's pack style: one button, the report attached.

**Step 8.**
- **Total loss: "Send valuation to the insurer".** One button produces Draft 8b, with the report and the client's signed acceptance attached, to the third-party insurer (or agent). It asks for the amount from step 6/7 and starts the chase (R48).
- **Repairable:** "Repair authorisation or payment agreed", as now, inline on the card.

**Rules for both:**
- **Drafts 8a and 8b** are "Waiting for Justin's approval" (R64 rules). Until approved, the button shows the preview and "Needs Justin's approval".
- **Changing outcome mid-claim** (repairable to total loss, or back) keeps the history and swaps the step 7–9 cards, as the step names already do.

**Step 9 and Money.** Step 9 "Payment received and salvage collected" works inline too:
- record the payment
- the salvage collection date
- **the actual salvage proceeds, if any.** Hire end per J5 (7 days after the qualifying payment, confirmed by a handler; a partial payment is flagged).

Money shows the same figures; nothing is entered twice.

**Test on a new total-loss TEST file as `sian`:** step 6 figures show on the line; 7 send → client signs A → done; 8 send → chase starts; 9 payment → hire end proposed. Also run:
- the client choosing C, which blocks 8
- repairable to total loss partway

**Not independently verified:** R30 automatic sending. Nothing is sent until Justin approves a chaser's wording (question 27); Settings → Automatic chasers now shows each chaser's full wording beside its switch (R46). Retest when he has.

## Fixed

- **R59** fixed in cdb9a03: every form in the CRM keeps what was typed when it comes back with a mistake. A form keeper in the app shell keeps a copy of the form when it is sent (in that browser tab only, used once, within ten minutes; never hidden fields, passwords, sign-in codes or bank details) and puts it back when the page returns with an error, whether the page calls it "error", "offerError", "stepError" or another name: text, amounts, dates, times, ticks, radio buttons and drop-downs. A chosen file cannot be put back by a browser, so the box says "Please choose the file again". Amounts are now checked before sending, so a wrong amount is listed with a missing time in one R56 box. Also fixed on the way: the payment form showed a refusal in a plain grey line (now red, "Not recorded: …", and checked before sending); a refused swap came back without its replacement car chosen; an offer could be dated after today. A journey (awkward case 12, plus case 11 for the client's own form) sends the new claim, client details, licence check, recovery, offer, payment, handover and swap forms each with one mistake and checks every other value is still there. Checked as `sian` on TEST-0044: the recovery with a missing time and a wrong amount listed both problems at once; fixing only those two and saving recorded it ("At the yard from 31/10/2026 15:30 · £515.00 + VAT").
- **R62** fixed in 98aba47: a licence number is checked when it is entered (client details, additional drivers, hire pack, licence check card). A GB number must be 16 characters in the GB format; TEST-0042's 11-character number is refused with "A GB licence number is 16 letters and numbers; this one has 11 …". Northern Ireland (8 digits) and foreign licences go through only with the new "Not a GB licence" tick and the issuing country. A GB number in the right format that does not match the surname (Mac is accepted as MC) or the date of birth (the month with or without the +5 for women) is kept and flagged: a warning on the details screen and on the licence check card, with a link to correct it, and a history entry when a check is recorded. The licence check itself is never blocked. Tests: a valid fictional number, a wrong-length one, a date-of-birth mismatch, Northern Ireland and foreign numbers. Checked as `sian` on TEST-0044: the 11-character number was refused, a number with the wrong date-of-birth digits was saved and flagged, and the licence check was recorded with the flag showing. TEST-0042 still holds its 11-character number for Justin to correct.
- **R60** fixed in c0f8b85: Hire / Fleet → "Complete fleet details" is one table of every car (type, gearbox, fuel, seats, colour, GTA group as drop-downs), each change saved at once, a tick when complete, and "Only cars with details missing". Suggestions show in grey with their source and are saved only when staff press Use: gearbox from the model name (AUTO, S-A, CVT, DSG, a final "A"), fuel and colour from the V5C import, GTA group from the Settings rules. Seats are never suggested: the V5C import read no seating capacity. The hire and swap screens show the chosen car's details read-only with "Fleet record wrong? Edit in Fleet"; only the group charged is editable. A car with details missing is greyed out ("details missing – complete in Fleet") and cannot be chosen; the link returns to the hire with the car chosen. Each change goes in the car's history with who and when; agreements already produced keep their wording. Checked as `sian` on the new TEST-0044: one suggestion used (YT18 VJL gearbox, from "AUTO") and one typed value (TEST car CAS 4), incomplete cars greyed out, CU20 FYT chosen with its details read-only and the group charged editable.
- **R56** fixed in 4e84bc3: on save, a red box at the top says "3 things to fix before saving" and lists each problem in plain words as a link that opens a folded section and goes to the box; each box is outlined with its message underneath; as each is fixed its line goes and the count drops ("2 left to fix"), with a Next problem → button; when none are left it says "All fixed – save now". The box takes focus so a screen reader announces it. Every form built on the shared form gets this (new claim, Details tab, client form, Hire Pack and the others); the new-claim form and the Details tab get every problem back from the server at once, and a refused new claim goes back to its draft with what was typed.
- **R57** fixed in 14eade4: only a Mobile box needs 07 or +447. Every other telephone box takes any UK number (01, 02, 03, 05, 07 or 08 with the right digits, or +44) or an international number starting +, with spaces and an extension ("ext 12"). Their hint reads "UK number, for example 01792 341069 or 07700 900123". A landline in a mobile box is refused with "… looks like a landline: put it under Telephone instead". Labels read Mobile or Telephone; the client's second number is Other telephone.
- **R48** fixed in 14f366d: every chaser (liability, engineer report, repair authorisation, each payment reminder, the combined email once per item, the liability chaser letter and the supplied payment chases, and the Read the wording preview) has one sentence near the top: when we first wrote (the request marked sent) and how many chasers have been sent or marked sent since, with the latest date. First chaser: "have not yet received a response", no count. A substantive reply restarts the count from the reply and the sentence says so. Left out when the first-request date is not on the file.
- **R50** fixed in 14f366d: the new-claim form follows the call: client, accident, vehicle and damage, third parties, then File set-up last. Liability is never suggested (a one-line summary of what happened sits above it); jurisdiction is suggested from the accident postcode or the client's (England & Wales only for an English or Welsh postcode; border districts and no postcode are Not yet known); roadworthiness from the R52 answers, with a reason needed to choose otherwise; the handler defaults to the person entering. Any of them can be Not yet known: the claim saves, the file shows File set-up incomplete as its next step, and chasers, the Storage & Recovery and hire agreements and fault or non-fault letters wait. The Details tab uses the same order with File set-up last.
- **R51** fixed in 14f366d: one fuel drop-down (Petrol, Diesel, Hybrid, Plug-in hybrid, Electric, LPG, Other with a box, Not known by default) for the client vehicle, fleet records, the car-details boxes, the Hire Pack and the Details tab; shown the same way on the agreement, the Hire Pack and the fleet list. Stored values were mapped once with a change-history note (petrol → Petrol, hybrid electric → Hybrid, unclear → Other with the old text); colours held in capitals were tidied (BLACK → Black). Gearbox reads Not known.
- **R52** fixed in 14f366d: a bird's-eye car drawing (original SVG) with front bumper, bonnet, windscreen, roof, rear window, boot, rear bumper, each side's wing, doors, rear quarter and wheel, plus underside and interior; sides labelled Driver side (offside) and Passenger side (nearside); a tapped zone turns CAS red and shows as a chip; All over; works by keyboard; marks on click only, so scrolling cannot mark it. Ten Is it safe to drive? questions (Yes, No, Not known); any Yes suggests Unroadworthy with the reasons. Stored as data on the Vehicle damage screen; shown on the Details tab and the client form; the engineer instruction prints a small copy and the list; the recovery record's not-driveable reason is filled from the Yes answers; the history records both.
- **R53** fixed in 14f366d: each third party's vehicle asks only registration (with the lookup), make, model, colour, Taxed? and MOT? (Yes, No, Not known, filled from the lookup). The MID check sits with the vehicle (the full askMID record for third party 1, the insurer named for 2 and 3); Use this insurer fills the insurer fields when pressed and only while none is entered. Stored third-party gearbox and fuel are kept and not shown.
- **R54** fixed in 14f366d: the new-claim draft is saved 1.5 seconds after any change, however it was made (typing, drop-downs, ticks, a picked insurer or agent, a lookup, the damage drawing); the form shows Saving…, then Saved with the time to the second, or Not saved – check your connection in red while it retries; leaving with unsaved changes asks first. The Details tab saves with its own button and does not autosave.
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

<details><summary>Reviewer's notes R56–R57 (31 October 2026)</summary>

**R56 — Errors: take staff to each problem in turn (Justin, 31 October 2026).**
Justin saved a new claim with deliberate mistakes, such as a missing email. The form took him to the first problem only, and he had to hunt for the rest.

Fix, on the new-claim form, the Details tab, the client form and every other long form:
- **List every problem at the top.** On save, show a red box at the top: "3 things to fix before saving", listing each problem in plain words as a link, for example "Client's email: enter an email address, or tick 'No email'". Clicking one jumps to the field and opens its section if it's folded.
- **Mark each field.** Each problem field gets a red message under it, with the field outlined.
- **Move on to the next problem.** Once a field is fixed, its message and its line in the top box clear straight away, and a "Next problem →" button jumps to the next one. The counter updates: "2 left".
- **Say when it's done.** When none are left, the box says "All fixed – save now".
- **Keep the draft.** Fixing errors never loses what's typed (see R54).
- **Make it accessible.** The top box gets focus on save so screen readers announce it, and the links work by keyboard.
- **Check the server agrees.** The server checks the same rules and returns all problems at once, not one at a time.

**R57 — Phone numbers: only mobile boxes need 07 (Justin, 31 October 2026).**
Third-party, insurer, agent, handler, recoverer and repairer numbers are usually landlines (01, 02, 03) or 0800/0845-type numbers. Only a box labelled **Mobile** should require 07 or +447.

Fix:
- **Every other phone box** accepts any UK number: 01, 02, 03, 05, 07 or 08, with the right number of digits, or +44, plus international numbers starting +. Allow spaces and an extension, for example "ext 214".
- **The hint under those boxes** says "UK number, for example 01792 341069 or 07700 900123". Never "a UK mobile starts 07".
- **Label boxes clearly:** "Mobile" for mobiles, "Telephone" for everything else.
- **The client's main number** is "Mobile" (it's used for WhatsApp), with "Other telephone" as now.
- **Test:** a third party with 01792 341069, an insurer with 0345 000 1234, an agent with "+44 29 2000 0000 ext 12". All must be accepted. A client mobile of 01792… must be refused, with a clear message.

</details>

<details><summary>Reviewer's notes R48 and R50–R54 (31 October 2026)</summary>

**R48 — Every chaser states when we first wrote and how often we've chased (Justin, 31 October 2026).**
Put one sentence near the top of every chaser:
- liability, engineer report, repair authorisation
- each payment chase
- the combined email, once per item

Example: "We first wrote to you on 03/11/2026 requesting repair authorisation and have chased on 4 occasions since, most recently on 12/11/2026."

Rules:
- **Fill everything from the file.** The first-request date is when the request was marked sent: the step 7 report sent, the initial letter, or the payment request. The count and the latest date come from the chasers actually sent or marked sent, never from scheduled ones.
- **Don't list every date.** The full list stays in the chronology.
- **First chaser:** "We wrote to you on 03/11/2026 requesting … and have not yet received a response." Use no count.
- **Missing first-request date:** leave the sentence out rather than guess.
- **Show it everywhere the wording appears:** in the "Read the wording" preview, so Justin sees it before approving, and in chasers prepared by hand.
- **Reset on a reply:** if a substantive reply restarts a chase, the next chaser counts from the date of that reply, and the sentence says so.
- **Tests:** first chaser, fourth chaser, and a chase restarted after a reply.

**R50 — New-claim form: decisions come last, after the facts (Justin, 31 October 2026).**
Justin, entering a real-style claim, reports the problem: right after the client and owner details, the form asks for file set-up (fault or non-fault, liability status, jurisdiction, roadworthiness, handler). Those can't be decided until the accident, the circumstances and the damage are known.

Reorder the new-claim form (and the client form where it overlaps) to follow the order of the phone call:
1. **Client, owner, driver**: as now.
2. **The accident**: date, time, location, circumstances, weather, police, witnesses, photos at the scene.
3. **The client's vehicle and damage.**
   - Registration and lookup, as now.
   - **Areas of damage** as tick boxes: front, rear, nearside, offside, roof, underside, interior, with nearside/offside front/rear where useful.
   - The damage description.
   - Simple roadworthiness questions: Can it be driven? Warning lights on? Lights, glass, tyres or wheels damaged? Leaking fluids? Is it where it was left safely?
4. **Third party and insurer**: as now, including the MID result.
5. **File set-up, last**, each item pre-filled as a suggestion that staff confirm or change:
   - **Fault / non-fault and liability status:** never decided automatically. Show a one-line summary of the circumstances above the choice. "Not yet known" is allowed.
   - **Jurisdiction:** suggested from the accident location or postcode. Allow "Not yet known"; default England & Wales only if the postcode is in England or Wales.
   - **Roadworthiness:** suggested from the step 3 answers, for example "Unroadworthy – warning lights and fluid leak". Allow "Not yet known".
   - **Handler:** defaults to the person entering the claim.

Rules:
- **Saving with gaps:** the claim can be saved, and reopened from New enquiries, with any of the file set-up items as "Not yet known". The file shows "File set-up incomplete" as its next step until they're decided. Nothing that depends on them starts until they're set: chasers, the recovery and storage agreements, and letters choosing fault or non-fault wording.
- **Keep what works:** keep all existing fields, checks and draft saving. This changes the order and adds the damage-area ticks and roadworthiness questions.
- **Same order in both places:** use the same order in the new-claim form and the "Details" tab.
- **Test:** enter a claim as `sian` in call order with liability "Not yet known", save, reopen, then complete the file set-up later.

**R51 — Fuel is a free-text box; make it a drop-down (Justin, 31 October 2026).**
On the new-claim form, the client's vehicle fuel (`veh_fuel`) and the third party's (`tp1_veh_fuel`, and the other third parties) are typed boxes. The fleet records are already inconsistent: "petrol", "Diesel", "hybrid electric".

Fix:
- **One drop-down list everywhere fuel is entered or shown:** client vehicle, third-party vehicles, fleet records, the swap and car-details boxes, the client form, and any list that shows fuel. The options are: Petrol, Diesel, Hybrid, Plug-in hybrid, Electric, LPG, Other (with a short box to say what), Not known.
- **Default "Not known".** Never guess. A registration lookup can fill it when it returns fuel, and staff can still change it.
- **Map existing values once,** with a note in the change history: petrol → Petrol, diesel → Diesel, hybrid electric → Hybrid. Anything unclear becomes Other, with the old text kept in the box.
- **Show it the same way** on the hire agreement, the Hire Pack, letters and the fleet list.
- **Gearbox:** the option reads "Unknown — do not guess". Change it to "Not known", to match.
- **Colour:** check whether the colour box needs the same treatment. Keep it as typed text, but tidy capitals per R23.

**R52 — Damage diagram and roadworthiness questions (Justin, 31 October 2026). This replaces the damage-area tick boxes and the roadworthiness questions in R50 step 3.**

Section 3 has only a description box. Replace the damage part with:

1. **A bird's-eye drawing of a car** (original SVG, nothing copied) that staff click or tap to mark the damaged areas.
   - The zones:
     - front bumper, bonnet, windscreen, roof, rear window, boot or tailgate, rear bumper
     - on each side, front wing, front door, rear door and rear quarter
     - the four wheels
     - underside and interior as separate buttons
   - Label the sides **"Driver side (offside)"** and **"Passenger side (nearside)"**. Staff say driver and passenger side; insurers and engineers say offside and nearside.
   - A selected zone turns CAS red and shows as a chip below the drawing, for example "Passenger side front door". Click again to remove it. An "All over" button selects everything. The zones also work by keyboard, for accessibility.
   - Big enough to tap on a phone. Use the same drawing in the client form, so clients can mark their own damage.
2. **A description box** underneath, as now, for example "nearside headlamp smashed".
3. **Is it safe to drive?** Answer each question Yes / No / Not known:
   - lights smashed or not working
   - loose or hanging parts
   - sharp or jagged edges
   - glass broken or cracked
   - tyre, wheel or suspension damage
   - warning lights on the dashboard
   - leaking fluids
   - airbags gone off
   - doors, bonnet or boot won't shut
   - steering pulls or it drives badly

Any "Yes" suggests **Unroadworthy** in File set-up (R50 step 5), with the reasons listed, for example "Unroadworthy – lights smashed, sharp edges". It's a suggestion only: staff confirm or change it, and record a reason if they change it.

Where it shows:
- the Details tab
- the engineer instruction, as a small printed copy of the diagram plus the list
- the recovery record: the "why not driveable" reason is filled in from the "Yes" answers and can be edited
- the chronology entry

Store the zones and answers as data, not as a picture, so they can be searched and reported on.

**Test:** on a phone-width screen, mark three zones and two "Yes" answers. Check File set-up suggests Unroadworthy with those reasons, the engineer instruction shows them, and nothing can be marked by accident when scrolling.

**R53 — Third-party vehicle: only what CAS needs (Justin, 31 October 2026).**
The new-claim form's third-party vehicle section asks for gearbox and fuel, which CAS doesn't need for the other vehicle.

For each third party (tp1, tp2, tp3), the vehicle section asks only for:
- **Registration**, with the lookup as now.
- **Make, model and colour.**
- **Taxed?** and **MOT?**: Yes, No or Not known, filled from the lookup when it returns them.
- **MID check**, the existing block: date checked, result, insurer name, policy number.
  - When the MID result names an insurer, offer "Use this insurer" to fill the third-party insurer fields. Staff confirm it.
  - It's never filled silently, and it never overwrites an insurer already entered.

Other rules:
- **Remove gearbox and fuel from the third-party section** on the new-claim form, the Details tab and the client form.
- **Keep any values already stored** on existing files. Don't show them in the form, and don't print them on letters.
- **R51's fuel drop-down** now applies only to the client's vehicle and the fleet.
- **Letters** continue to print the third-party vehicle as make, model and registration.

**R54 — Autosave misses values filled by picking a saved insurer (reviewer test, 31 October 2026).**
On a new claim, the reviewer typed the client's name and "Exam" in the third-party insurer box, then picked "Example Mutual Insurance" from the suggestions. The suggestion filled the name and the email. "Draft saved 31/10/2026 16:12" showed.

More than 30 seconds later, reopening the draft (`/claims/new?draft=draft_2de10804…`) still had the insurer as "Exam" and a blank email. The client name was kept. So anything filled by a suggestion (insurer, agent, address lookup, vehicle lookup), and possibly drop-downs and ticks, may not be saved until someone types again.

Fix:
- **Save the draft after every change,** whatever made it: typing, a drop-down, a tick, picking a suggestion, a lookup filling fields, the damage diagram (R52). Wait a second or two after the last change, then save.
- **Show the state clearly:** "Saving…" while it saves, then "Saved 16:12:45" with seconds, so staff can see it's caught up. If a save fails, show "Not saved – check your connection" in red and keep retrying.
- **Warn before leaving** the page if there are unsaved changes.
- **Tests:** pick a saved insurer, then a saved agent, use the address lookup, change a drop-down and tick a box. Close straight after the "Saved" time updates, reopen the draft, and check every value is there. Do the same on the Details tab, if it autosaves.
- **The insurer and agent suggestions themselves work** (name and email filled; policy number left blank). Keep them as they are.

</details>

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


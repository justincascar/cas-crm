# Claim journey audit

27 October 2026. Walked in the browser on this PC, signed in as Sian Evans for the office screens, Demo Driver for handover, and Demo Mechanic for the workshop. Nothing was sent. Email stayed on simulate. No storage end was confirmed. No existing money figure was changed.

The individual screens do work. A brand-new file cannot be saved, and the steps that already exist do not carry the file from one screen to the next. That is why a start-to-finish test feels as if nothing is working.

## What works

- Staff sign-in, and a steps page that reads the file. Opening a claim does not start hire, storage, or a charge.
- The banner on every signed-in page says simulated email will not be sent. The messages button is “Record outgoing email”. It was not pressed.
- On an existing file the ten steps are listed in the right order for a repairable non-fault claim, a total loss, and a fault claim. A step is Done only when the history has the event. A simulated or generated letter is not treated as sent.
- TEST-0013 still shows the two flags for you to correct. They were not rewritten. Recovery time: 09:00 is before the accident at 14:30. Inherited recovery charge: £195 was typed in a note. The £195 is not in the money table. The table still shows claimed £1,572.00, offered £0.00, received £0.00, outstanding £1,572.00.
- A driver sees only “My jobs today”. A mechanic sees only “My jobs today”. The workshop page on an existing job lists vehicle received, parts ordered, parts delayed, repairs started, and repairs complete. Those steps were not saved during this audit.
- A missing claim address shows the ordinary “404 / This page could not be found” page. Confirmed at `/claims/does-not-exist`. The navigation and the simulate banner still show.

## What does not join up

**A new claim cannot be created.** On New claim, Create claim stays on the same screen. The message is: “That does not look like a UK number. It should start with 0 or +44 and be the right length. Use Save anyway for an overseas number.” It is attached to “Skip other number”, whose value is the word “yes”, not a telephone number. Unticking the box did not clear it. The page kept a draft. No claim number was issued. The next demonstration reference was still TEST-0015.

**Hire is four jobs, and the steps button opens none of them.** Arrange hire opens a page that only says to choose pre-hire checks, the hire pack, handover, or hire money. Choosing the car is on Hire / Fleet, a different part of the menu. The hire pack does not fill the licence number, the daily rate, the dates, or the fuel from the file. The client’s car on TEST-0013 is shown as “Unknown Unknown CU63VLX”. Handover then asks hire car or customer’s vehicle, and which hire car. On TEST-0013 that list was empty because no car is allocated. The driver is chosen again, and is not taken from the person signed in.

**The licence check is a typed note.** There is a text link to the GOV.UK check page. The form asks for a check code, a date, categories, points and endorsements together, and an expiry date. It does not ask whether the licence is valid, does not ask for disqualifications on their own, and has no upload. The full licence number is not on this form. The notice on the page says the licence number already on the file is not this check. Who checked is stored as the person signed in. Sian has no override. The 21-day window is labelled a demonstration setting, not a DVLA ruling.

**Bank statements are counted on a different page.** The hire check is satisfied only by a bank account listed under Financial circumstances, or by a saved explanation that there is no bank account. The page says a file stored there is not labelled as a bank statement, so a file on its own does not count. There is no upload on the check itself. The explanation is long, and it sits next to the impecuniosity checklist, which is a different gate. Sian can record evidence and cannot set that approval.

**Choosing a car does not create a driver’s job.** My jobs today, signed in as Sian, says: “Choose the driver and the date yourself. Nothing here is assigned automatically.” TEST-0013 is not in the hire-booking list.

**A letter does not tick the step.** Send letter opens Messages. Generating or recording an email does not mark the step done unless a separate box, “Also record this as a dated step”, is ticked. Instruct engineer prepares a letter and stays disabled until an engineer is chosen. It is not sent by opening the page.

**The same fact is asked again.** Address, make, model, colour and gearbox had to be typed on the new-claim form because the lookups did not fill them. Licence number would be asked on client details and again, empty, on the hire pack. The car is chosen on the fleet screen and asked for again at handover.

**Fault files still show engineer warnings.** TEST-0004 is the fault demonstration file. Its steps correctly say there is no engineer and that a courtesy car is not credit hire. The warnings on the same page still include “Instruct the engineer” and “Request repair authorisation”.

**Total loss is not on the new-claim form.** It is a tick on Assessed damage. That screen was not reached on a new file, because the new file could not be saved.

## Simplified design

One rule for every step: it starts from the steps page, the screen is already filled from the file, the handler types only what is new, and saving ticks that step. Anything already known is not typed again.

Hidden behind a “?” or a details link: the long notices, the 21-day demonstration window, the 89-day pack note against the 88-day alerts, and the impecuniosity research wording. The step itself stays short.

These stay as they are. Opening a page changes nothing. A later save by someone else is refused and names who saved, and when. Email stays simulated unless you later switch it, and even then a person still records the send. Permissions are checked on the server. `approveSettlement`, `manageBankDetails`, `extendedWait` and `releaseWithoutExcess` stay on your staff row only. Nothing is invented: no signature, no insurer result, no licence result, no bank details.

**1. Basic details.** One screen: client, car, accident, fault or non-fault, driveable or not. Address and vehicle stay typed until a live lookup exists. The licence number is asked here, once. Save opens the steps page with step 1 ticked, and creates step 2.

**2. Recovery, if needed.** If the car is driveable, the step is “Not needed” with that reason already offered. If it is not, the screen shows the accident date and place already filled. The handler adds the recovery time, which cannot be before the accident, and the place if it differs. Saving ticks the step and, when a recovery is booked, puts a recovery job on the driver’s list for the date entered.

**3. Hire.** One screen from Arrange hire. It shows the licence check, the bank check, the cars that are free, the rate already on the file, and the client already on the file. The handler records the licence result, attaches the statement or records that there is no bank account, and picks the car once. Saving ticks the parts that are done, fills the hire pack, and creates the delivery job. Handover opens with that car, that driver, and the client’s name. It asks for mileage, fuel, photos, and a signature or a reason there is none. A courtesy car uses the same screen and is labelled “not credit hire”. No daily charge is raised to an insurer.

**4. Initial letter.** The letter is filled from the file: client, accident, vehicle, third-party insurer. The handler checks it and records it. That tick is the step. On simulate, the file says recorded, not sent. A fault claim does not show this letter. It shows “Notify the client’s own insurer” and a box for their claim number.

**5. Engineer and/or Audatex.** The handler picks engineer, Audatex, or both. Audatex figures are typed. There is no Audatex link. A fault claim offers Audatex only, to the client’s own insurer, and does not offer an engineer. Saving ticks the step and starts the chase for the report.

**6. Report or estimate received.** The steps page already has this form. Saving the date and who it came from ticks the step. A file that is only marked “report received”, with no date, stays “Cannot tell from the history”, as TEST-0009 does today.

**7. Send the report or estimate.** The document already on the file is the attachment. Recording the send ticks the step. A simulated or generated copy does not count as sent, which is already the rule.

**8. Repair authorisation or payment agreed.** The handler records the authorised figure and the date. A figure below the claimed figure needs `approveSettlement` (your staff row). Saving ticks the step. It does not add claimed and agreed together, and it does not treat an offer as a receipt.

**9. Repairs, return, hire and storage end.** The mechanic’s list is the same five workshop steps, opened from the job. When repairs are complete and the client’s car is back, the handler confirms the hire end and the storage end on that same step. Hire on a repairable file ends only after both of those. Storage ends on the date entered. There is no grace period. A total-loss file uses the valuation steps below instead of this repair ending.

**10. Chase until paid.** Each head (repairs, recovery, storage, hire) shows claimed, offered, agreed, received, and outstanding, already calculated. The handler records a request or a receipt. The chase starts from the step. Hire and storage stay “Not ready” until the end date from step 9 is confirmed.

**Total loss, in place of steps 8 to 10.** Agree the valuation with the client on Assessed damage (the figure is typed, not invented). Send that figure to the insurer. Record payment received, then salvage collected. The off-hire countdown starts only after a handler-confirmed qualifying payment, then seven days. That rule stays.

**Fault, courtesy car.** Same steps 1 to 3, with courtesy labelled as not credit hire. Then: own-insurer claim number; Audatex estimate to that insurer; authorisation; repairs; excess paid; car returned; invoice for the authorised amount minus the excess. The car is not recorded as returned before the excess is on the file unless the save is by your staff row, using `releaseWithoutExcess` and a reason.

**Licence check, on the hire step.** A button opens the GOV.UK check page. A short form: valid, category, points, disqualifications, date, who checked. An upload sits on the same form. The licence number typed at step 1 is shown and is not asked again. The CRM does not call DVLA.

**Bank statements, on the hire step.** Upload the statement here, or record that there is no account. That is what satisfies the check. The long financial-circumstances page stays behind “?”, and an upload there counts as the same statement. Impecuniosity approval stays a separate gate, and stays off Sian’s account.

## Stage plan

Each stage is one job. It is finished only when a new journey test passes, together with `npm test`, `npm run typecheck` with zero errors, `npm run build`, and `npm run check:pages` with the database unchanged on open. There is no browser test harness in this project. The journey test calls the real route handlers, the same way the current tests do.

1. **A new claim can be saved.** “Skip other number” is no longer treated as a telephone number. Saving opens the steps page with step 1 done. You will be able to create Audit Repair, Audit Total Loss, and Audit Fault and see the right step list. The journey test creates a claim and reads those steps.

2. **Hire is one screen from the steps page.** The pack is filled from the file. Handover does not ask which car again. You will be able to leave the steps page, pick a car, and see that same car on the pack and the handover. The journey test does that on a new claim and does not send email or end storage.

3. **Licence and bank sit on that screen and count.** GOV.UK link, short result, upload, licence number reused. A statement uploaded on the check satisfies the check. You will be able to finish both checks without opening Financial circumstances. The journey test records both and sees the hire step move on.

4. **The driver’s job is created when the car is chosen.** You will see the delivery on My jobs today for the driver, without using Assign a job. The journey test checks that job exists and that opening the claim did not create it early.

5. **Letters, the report, and authorisation tick the step they belong to.** Simulate stays simulate, and a simulated copy still does not count as sent. You will be able to record the insurer letter and the report from the step, with one save. The journey test does that without a live send.

6. **The three endings, and a proper missing-claim page.** Repairable: repairs, return, hire end, storage end, then the chasers. Total loss: valuation, payment, salvage. Fault: excess before release, invoice minus excess, courtesy not credit hire. A bad address says “Claim not found”. You will be able to follow each ending to the last step. Three journey tests cover the three endings. Every safeguard above stays in force.

## The three walks

All three stopped before a claim number existed. Driver and mechanic were then opened on TEST-0003, an existing job, because there was no new file to hand over. Nothing was saved on that file.

| Walk | What was done | Where it stopped |
| --- | --- | --- |
| Audit Repair. Non-fault, undriveable, hire, repaired. | One New claim screen. Client, Cardiff address, car, accident 20/10/2026 14:30, recovery and hire ticked. Insurer name typed by hand. Create claim pressed once. | Stayed on New claim. “Skip other number” was rejected as a telephone number. Draft kept at 11:59 and 12:00 on 27/10/2026. No claim number. Hire, letters, engineer, workshop, and payments were not reached. |
| Audit Total Loss. Non-fault. | Not started as its own form. | Same Create claim block. Total loss is a tick on Assessed damage, which was never opened for a new file. |
| Audit Fault. Courtesy car. | Not started as its own form. | Same Create claim block. The courtesy-car step was never opened for a new file. |

TEST-0013, TEST-0004, and TEST-0009 were opened only to check the product. Their money, offers, and storage ends were left as they were. The next build should start with stage 1.

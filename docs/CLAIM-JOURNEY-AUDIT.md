# Claim journey — plain note

27 October 2026. Walked in the browser as Sian Evans, then as the demonstration driver and the demonstration mechanic. No live email was sent. Email stays on simulate.

The three files opened by hand for this walk are **TEST-0015 Audit Repair**, **TEST-0016 Audit Totalloss**, and **TEST-0017 Audit Fault**. The surname on TEST-0016 is stored as Totalloss because the form capitalises the name. They are demonstration files so the walk can be seen again. The automatic tests use a separate database and do not depend on these three.

## What works

Create claim now saves. On each of the three files the other-number box was ticked as “Skip other number”, an overseas mobile was typed, the warning appeared, Save anyway was ticked, and Create claim issued a number and opened the steps page with step 1 marked Done · 27/10/2026. Nothing was stored as the words “Skip other number”. The other number is blank. The overseas mobile is kept, because Save anyway was ticked.

Opening a page still changes nothing. A version clash still shows the existing clash message. A missing permission is still refused on the server. Outstanding does not go below £0. An offer is still not a receipt. Hire renewal warnings stay at day 70 and day 80, with a maximum of 88 days. Unsigned papers stay unsigned. Bank details missing still blocks a payment send. Wording that has not been approved still cannot be sent. `approveSettlement`, `manageBankDetails`, `extendedWait` and `releaseWithoutExcess` stay on Justin’s staff row only. The driver and the mechanic still cannot open the office or the money.

The driver sees only My jobs today. On TEST-0003 the job is “Vehicle handover”. The handover page asks for mileage, fuel, who did it, the time, and photographs. It was opened and not saved.

The mechanic sees only My jobs today. On TEST-0003 the job is “Repair evidence”. The workshop page lists vehicle received, parts ordered, parts delayed, repairs started, and repairs complete, plus a place for photographs and scans. It was opened and not saved.

The banner on every page still says no real email will be sent.

## What does not join up

**Hire is still four jobs, not one.** From the steps page, Arrange hire opens a menu: Pre-hire checks, Hire pack, Handover, Hire money, and Financial circumstances. Choosing the car is somewhere else again, under Details, as “Reserve hire vehicle”. That screen offers cars that are already reserved or on hire, and it asks for hold dates. It does not start charges, and it does not create a driver’s job. Delivery / collection is a further screen of typed dates. Those dates are notes. They do not create a job, and they do not set the chargeable hire end.

The hire pack does not fill itself. On TEST-0015 the client’s name comes through, then the delivery address is “Unknown, Unknown”, the home telephone has to be dealt with again, the driving licence number is empty, the daily rate is empty, and the recovery amount already on the file (£395 plus VAT, £474) is not copied into the pack. Generating the agreement is refused until a licence check and a bank account, or a no-bank explanation, are on the file. The pack also still shows the undecided point: the supplied pack talks about 89 days, and the CRM warnings use 88. That choice is still Justin’s.

The handover then asks which car again: Hire car or Customer’s vehicle, and what is happening. On a file with no hire car it can only offer the customer’s own car. On TEST-0003, where a hire car is already on the file, the driver’s form still starts by asking Hire car or Customer’s vehicle.

**No delivery job is created when a car is chosen.** My jobs today says, in plain words, that nothing is assigned automatically. TEST-0015, TEST-0016 and TEST-0017 do not appear on the driver’s list.

**The licence check is a typed note.** Pre-hire checks has a text link to gov.uk/check-driving-licence, then boxes for a check code, the date, categories, points, and expiry. There is no button that opens the check, no short result form, and no upload on that check. The full licence number is not asked there. It is asked again on Client details and again on the hire pack. The CRM does not call DVLA. That is correct for now. The integration is not built.

**Bank statements do not sit on the check.** The pre-hire check says the check is satisfied by a bank account listed on Financial circumstances, or by a saved explanation that the client has no bank account. The evidence checklist is a separate status. Uploading a file on Financial circumstances does not change that checklist, and there is no upload on the check itself. The page says so, but it takes two screens to see why a file on the disk has not satisfied the check.

**Letters do not move the step on their own.** Preview of the non-fault initial letter on TEST-0015 worked, and missing facts are marked “[not yet on file]”. Generating a letter files it. It does not send it. The step is only recorded if a separate tick, “Also record this as a dated step”, is used. There is no email template for the third-party insurer on that screen. The payment chases are prepared elsewhere, and nothing is sent until Send is pressed. Send was not pressed.

**The same facts are typed again.** Address, telephone, licence number, insurer, registration, and the recovery figure are asked on the new claim and then again on the later screens. A blank address is stored as “Unknown” and postcode “UNKNOWN”, and step 1 then says “1 detail missing”.

**A fault file still talks about an engineer.** TEST-0004’s steps correctly say there is no engineer on a fault claim, and step 5 is the Audatex estimate to the client’s own insurer. The problems list on the same page still says “Instruct the engineer” and “Request repair authorisation”. It also still chases a driving licence, a logbook, and bank statements, which belong to credit hire, not a courtesy car.

**Total loss is not on the new-claim form.** It is a tick on Assessed damage: “Ticking this marks the file as a total loss. It does not set claimed, offered, agreed or received.” Ticking it on TEST-0016 switched the steps to the total-loss list. The valuation boxes are notes. They do not change the money.

**A wrong claim address is a bare 404.** Opening `/claims/does-not-exist` shows “404” and “This page could not be found.” It does not say “Claim not found”. That is recorded for a later stage. It was not changed in this job. A 404 page is not a form.

**TEST-0013 is still flagged, and was not rewritten.** The two flags are still open: “Inherited recovery charge needs review: £195 was typed in a note” and “Recovery time needs review: 09:00 is before the accident at 14:30”.

**Recovery money appears before the recovery step is done.** Ticking “Client needs recovery” on the new claim turns on the standard £395 fee. Saving the claim puts £474 (that fee plus VAT) on the file at once. Step 2 still says To do, because the recovery date has not been recorded. The outstanding figure is already £474. TEST-0017, with no recovery, shows £0.00, which is right for a courtesy car.

**Storage end on TEST-0005 was not confirmed.** The page still offers “Use this as the storage end date” and says nothing has been written yet. That button was not pressed. The stored end date is still empty. The charge panel also says “Confirmed 14/10/2026” while describing 10 days from 22/09/2026 to 01/10/2026. That word “Confirmed” is easy to misread. The summary on the file still says no storage charge is running.

**A few labels are in the wrong place.** On the recovery money screen and the storage money screen, the agreed box is labelled “Agreed repair invoice”. That is the agreed figure for that charge, not the repair invoice.

**The mechanic who opens the money address is sent back to My jobs today with no sentence explaining why.** The server does refuse it. The page does not say so.

## The ten steps

The steps already change with the kind of file. The design below is what they should feel like once they are one process. This job did not rebuild the screens. It records the design for the later stages.

### Non-fault, the car can be repaired

1. **Basic details.** One form. Name, address, one mobile, accident, car, and whether a replacement is needed. Skip means there is no other number. A bad number warns and offers Save anyway. Create claim issues the number and this step is Done.
2. **Recovery, only if the car cannot be driven.** The fee, the date, and where it went, once. The standard fee is offered, not silently added before the step is done.
3. **Hire, as one job.** Checks, choose a free car, pack filled from the file, handover of that car, and the driver’s delivery job created when the car is chosen. Courtesy is not this step.
4. **Initial letter to the third-party insurer.** Built from the file. Filing it marks the step. It is not sent until someone presses Send, and unapproved wording cannot be sent.
5. **Engineer, Audatex, or both.** A choice on the step. Figures typed on the file. No link to Audatex until one exists.
6. **Report or estimate received.** Done only when each chosen item is on the file.
7. **Send that report to the third-party insurer.** The send, or the recorded send, marks the step.
8. **Repair authorisation, or payment agreed.** The insurer’s answer, dated.
9. **Repairs done and the client’s car returned.** The workshop steps feed this. Hire does not end until the repaired car is back.
10. **Payments.** Each head on its own. Outstanding never below £0. Overpayments listed separately. Nothing is requested while bank details are missing.

### Non-fault, total loss

Steps 1 to 4 stay the same. From step 5 the file follows the valuation, not the repair:

5. Instruct the engineer.
6. Engineer’s report received.
7. Agree the valuation with the client. The figures are the valuation, not a repair invoice.
8. Send the valuation to the insurer.
9. Payment received and salvage collected. The 7-day real-day gap still starts only after a handler-confirmed qualifying payment.
10. Payments, including vehicle damage, recovery, storage, and hire. Storage still ends only when someone confirms the end date. Hire still ends only when that end is confirmed.

Total loss stays a deliberate tick after the assessment. It is not guessed on the new-claim form.

### Fault, with a courtesy car

1. Basic details, with Fault and Roadworthy when that is actually known.
2. Recovery only if the car cannot be driven. A roadworthy car skips this.
3. **Courtesy car.** Not credit hire. No daily charge to an insurer. No licence-and-bank chase that belongs to credit hire.
4. Notify the client’s own insurer, and record their claim number.
5. Send the Audatex estimate to that insurer. There is no engineer on a fault claim, and the problems list must not ask for one.
6. Authorisation received via Audatex.
7. Repairs done.
8. Excess paid by the client.
9. Car returned to the client. Not before the excess is recorded as paid, unless Justin’s staff row uses `releaseWithoutExcess` and gives a reason.
10. Invoice the client’s own insurer for the authorised amount minus the excess.

## The stage plan

Five stages. Each later stage extends the same three journeys one step further: non-fault repairable, non-fault total loss, and fault with a courtesy car. A stage is not finished until that journey test passes and the full finish routine passes: `npm test`, `npm run typecheck` with zero errors, `npm run build`, `npm run check:pages` with the database unchanged on open, and `npm run test:journeys`.

**Stage 1 — this job.** Create claim works. Skip other number is not a telephone. A refused save says what is wrong and where. The journey test fills the form, ticks Skip other number, accepts the telephone warning with Save anyway, presses Create claim, and checks that a number is issued and step 1 is Done. It stops there.

**Stage 2 — one hire.** Checks, the car, the pack and the handover become one path. The pack fills from the file. The handover uses the car already chosen. Choosing the car creates the driver’s delivery job. The journey test continues until a car is chosen and that job exists.

**Stage 3 — licence and bank.** A GOV.UK button, a short result, an upload, and the full licence number asked once and reused. A bank-statement upload counts toward the check, with one clear sentence. The journey test continues through those checks. No live DVLA or bank connection is built.

**Stage 4 — letters and the engineer.** The letter marks its step from the file. A fault file stops warning about an engineer. A total loss, once ticked, keeps the valuation steps. The journey test continues through that next step on each of the three files.

**Stage 5 — money and the loose ends.** Payment requests stay blocked when bank details are missing and when the wording is not approved. Storage end stays a button someone has to press. A wrong claim address says “Claim not found”. TEST-0013’s two flags stay until a person clears them. The journey test continues until a safeguard stops it, and the test records that stop. It does not break the safeguard.

## How to run the journey test

From this folder, after `npm run build`:

```
npm run test:journeys
```

That opens the real screens in a browser, signed in as the office user. It uses its own database. It does not use the demonstration database, it does not confirm a storage end, and it does not send email. Later stages extend `tests/journeys/claim-journeys.ts` and `scripts/journey-check.ts`. `npm test` stays the existing checks. The finish routine runs both.

## Left alone

TEST-0005’s storage end was not confirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. TEST-0013’s two flags were not rewritten. No application change was made beyond the Create claim fix, the save messages, the journey test, and these notes.

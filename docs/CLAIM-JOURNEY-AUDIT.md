# Claim journey — plain note

27 October 2026. Walked in the browser as Sian Evans, then as the demonstration driver and the demonstration mechanic. No live email was sent. Email stays on simulate.

The three files opened by hand for this walk are **TEST-0015 Audit Repair**, **TEST-0016 Audit Totalloss**, and **TEST-0017 Audit Fault**. The surname on TEST-0016 is stored as Totalloss because the form capitalises the name. They are demonstration files so the walk can be seen again. The automatic tests use a separate database and do not depend on these three.

## What works

Create claim now saves. On each of the three files the other-number box was ticked as “Skip other number”, an overseas mobile was typed, the warning appeared, Save anyway was ticked, and Create claim issued a number and opened the steps page with step 1 marked Done · 27/10/2026. Nothing was stored as the words “Skip other number”. The other number is blank. The overseas mobile is kept, because Save anyway was ticked.

Opening a page still changes nothing. A version clash still shows the existing clash message. A missing permission is still refused on the server. Outstanding does not go below £0. An offer is still not a receipt. Hire renewal alerts start on day 80 and are overdue on day 88. The agreement itself is 89 days. That was confirmed on 27 October 2026. Unsigned papers stay unsigned. Bank details missing still blocks a payment send. Wording that has not been approved still cannot be sent. `approveSettlement`, `manageBankDetails`, `extendedWait` and `releaseWithoutExcess` stay on Justin’s staff row only. The driver and the mechanic still cannot open the office or the money.

The driver sees only My jobs today. On TEST-0003 the job is “Vehicle handover”. The handover page asks for mileage, fuel, who did it, the time, and photographs. It was opened and not saved.

The mechanic sees only My jobs today. On TEST-0003 the job is “Repair evidence”. The workshop page lists vehicle received, parts ordered, parts delayed, repairs started, and repairs complete, plus a place for photographs and scans. It was opened and not saved.

The banner on every page still says no real email will be sent.

## What does not join up

**Hire is one path on the Hire tab.** After Yes, all five steps stay on the page: Hire needed, Choose a car, Pre-hire checks, Hire pack & agreement, Handover. A step that is not ready yet says what it is waiting for. Choosing a car and drafting the pack are not blocked by the checks. The checks block producing the agreement for signature, and completing the handover. Old addresses for the pack, the checks, reserve, and delivery notes open the right place on that tab. Hire money and financial circumstances stay on their own pages.

A reservation does not start hire or any charge. Hire starts when the handover is completed, on that date. Only a free car is offered. The same calendar day counts as an overlap. If two people take the same car, the second is told which file booked it. Choosing a car for delivery creates one job for the driver login. The client collecting the car does not. A collection job can be arranged at the end. It does not, by itself, end the hire charge. A repairable hire still ends when a handler confirms the hire car is back. A total-loss hire still ends seven days after the qualifying payment, with handler confirmation.

The pack is filled from the file. The full licence number is taken from the client record and is not typed again on the pack. Missing details are listed, each with a link. If something is missing the pack is still saved as a draft. E-signature is not set up. The pack is printed, signed, and the signed copy uploaded. The existing CAS wording is used. Nothing new was written into the contract.

A fault file uses the same choose-a-car and handover steps for a courtesy car. It does not create a hire agreement or a hire pack, and it does not say credit hire. There is no daily charge to an insurer.

The agreement is 89 days. Alerts start on day 80 and are overdue on day 88. That margin is deliberate. It was confirmed on 27 October 2026. It is not still to be decided. A renewal or a swap does not restart the day count, and it does not change when hire charges end. The rate is the Settings rate at the time the car is chosen. Changing Settings later does not change a hire already booked.

**The licence check and the bank statements are on the Hire tab.** Known issues 24 and 25 were closed on 28 October 2026. Each driver has a card: the licence number from the file, a link to the current GOV.UK check page, a short result, and an upload. The CRM does not call DVLA. The licence number already on the file is not this check. A non-fault file also asks for bank statements, or a ticked explanation that the client has no bank account. That is the same record as Financial circumstances. A fault courtesy file asks for the licence check only. A check older than the Settings window (default 21 days, which needs Justin's confirmation) blocks the agreement and the handover.

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

**Stage 2 — done on 27 October 2026.** One Hire tab: needed, choose a car, pack, handover, then on hire. The pack fills from the file. The handover uses the car already chosen. Choosing a car for delivery creates the driver’s job. The journey test covers a free car, a clash, “not yet”, and a courtesy car with no hire agreement.

**Stage 3 — licence and bank, done on 28 October 2026.** The Hire tab has a GOV.UK link, a short result, and an upload. The licence number is asked once on the client or driver record and reused. A bank-statement upload counts toward the check, or the client is recorded as having no bank account. The checks block the agreement and the handover, not the car or the draft pack. No live DVLA or bank connection is built. The CRM does not call DVLA. Known issues 24 and 25 are closed.

**Stage 3b — hire fixes, done on 28 October 2026.** Only free cars are offered. The daily rate is stored at reservation. The agreement needs every mandatory item. Handover needs the signed copy on credit hire. Status wording follows the steps. Office staff have a Driver jobs list. See `docs/progress.md`.

**Stage 4 — letters and the engineer.** The letter marks its step from the file. A fault file stops warning about an engineer. A total loss, once ticked, keeps the valuation steps. The journey test continues through that next step on each of the three files.

**Stage 5 — money and the loose ends.** Payment requests stay blocked when bank details are missing and when the wording is not approved. Storage end stays a button someone has to press. A wrong claim address says “Claim not found”. TEST-0013’s two flags stay until a person clears them. The journey test continues until a safeguard stops it, and the test records that stop. It does not break the safeguard.

## Known issues

24. **Closed 28 October 2026.** The licence check is a GOV.UK link, a short result, and an upload on the Hire tab. The CRM does not call DVLA. The licence number already on the file is not this check.
25. **Closed 28 October 2026.** Bank statements sit on the Hire tab and on Financial circumstances, as the same stored file. An upload counts. So does a ticked explanation that the client has no bank account. A listed bank account still counts. A fault courtesy file does not ask for them.
26. **Closed 27 October 2026.** Hire was split across several screens. It is now one Hire tab.
27. **Closed 27 October 2026.** Choosing a car did not create a driver job. A delivery now creates one job for the driver login. Client collection does not.
28. **Closed 28 October 2026.** Cars already out were offered on Choose a car. One availability rule now covers every place, and disagreements go on Fleet records to check.
29. **Closed 28 October 2026.** An agreement was produced with no licence number and no daily rate. The rate is stored at reservation and the agreement is refused until every mandatory item is on the file.
30. **Closed 28 October 2026.** A licence check saved without a licence number. The card now asks for it and refuses OK to drive without it.
31. **Closed 28 October 2026.** Handover did not need the signed agreement. It now does on credit hire, with an authorised override.
32. **Closed 28 October 2026.** The header note and claims-list position kept intake wording. Both now follow the steps.
33. **Closed 28 October 2026.** Office staff had no list of driver jobs. Driver jobs lists them, and the driver is chosen at reservation.
34. **Closed 28 October 2026 (decision).** CAS's real V5C cars stay visible on TEST files, in the "Details missing – check before offering" group. Justin decided this.
35. **Open.** TEST-0015's earlier licence check was saved without a licence number. It is kept as history. A new agreement would ask for the number.
36. **Closed 28 October 2026 (J2).** E-signing, two routes, for the credit-hire agreement: (a) a one-time signing link sent by email (simulated until CAS's mailbox is live; WhatsApp to follow); (b) the client signs on the driver's phone at the doorstep, or on an office screen. Either route satisfies the handover rule. Each signature records who signed, when, the agreement version and a fingerprint of its text, the device and network address, and the witness for a doorstep signature. The signed PDF is filed as Signed hire agreement. The signed paper copy upload still works.
42. **Closed 28 October 2026 (J3).** Recovery money appeared before step 2 was done. The new-claim form no longer charges without a recovery date and time, and step 2's Record the recovery form offers the standard fee to confirm, the extras and the typed amounts. Storage starts on arrival at the yard.
43. **Closed 28 October 2026 (J3).** The recovery and storage money screens labelled the agreed box "Agreed repair invoice". They now name their own charge.
44. **Closed 28 October 2026 (J3).** TEST-0005's storage page said "Confirmed 14/10/2026" in the day-count note. That note is now a plain example.
39. **Open.** An agreement that is produced again after it was signed does not need a fresh signature for the handover. The earlier signature still counts. A later job may require the latest version to be signed.
40. **Open.** WhatsApp for the signing link. Email only for now (J9 covers WhatsApp Business).
41. **Open.** The driver's doorstep signing was checked by tests and on a phone-sized screen, but not end to end as the driver in the browser pane, because the pane cannot take the handover photographs.
37. **Open.** Courtesy-car agreement. Justin will supply an approved template. Fault files have no agreement until then.
38. **Closed 29 October 2026.** The Settings "Environment" panel listed old agreement figures from stored rows. It now shows the same figures as the agreement day limits form above it.
45. **Fixed (R13).** Recording step 7 (report sent to the third-party insurer) now starts the 3-day chase, worded for repair payment, the total-loss payment or the insurer's decision, and asks the handler to set the outcome when it is not on the file.
46. **Closed 28 October 2026 (J8).** On a fault file, Messages offered the engineer instruction and the impecuniosity disclosure response. The impecuniosity response has its own approval and cannot be produced without it. Left for J8.
47. **Open.** The initial insurer email shows Unknown for a missing field in the email text, where the letter shows [not yet on file]. The missing fields are listed above the email. Left for J8.
48. **Open.** The hire end and storage end confirmations on step 9 were checked by the tests and the journey check on a file with hire and storage, but not by hand in the browser pane. The new file walked by hand (TEST-0022) had no hire or storage.
49. **Open.** If a storage end already on the file matches the proposed one but was never confirmed, step 9 offers no Confirm storage end button and waits. Use the storage screen, or mark the part not needed with a reason.
50. **Open.** Some demonstration ledger lines do not add up: TEST-0001 recovery shows 1 job at £474.00 against a net of £395.00, and TEST-0003 storage has a claimed figure equal to its net, not its gross. These are seed figures. The Financials list now shows them side by side. Not changed in J6.
51. **Open.** No demonstration file has a payment request recorded as sent, so every aged-debt row on the demonstration data is Not requested yet. The age bands are covered by tests.
52. **Open.** Older demonstration files that already have recovery or storage charges were set up before the Storage & Recovery Agreement had to be signed. They have no signed agreement, so a new recovery or storage payment request on them is refused until one is signed or uploaded. Requests already on the file are not changed (R17).
53. **Fixed (J11).** A save on a details screen came back without its message: the old screen address redirected to the tab and dropped ?clash, ?saved and ?error, so a second person saving the same claim saw nothing. The message is now carried to the tab.
54. **Fixed (J11).** "Log agreement renewed" marked the new agreement signed, dated on the start date typed in. A logged renewal is now unsigned until the signed renewal is uploaded on the Hire tab, dated the upload.
55. **Fixed (J11).** The day-80 renewal alert for a new hire only appeared after the CRM was restarted. It now starts when the first signed agreement is recorded.
56. **Fixed (J11).** A reply to a liability or repair-authorisation chase was ignored. It now pauses the chase (decision, offer or dispute), changes nothing (acknowledgement or out-of-office), or goes to the handler as a task (unclear). An out-of-office never pauses a chase, even when it quotes our email.
57. **Fixed (J11).** A repairable file changed to a total loss kept its repair chase running and gave no reason for the repair steps disappearing. The repair steps are now closed with a reason on the history, and the repair chases stop.
58. **Fixed (J11).** A part-paid total loss was chased only as the original payment. The shortfall is now chased separately, with any disputed amount named, and starts even if the total-loss notice was not recorded.
59. **Fixed (J11).** One payment covering several heads could only be put on one head. The Money tab now splits it by head first; the parts must add up and none can be more than its head's balance. An overpayment on one head was refused outright; it can now be recorded after a confirmation, shown as overpaid on that head and never set against another.
60. **Fixed (J14).** There was no client form: only an empty status column. Staff can now send a secure link from the Documents tab. The client fills it in on a phone with no CAS login, saves and comes back, adds photos and papers, and sends it. They only ever see what they entered. Nothing changes the claim until staff tick the answers to apply or accept each upload.
61. **Fixed (J14).** The server buffered at most 10 MB of each request, below the 12 MB upload limit, so a large photo or PDF would have been cut short. The limit is now 13 MB.
62. **Fixed (R23).** Long typed boxes (for example "What happened") were put into capitals at the start of every word, like names. They now keep what was typed.
63. **Fixed (R26).** Swapping the hire car changed the car straight away with no new agreement. It now needs a new signed hire agreement for the replacement car (or Justin's override), records both cars' readings, keeps one continuous hire, and moves the renewal alerts to the new agreement.
64. **Fixed (R24).** Any second member of staff could verify a court date. Only Justin or the recorded instructed solicitor can now.
65. **Fixed (R25).** The card fee was worked out on the net. It is now on the gross amount paid, with the basis shown on every invoice line.

## How to try hire on a demonstration file

Use a fictional file. Do not confirm TEST-0005’s storage end. Do not change TEST-0009’s vehicle-damage offers, TEST-0006’s money, or TEST-0007’s £800.

Use a non-fault file that is not already on hire, and that does not already have the checks done. Do not use TEST-0005, TEST-0006, TEST-0007 or TEST-0009. If TEST-0001 already shows a licence-check override, use a different file.

1. Open the Hire tab. Choose Yes and save. All five steps stay on the page. The page moves to Choose a car. Nothing is in red yet. A line says what is still needed.
2. Choose a free car, delivery, a date and a time. Save. The car is reserved. Hire charges have not started. The checks can still be waiting.
3. Press Produce agreement for signature before the checks. The page names what is missing, each with a link. It does not file an agreement.
4. On the licence card, open the GOV.UK link if you want to see the public page. The CRM does not call DVLA. Enter today’s date, OK to drive, the categories, penalty points, and an expiry. Upload a screenshot or PDF. Save. The file is labelled Licence check, the person’s name, and the date.
5. Upload a bank statement. It is labelled Bank statement, the client’s name, and the date. The same file is on Financial circumstances. Or tick Client has no bank account and write a short explanation. That also completes the check.
6. Press Produce agreement for signature again. The agreement is filed unsigned. E-signature is not set up. Print, sign and upload. The wording is the existing CAS template.
7. Complete the handover. Hire starts on that date. Step 3 is Done. The dashboard “On hire / courtesy” count has gone up by one.
8. On a fault file, the Hire tab asks for the licence check only. There is no bank-statement step and no credit-hire agreement. Complete the licence check, choose a courtesy car, and complete the handover.
9. Sign in as the driver. Bank statements are not on My jobs today. Opening the file address `/documents/{id}/file` directly is refused. The same refusal applies to the mechanic.

## How to run the journey test

From this folder, after `npm run build`:

```
npm run test:journeys
```

That opens the real screens in a browser, signed in as the office user. It uses its own database. It does not use the demonstration database, it does not confirm a storage end, and it does not send email. Later stages extend `tests/journeys/claim-journeys.ts` and `scripts/journey-check.ts`. `npm test` stays the existing checks. The finish routine runs both.

## Left alone

TEST-0005’s storage end was not confirmed. TEST-0009’s vehicle-damage offers were not changed. TEST-0006’s money was not changed. TEST-0007’s £800 was not written off. TEST-0013’s two flags were not rewritten. No application change was made beyond the Create claim fix, the save messages, the journey test, and these notes.

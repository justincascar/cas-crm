# Questions for Justin

Each open question has a reversible default already in the CRM. Nothing here is guessed as final. Numbers are kept when a question is answered, so earlier references still match.

## Open

1. **Uplift % on the GTA rate.** Daily rate = the GTA figure for the group charged + an uplift %, kept in Settings. The uplift is 30% until you confirm the figure. Please confirm it.
2. **Check the GTA table in Settings.** The table in force (from 01/07/2026) is the supplied 2026–27 table that was already in the CRM. Please check its figures against the published GTA table. A new year's table is added in Settings with its own date; earlier hires keep their rate.
3. **Courtesy-car agreement.** You will supply an approved template later. Until then a fault courtesy car has no agreement.
5. **Recovery mileage.** Still undecided how mileage is charged. The mileage box stays off the new-claim form.
7. **Invoice template.** J6 asks for invoices from CAS templates. No CAS invoice template or invoice numbering has been supplied. Default: the Money tab produces a plain draft invoice per head from the figures on the file (quantity × rate, net, VAT, gross, received, balance), on CAS's headed paper, marked draft and not sent. The company number and VAT number are answered: they came with the headed paper and print in its footer (Settings → Company details). Please send the template and how invoices are numbered. The VAT treatment of the card fee stays with CAS's accountant.
10. **Recovery and storage terms the customer signs.** The wording comes from your supplied Hire Pack. The standalone Storage & Recovery Agreement is the Hire Pack's Storage & Recovery page, the relevant definitions and clauses from the same terms (definitions You, We, Parties, Your Own Vehicle, Accident, Third Party, Recovery, Storage Period, Storage & Recovery Charges, Total Charges, Engineer, Credit Period, Claim, Appointed Representative; clauses 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 2.17, 2.18, 4.1 to 4.6, 4.8, 4.10, 4.11, 4.12 and 5.1 to 5.8), and the Hire Pack's notice of the right to cancel. Nothing is reworded. A client with recovery or storage but no hire car signs it on screen or on paper before recovery or storage is claimed. Please check the selection of clauses, and send a newer Hire Pack only if one exists.
12. **Northern Ireland evidence.** Files now carry a jurisdiction (England & Wales, Scotland or Northern Ireland). A Northern Ireland file shows a short reminder that the court expects extra evidence and to check with you. Default: that reminder only. Please send the checklist of what a Northern Ireland file needs, so the reminder can list it.
18. **An overpayment.** When more than is outstanding arrives on a head, staff confirm it and it is recorded on that head, shown as overpaid, flagged for review, and never set against any other head. Default: a person decides whether to refund it or hold it. Is there a rule you want (for example, refund within so many days)?
20. **The client form.** Staff send the client a secure link by email from the claim's Documents tab (simulated in the prototype). It works for 30 days, and one link works at a time. The client gives their mobile, email, address, postcode, where the accident happened, what happened and the other driver's name, registration and insurer, and adds photos of the damage, their driving licence, insurance certificate and V5C. Default: those questions, 30 days, email only. Please say if you want other questions, a different length, or the link sent by text or WhatsApp once those are connected.
22. **Retention periods (for CAS's adviser).** Settings → Retention and deletion holds the defaults, each marked "awaiting adviser": enquiries that never became a claim 12 months; claim file 6 years after it closes; invoices and financial records 6 years after the end of the financial year; bank statements at claim close unless used in a dispute or litigation; licence checks follow the claim file; audit log 6 years. The financial year is taken to end in March. Nothing is deleted automatically: you approve each batch. Please confirm each period and the financial year end with the adviser.
23. **Privacy notice wording.** The client form and the welcome email show a "Privacy notice" link to a page that says the wording is awaited. While it is a placeholder the client form cannot be sent to a real client. Please supply the approved wording in the J9a review.
24. **Website enquiries.** The website's Start your claim form lands in the CRM as an enquiry marked "Needs a call". Defaults:
    - The CRM accepts enquiries only from the website address saved in Settings, and none until one is saved. Please confirm the website's address when it is hosted (J9).
    - One internet connection may send at most 8 an hour, and everyone together at most 120 an hour.
    - "Convert to claim" pre-fills liability as non-fault when the client says it was the other driver's fault, fault when they say it was theirs, and not yet decided when they are not sure. Can't be driven pre-fills unroadworthy and is flagged urgent.
    - Staff check every box with the client before saving.

    Please say if you want different limits, or a different rule for what is pre-filled.
25. **The website's GitHub repository.** Answered: Justin created the private `cas-website` repository under `justincascar` and gave the saved GitHub sign-in access on 31/10/2026. The website was pushed to `main` (853ba3a) and GitHub confirmed it.
26. **Website details still in [brackets].** The logo, the company number, the VAT number and the registered office (171 Cwmgarw Road, confirmed by Justin on 31/10/2026) are answered: they came with the headed paper and are on the website's header and footer. Please supply:
    - the three photos;
    - opening hours and recovery hours;
    - the areas you cover;
    - the MOT booking link;
    - real reviews and the Google rating, when you have them.

    The five gold stars beside the rating placeholder came with the mock-up. They should come off if there are no real reviews by launch. The complaints, privacy, cookies and terms wording is part of J9a.
27. **Approve the chaser wording for automatic sending.** The CRM now sends chasers on its own (simulated until the mailbox is connected), but only for the chasers whose wording you approve, one switch each in Settings → Automatic chasers (Justin only). All are off. Default: nothing is sent automatically; staff prepare and mark chasers by hand as before. Please read each chaser's wording (the liability response, engineer report, repair authorisation and each payment chase) and switch on the ones you approve. Chasers due to the same recipient on the same file go in one email listing each item.
28. **CAS's engineer.** The engineer seeded in the CRM (Andy Montgomery, Montgomery Assessors) looks like CAS's real engineer, so he is kept in Settings for live use only: he cannot be chosen on a TEST file and nothing is sent to him. TEST files use a fictional engineer. Default: as above. Please confirm he is CAS's engineer and that his details are right.
29. **Authenticator for all staff?** Only an administrator (Justin) must use an authenticator app to sign in. Sian, Tom, Megan and the driver and mechanic logins do not, though anyone can switch one on in Settings → Your sign-in. Default: as now (required for administrators, optional for everyone else). Please say whether every member of staff must use one before live use.
30. **QR code for the authenticator (R49).** Drawing the QR code needs a QR encoder, which the CRM does not have. Claude Code asked to install the widely used `qrcode` package from npm (version 1.5.4, MIT licence, about 135 KB plus three small packages), drawn on this PC with no outside service, and did not download it without your yes. The other way is for Claude Code to write the encoder itself; then please scan the code on your phone to check it. Default: until you choose, the page shows the key to type and the new warning line. Please say which.

## For your solicitor

These are flagged for legal review only. The CRM has not changed the supplied wording.

- **A new agreement on a vehicle swap.** On a vehicle swap a new agreement is signed. Under the terms this starts a new 89-day Rental Period and 51-week Credit Period. Please confirm that's acceptable and how it should be presented to insurers.
- **Hire Pack clause 5.3.** It cites the Consumer Credit (Exempt Agreements) Order 1989. The reviewer understands that Order was replaced in 2014, when consumer credit regulation moved to the FCA, so the citation may need updating. The same clause is in the hire agreement and the Storage & Recovery Agreement.
- **Doorstep signing and cancellation rights.** Clients can sign the hire agreement and the Storage & Recovery Agreement at their door or at the roadside, on CAS's screen or on paper. Please confirm that the supplied notice of the right to cancel (which cites the Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008) gives the client the cancellation rights they are entitled to, and what should happen when work starts inside the cancellation period.

## Answered (30 October 2026, afternoon)

- **What the card fee is worked out on (was question 16).** The gross amount being paid, VAT included, then VAT on the fee. Each invoice line says "Card fee 4.5% of £X". Fees recorded earlier keep their net basis and say so.
- **A swapped hire car (was question 17).** The client signs a complete new hire agreement for the replacement car, produced from the Hire Pack with the new car's details, mileage and fuel out and the date and time. The swap completes only when it is signed (on screen or a photographed paper copy), or on your override with a reason. It stays one continuous hire; the earlier agreement is kept, marked superseded. The renewal alerts follow the latest signed agreement; the Hire tab shows both counts. The Hire Pack has no box for the hire car's condition, so the old and new cars' condition is kept on the swap record and the history, not added to the agreement.
- **Who checks a court date (was question 19).** Only you, or the person you record as the instructed solicitor on that litigation file (their CRM sign-in). Everyone else can add a date and its source; it stays "needs verification".
- **Long text boxes (was question 21).** Only names, addresses, postcodes and registrations (and a vehicle's make, model and colour) are given capitals. Descriptions, notes, reasons, condition notes, letters and emails keep exactly what was typed, on staff screens and the client form.
- **VAT treatment of the card fee.** To be confirmed with CAS's accountant.

## Answered (30 October 2026)

- **VAT on the card fee (was question 13).** VAT is added to the card fee. The fee is only known when the invoice is paid, so it is added then: Paying by card on a recorded payment, or on a draft invoice prepared for payment, on any head of loss. The tick on the recovery forms is gone; a fee saved under it is kept with a history note.
- **Wording of the not-a-GTA-subscriber paragraph (was question 14).** Approved as written. It is no longer marked draft. Staff tick it on the rebuttal letters and the hire pack cover letter; off unless ticked.
- **Claiming recovery or storage before the agreement is signed (was question 15).** Only your authorised override, with a written reason kept on the file and shown in the history and the chronology.

## Answered (29 October 2026)

- **Card fee on recovery (was question 6).** Yes, as an optional tick on the Record the recovery form, off unless ticked. It is worked out on the ticked charges and shown as its own line. The percentage (4.5%) is in Settings. VAT on the fee is question 13.
- **Chaser sending hours (was question 8).** Confirmed: Monday to Friday, 09:00 to 17:00 UK time.
- **Repair authorisation chase (was question 9).** Yes. Recording step 7 (report or estimate sent to the insurer) starts the 3-day chase. It asks for repair payment on a repairable car, the total-loss payment (pre-accident value less salvage) on a total loss, or the insurer's decision when the outcome is not set, and then gives the handler a task to set the outcome.
- **Not a GTA subscriber (was question 11).** Confirmed: CAS is not a GTA subscriber. The optional paragraph is in; its wording waits for your approval (question 14). The daily rate stays the GTA figure for the group plus the uplift %, as CAS's own price list.

- **21-day licence window (was question 4).** Confirmed. A licence check older than 21 days blocks the hire agreement and the handover. The figure stays in Settings.

## Answered (28 October 2026)

- **Daily rates per group.** GTA rate for the group charged + an uplift %. The uplift stays a Settings value. GTA rates change each year, so the GTA table is kept in Settings with an effective date. The rate taken on each hire never changes. GTA figures are never invented.
- **Real CAS fleet on TEST files.** They stay visible, in the "Details missing – check before offering" group.
- **Signed agreement before handover.** Confirmed. A credit-hire handover needs a signed hire agreement on file. An authorised override with a reason is still allowed. The client may sign beforehand or on the doorstep at handover. For now the signed paper copy is photographed and uploaded, before or at handover. E-signing is the next job (known issue 36).

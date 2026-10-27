# Claim journey audit — technical appendix

27 October 2026. Companion to `docs/CLAIM-JOURNEY-AUDIT.md`. Observations are from the running app at `http://localhost:3000` unless a line says it comes from the code. No application source was changed for this audit.

Signed in as `sian` (office), then `driver`, then `mechanic`. Passwords are in `docs/AUTH-NOTES.md` and are not repeated here.

## Walk record

### New claim — stopped

Route: `/claims/new`. One screen (`IntakeForm`). Create claim is one button. It was pressed once. The page stayed on `/claims/new`.

The only invalid control was `client_skipOtherTel`. `isPhoneBoxName` in `src/lib/phone-number.ts` treats any name matching `mobile|telephone|phone|tel` as a telephone box, so this checkbox matches. Its value is `yes` even when it is cleared in the UI. `collectInvalidControls` sets that custom message, and `ValidatedForm` then does not submit. Unticking the box did not clear the message. Text shown: “That does not look like a UK number. It should start with 0 or +44 and be the right length. Use Save anyway for an overseas number.”

The form autosaved a draft at 27/10/2026 11:59 and again at 12:00. The heading still showed the next demonstration reference as TEST-0015 after the failed submit, so no claim row was created.

Typed because the lookups did not fill them: house and street (1 Audit Street, Cardiff, CF10 1EP), make Ford, model Focus, colour Blue, gearbox manual. Find address on CF10 1EP returned: “Postcode found. Type the house number and street — a house list is not available for this postcode.” The vehicle line stayed “Lookup not connected yet – please type the details”. Check tax and MOT returned “Simulated prototype result — not a live DVLA or MID enquiry”, with tax and MOT “Unknown — confirm on GOV.UK”. The MID block says it records a manual askMID check and does not look the vehicle up. The insurer name “Audit Insurer” was typed. It is not a lookup result.

Also on that screen: two headings numbered 6 (recovery, then third party). The replacement section appears only after its tick. The recovery section shows the standard recovery fee already ticked at £395 when the section is opened. That is the settings default on the form, not a figure entered during this walk. WhatsApp photo boxes were left unticked. Accident entered as 20/10/2026 14:30. Recovery entered as 20/10/2026 16:00, Cardiff. Hire needed from 20/10/2026, small car, manual.

Audit Total Loss and Audit Fault were not given their own forms. The same control blocks every new file.

### Screens opened on existing files

These were confirmation only. Nothing was saved, generated, or sent.

| What | Route | Signed in | Result |
| --- | --- | --- | --- |
| TEST-0013 steps | `/claims/claim_e6ee0ed9-2614-4586-87fd-390c1cab4219` | Sian | Steps 1 and 2 Done 19/10/2026. Hire “Not decided yet”. Letter, engineer, report, authorisation, repairs, payments not done. Flags for 09:00 before 14:30 and the inherited £195 note still showing. |
| TEST-0013 hire hub | `.../hire` | Sian | One sentence: choose pre-hire checks, the hire pack, handover, or hire money. No car picker. |
| TEST-0013 pre-hire | `.../prehire` redirects to `.../hire?section=checks` | Sian | Licence check already stored, recorded by Justin Roberts 27/10/2026 11:24. Not treated as a DVLA result. No upload. Bank check unmet. Link to Financial circumstances. No override form for this account. |
| TEST-0013 financial | `.../financial` renders inside `.../hire?section=financial` | Sian | Checklist Not started. Approval Not approved. Upload is tagged impecuniosity evidence and does not change the checklist. Sian cannot set the approval. Nothing added. |
| TEST-0013 hire pack | `.../hire-pack` | Sian | Name, date of birth, address, and phones pulled from the file. Licence number, rate, fuel, and dates empty. “Hire vehicle supplied: None allocated yet.” Client vehicle “Unknown Unknown CU63VLX”. Agreement blocked: no bank account and no no-bank explanation. Not generated. |
| TEST-0013 handover | `.../handover` | Sian | Asks hire car or customer’s vehicle. Hire-car list (`hireEpisodeId`) empty. Driver asked again. Not saved. |
| TEST-0013 messages | `.../messages` | Sian | “A click is not proof of delivery. Nothing is sent from claims@cascar.co.uk.” Button label “Record outgoing email”. Separate checkbox “Also record this as a dated step”. Not clicked. Existing 19/10/2026 items are prototype / simulated. |
| Missing claim | `/claims/does-not-exist` | Sian | Title “404: This page could not be found.” Headings “404” and “This page could not be found.” No `src/app/not-found.tsx`. |
| TEST-0004 steps | `/claims/c4` | Sian | Fault list. Courtesy car Done 18/09/2026, with the not-credit-hire sentence. Recovery not needed because roadworthy. Flags still include “Instruct the engineer” and “Request repair authorisation”. Not changed. |
| TEST-0009 steps | `/claims/c9` | Sian | Total-loss list. Hire “In progress 1 of 4”. Report step: “Cannot tell from the history. The file is marked report received, and there is no report-received event.” Offers and money not changed. |
| Jobs | `/jobs` | Sian | “Nothing here is assigned automatically.” TEST-0013 is not in the hire-booking list. Assign job was not pressed. |
| Driver jobs | `/jobs` | driver | TEST-0003, Volkswagen Golf CAS 2, vehicle handover, not done, assigned for 27/10/2026. Nav is My jobs today and Log out only. |
| Driver handover | `/claims/c3/handover?job=job_fd691ac1-f65b-4464-8769-5c7e3fd0be76` | driver | Full handover page. Vehicle still asks hire car or customer’s vehicle. Hire car shown as Volkswagen Golf CAS 2. Datetime box already contained 27/10/2026 12:03. Several older handovers already on the file, finished and unfinished, with different mileages. Not saved. |
| Mechanic jobs | `/jobs` | mechanic | TEST-0003, Volkswagen Golf SA12 CWA, repair evidence, not done, assigned for 27/10/2026. Same restricted nav. |
| Workshop | `/claims/c3/repair` | mechanic | Five step forms plus a correction and a file upload. Date boxes empty. Saved files: none yet. Record step was not pressed. |

Click and screen counts for the new-file journey: 1 screen, 1 Create claim click, 0 claims created. The later screens in the table were reached by opening existing demonstration files, not by finishing Audit Repair.

## Screen inventory

Reached from the steps page means the step button’s `buttonHref` in `src/lib/domain/claim-steps.ts`. “Opened” means this audit loaded it.

| Screen | Route | Purpose | From the steps page? | Opened |
| --- | --- | --- | --- | --- |
| Sign in | `/login` | Staff session | No | Yes |
| Dashboard | `/` | Today’s work | No | Yes, as Sian |
| Claims list | `/claims` | Find a file | No | Linked, not used as the walk |
| New claim | `/claims/new` | Capture the file | No. This is before a file exists | Yes |
| Steps | `/claims/[id]` | The ten steps, read from history | This is the page | Yes |
| Details hub | `/claims/[id]/details` | Older detail screens | Basic-details button when something is missing | Not as a hub |
| Detail screen | `/claims/[id]/details/[screen]` | One detail form, including assessed damage | Agree valuation → `details/assessed-damage` | Not on a new file |
| Old work address | `/claims/[id]/work/[screen]` | Previous detail address | Redirects into details, messages, history, or money | No |
| Hire hub | `/claims/[id]/hire` | Menu of hire sections | Arrange hire / Arrange courtesy car | Yes |
| Pre-hire | `/claims/[id]/prehire` | Licence and bank checks | Redirects to `hire?section=checks` | Yes |
| Hire pack | `/claims/[id]/hire-pack` | Agreement fields | From the hire hub, not from the step button | Yes |
| Handover | `/claims/[id]/handover` | Mileage, fuel, photos, signature | From the hire hub, or from a driver job | Yes |
| Financial circumstances | `/claims/[id]/financial` | Impecuniosity evidence | Redirects to `hire?section=financial` | Yes |
| Repair evidence | `/claims/[id]/repair` | Workshop steps | “Record workshop step”, and the repairable finish step | Yes, as mechanic, on TEST-0003 |
| Messages | `/claims/[id]/messages` | Letters, email, WhatsApp, calls | Letter, instruct engineer, send valuation, payments button, own-insurer notification | Yes, on TEST-0013 |
| Documents | `/claims/[id]/documents` | File documents | Send report | No |
| Document | `/documents` and `/documents/[id]` | Office document list | No | No |
| Money | `/claims/[id]/money` and `/money/[head]` | Figures by head | Payment details; total-loss finish → `money/vehicle` | No. The steps page already shows the summary table |
| Old money heads | `/claims/[id]/heads/...` | Previous money addresses | Count as the Money tab | No |
| History | `/claims/[id]/history` and `/history/print` | Chronology | History tab | No |
| Vehicles on the claim | `/claims/[id]/vehicles` | Vehicles already on the file | Counts as Details | No |
| Hire / Fleet | `/hire`, `/hire/new`, `/hire/[id]` | Reserve a fleet car | Not the claim hire tab. Choosing a car is here | Not opened. The jobs page lists existing bookings |
| My jobs today | `/jobs` | Driver and mechanic list, and manual assign | No | Yes |
| Tasks | `/tasks` | Task list | No | No |
| Communications | `/communications` | Office communications | No | No |
| Financials | `/financials` | Office money | No | No |
| Automations | `/automations` | Chasers and similar | No | No |
| Litigation | `/litigation` | Litigation list | No | No |
| Gaps | `/gaps` | Gap list | No | No |
| Settings | `/settings`, `/settings/staff`, `/settings/engineers` | Office settings | No | No |

Duplicates:

- `/prehire` and Hire → checks are the same screen.
- `/financial` and Hire → financial circumstances are the same screen.
- `/work/[screen]`, `/heads/[head]`, and the old comms and history addresses redirect into the seven tabs: Steps, Details, Hire, Money, Documents, Messages, History (`src/lib/domain/claim-tabs.ts`).
- Repair evidence is filed under the Documents tab, not under its own tab.
- The claim Hire tab does not reserve a car. Hire / Fleet does. Handover asks for the car again.
- Client details and the hire pack both have a licence-number field. The pre-hire notice says the number already on the file is not the licence check.

## Confirmed issues

| Issue | Where | What was seen |
| --- | --- | --- |
| New claim cannot be saved | `/claims/new`, control `client_skipOtherTel` | Create claim refused. Message quoted above. |
| Hire is not one process | Step button → `/claims/[id]/hire`. Car choice is `/hire`. Pack is `/hire-pack`. Handover is `/handover`. Progress is four flags: `prehireDone`, `vehicleChosen`, `agreementDone`, hire started (`claim-steps.ts`, hire step). | Hub has no car picker. Pack licence number and rate empty. Handover `hireEpisodeId` empty on TEST-0013. |
| Licence check is incomplete for the intended form | `hire?section=checks`. Link `https://www.gov.uk/check-driving-licence` (`GOV_LICENCE_CHECK_URL`). Notice `DVLA_MANUAL_NOTICE`. | Text link, not a button. Fields: check code, date, categories, points and endorsements combined, expiry. No valid yes/no, no separate disqualifications, no upload. Who checked is the signed-in user. Full number is not on this form. |
| Bank check is satisfied elsewhere | Same section. `BANK_REUSE_NOTICE`. | A listed account or a saved no-bank explanation on Financial circumstances counts. A file there does not, because it is not labelled as a bank statement. No upload on the check. Checklist Complete and impecuniosity approval are separate. Sian sees `NO_OVERRIDE_NOTICE`. Override needs `overridePreHireChecks`, not the administrator role. |
| No automatic delivery job | `/jobs`. `assignDayJob` is called from `src/app/jobs/assign/route.ts` and `src/app/job-actions.ts`. | Page text: “Nothing here is assigned automatically.” |
| Bare 404 | `/claims/does-not-exist`. `notFound()` from the claim page. No custom not-found page. | “404” and “This page could not be found.” |
| TEST-0013 data still flagged | Steps page for `claim_e6ee0ed9-2614-4586-87fd-390c1cab4219` | “Recovery time needs review: 09:00 is before the accident at 14:30.” “Inherited recovery charge needs review: £195 was typed in a note.” Money table does not contain £195. Claimed £1,572.00, offered £0.00, received £0.00, outstanding £1,572.00. Not rewritten. |
| Letter does not tick the step | `/claims/[id]/messages` | “Also record this as a dated step” is a separate checkbox. |
| Simulated send is not a send | `reportSendCounts` rejects simulated and generated. Messages banner. | On screen: a simulated item is not treated as sent. Button is “Record outgoing email”. |
| Fault file still warns about an engineer | `/claims/c4` | Steps say there is no engineer. Flags still say instruct the engineer and request repair authorisation. |
| Total loss is easy to miss | Assessed damage, `src/lib/claim-screens.ts` key `assessed-damage`. Saving `totalLoss` yes sets `claims.total_loss` (`src/lib/db/screens.ts`). | Not on `/claims/new`. Not reached on a new file. |
| Client vehicle label | Hire pack and handover on TEST-0013 | “Unknown Unknown CU63VLX”. |
| Driver handover still asks which kind of vehicle | `/claims/c3/handover` | Even when opened from a hire handover job that already names Volkswagen Golf CAS 2. |

The strings stored on TEST-0013’s existing licence check (check code, categories, points, expiry) were already on the file. They are not a DVLA result and are not copied here.

## Safeguards that must not regress

Seen on screen during this audit:

- Every signed-in page: “Simulated — no real email will be sent.”
- Messages: a click is not proof of delivery, and nothing is sent from claims@cascar.co.uk.
- Opening TEST-0013, TEST-0004, TEST-0009, the hire pages, handover, and repair did not mark a step done.
- Driver and mechanic navigation is My jobs today and Log out.
- Sian is not offered a pre-hire override.

Already in the product, and not exercised by forcing a conflict or a live send during this walk:

- Two-person save: a later save is refused, names who saved and when, and merges nothing.
- `EMAIL_SEND_MODE` stays `simulate` unless it is exactly `live` and the Microsoft 365 credentials are all set. This audit did not change it and did not press Record outgoing email.
- Session and role checks run on the server. `approveSettlement`, `manageBankDetails`, `extendedWait`, and `releaseWithoutExcess` are read from `staff_permissions` for that staff row. The administrator role and the username do not grant them (`src/lib/auth/roles.ts`).
- Unsigned agreements stay unsigned. The handover signature line says “Signed on CAS device, not an independently verified electronic signature.”
- Reserving a vehicle does not start hire or storage charges. The fleet screens say a reservation does not start charges.
- Fault courtesy is not credit hire. TEST-0004 shows that sentence.
- Overlapping fleet allocations, including staff bookings, are blocked.
- Repairable hire ends only after repairs are complete and the repaired vehicle is returned.
- Total-loss off-hire countdown starts only after a handler-confirmed qualifying payment, then seven days.
- Storage billing ends on an explicit date.
- Offers are not receipts. Claimed and agreed are not added together.
- A reduced settlement needs `approveSettlement`. Returning a fault car before the excess is paid needs `releaseWithoutExcess` and a reason.
- Unauthorised sending is blocked. A failed integration has to show the failure.
- `npm run check:pages` is expected to leave the database unchanged on open. This audit did not re-run that command.

## Outside services

What the product does until each service exists. Taken from the screens and the lookup code. None of these is a live connection.

| Service | What happens now |
| --- | --- |
| Postcode | The new-claim screen says “Lookup not connected yet – please type the details” when no licensed PAF key is in use (`LOOKUP_NOT_CONNECTED`). Find address then uses the free postcodes.io / Nominatim / OpenStreetMap path (`FreeUkPostcodeLookup` in `src/lib/lookups/postcode.ts`). For CF10 1EP that returned the postcode and the warning that a house list is not available. Ideal Postcodes is used only when `IDEAL_POSTCODES_API_KEY` is set. It was not returning a house list in this walk. |
| Registration lookup | “Lookup not connected yet – please type the details.” Check tax and MOT is labelled a simulated prototype result, not a live DVLA or MID enquiry. Tax and MOT come back unknown. The screen says registration lookup does not identify the keeper, and transmission is filled only when a lookup actually returned it. |
| MID | Manual askMID form. Copy on the new-claim screen: this records a manual check and does not look the vehicle up. The CRM does not scrape MID. Insurance on the vehicle check says to record the authorised AskMID result, and that the check does not identify cover. |
| Automatic licence checks | A link to the free GOV.UK page. Staff type the result. `DVLA_MANUAL_NOTICE`: the CRM does not call DVLA, and no DVLA account is waiting. |
| WhatsApp and inbound email | Banner: WhatsApp and telephone are not connected. Incoming mail is filed by hand. There is no inbox read. |
| Outbound email | Simulate. Record outgoing email stores the item. It does not send. A simulated or generated report does not satisfy the “sent” step. |
| Audatex | Steps page: “There is no link to Audatex. The figures are typed on this file.” Recording them does not change claimed, agreed, or received. |
| E-signatures | On-screen signature, labelled as not independently verified. An agreement whose wording is not approved can be kept as a draft and is not sent. This walk did not generate one. |
| Hosting and backups | The database is the local SQLite file. The dashboard footer still shows that path so a handler on this PC can find it. `docs/progress.md` already notes that the path should come off the footer before live use, and that backups, restore, and deploy are not claimed. |

## Tests the stages should add

`package.json` script `test` is `tsx --test tests/*.test.ts`. There is no Playwright script. `@playwright/test` appears only as a transitive entry in the lockfile. Each stage in the main note should add a journey test under `tests/` that creates a new claim through the real create-claim route handler and drives the route handlers for the steps that stage covers. A stage is unfinished until that test passes with `npm test`, `npm run typecheck` (zero errors), `npm run build`, and `npm run check:pages` with the database unchanged on open.

`docs/progress.md` was left unchanged. It is a dated log, not an index.

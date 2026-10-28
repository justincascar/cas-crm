# Claim journey audit — technical appendix

27 October 2026. Companion to `docs/CLAIM-JOURNEY-AUDIT.md`. Walked in the browser against the development server on `http://localhost:3000`, signed in as the office user, then the demonstration driver, then the demonstration mechanic. `EMAIL_SEND_MODE` stayed `simulate`. The development server was already running and was not restarted.

Hand files created on the demonstration database, so they can be opened again:

| File | Id | Kind |
| --- | --- | --- |
| TEST-0015 Audit Repair | `claim_04f4fe76-dbde-49c2-a9d4-00d157548ec3` | Non-fault, unroadworthy, recovery and replacement |
| TEST-0016 Audit Totalloss | `claim_b8aa10b8-0816-4c37-8007-f0885868ec96` | Same, then total loss ticked on Assessed damage |
| TEST-0017 Audit Fault | `claim_5c2f59d1-09e5-4f62-a06f-032e0c0ab158` | Fault, roadworthy, replacement, no recovery |

The surname on TEST-0016 is stored as Totalloss. The form capitalises it. `other_contact_skipped` is 1. `home_tel` is null. `telephone` and `mobile_tel` are the overseas number kept by Save anyway. TEST-0015 and TEST-0016 show outstanding £474.00 because the standard recovery fee (£395 plus VAT) is applied when recovery is ticked on create. TEST-0017 shows £0.00. No `day_assignments` row was created for these three.

TEST-0014 (Ceri Walsh, created 19/10/2026) was already on the database. It was not edited.

## Screen inventory

New claim is one screen, `/claims/new` (`IntakeForm`). After create, the file opens on `/claims/{id}` with the ten steps.

Hire is one route, `/claims/{id}/hire`.

| Screen | Route | What it does |
| --- | --- | --- |
| Hire | `/claims/{id}/hire` | Needed, checks, choose a car, pack, handover, on hire |
| Pre-hire checks | `.../hire#checks` (also `/prehire`) | Licence result and upload. Bank statements on a non-fault file |
| Choose a car | `.../hire#car` (also `/details/reserve`) | Free cars only. A reservation does not start charges |
| Hire pack | `.../hire#pack` (also `/hire-pack`) | Filled from the file. The licence number is not typed again |
| Handover | `.../hire#handover` | The car already chosen. Photographs stay on `/handover` |
| Hire money | `/claims/{id}/money/hire` | The hire head of loss |
| Financial circumstances | `/claims/{id}/financial` | Means, account list, upload, checklist, mitigation |
| Jobs | `/jobs` | The driver’s own jobs. A hire delivery is created when a car is chosen for delivery |
| Repair evidence | `/claims/{id}/repair` | Workshop steps and uploads |
| Storage money | `/claims/{id}/money/storage` | Chargeable end, including the confirm button |
| Missing id | `/claims/does-not-exist` | Next.js 404: “This page could not be found.” |

Driver and mechanic navigation is only “My jobs today”. `/financials` as the mechanic returns to `/jobs` with no refusal sentence. The workshop and the handover themselves are allowed.

## Click counts

Create, for each hand file: one screen. Ticks: Skip other number, Save anyway, and (where used) recovery and replacement. One Create claim click. Result: a `TEST-` number and step 1 `data-step="details"` `data-state="done"`.

To reach a hire car after that, the extra screens are the hire menu, pre-hire checks, financial circumstances, reserve, the hire pack, handover, and delivery notes. That is seven screens after the steps page, and the car is still not chosen, because reserve was not pressed. The pack then asks for the licence number, the address, and the rates that are already empty. The handover asks for the vehicle again.

A letter is another screen (Messages). Preview does not leave the page and does not mark step 4. The “Also record this as a dated step” tick is a second choice.

Total loss is one more screen (Assessed damage) and one tick. The steps list then switches. The new-claim form has no total-loss control.

## Confirmed issues

- Hire is one tab. A reservation does not start charges. The pack copies the file. The licence number is not typed again. Handover uses the car already chosen. Delivery creates one driver job. Known issues 26 and 27 are closed.
- Licence check is a GOV.UK link to https://www.gov.uk/check-driving-information, a short result, and an upload. Known issue 24 is closed. The CRM does not call DVLA. The full licence number is on the client record and is reused. The licence number already on the file is not this check.
- Bank statements are uploaded on the Hire tab and listed on Financial circumstances as the same file. An upload counts. A listed account or a no-bank explanation also counts. Known issue 25 is closed. A fault file does not ask for them.
- A hire delivery is created when a car is chosen for delivery. Other jobs are still assigned by hand on `/jobs`.
- `/claims/does-not-exist` is the framework 404. `notFound()` in `src/app/claims/[id]/layout.tsx`. Not changed. A 404 page is not a form.
- TEST-0013 (`claim_e6ee0ed9-2614-4586-87fd-390c1cab4219`) still shows both open flags: inherited £195 in a note, and recovery 09:00 before the accident at 14:30. Not rewritten.
- TEST-0004 still lists “Instruct the engineer” and “Request repair authorisation”, and credit-hire chases, while step 5 says there is no engineer on a fault claim.
- TEST-0009 step 6 still says the report cannot be told from the history. Offers were not opened for editing.
- Blank address on create is stored as Unknown / UNKNOWN, and step 1 reports one detail missing.
- Standard recovery is pre-ticked when the recovery section opens, so the claimed recovery exists before step 2 is Done.
- Recovery and storage money screens label the agreed box “Agreed repair invoice”.
- The hire pack still shows the 89-day pack cap against the 88-day CRM alerts.
- TEST-0005 storage: “Use this as the storage end date” is on the page. The page says nothing has been written yet. `storage_billing_end_on` is null. The button was not pressed. The charge heading also says “Confirmed 14/10/2026”, which reads as if the end were confirmed.

## Forms that were failing silently

These stayed on the page with no top explanation, or they blocked a tick that was not a telephone.

| Screen | What failed | What it shows now |
| --- | --- | --- |
| New claim | `client_skipOtherTel` matched the telephone rule because the name contains “tel”. The value `yes` was checked. Unticking did not clear it. Create claim stayed on `/claims/new`. | A skip tick is not a telephone. The other-number box is not submitted while it is ticked. Nothing is stored as “Skip other number”. Any other refusal shows “This was not saved.” at the top and names the box. The box is highlighted. |
| New claim, and every screen that uses `MobileField` (client, driver, owner, witness, insurer, hire-pack mobile) | The Save anyway tick is named `saveAnyway_{field}`. That name also matched the telephone rule, so ticking it kept the form on the page. | `saveAnyway_` is not a telephone. The warning stays on the number. Save anyway keeps the number. |
| Third party 1 insurer telephone, agent telephone, handler telephone | Plain inputs inside `ValidatedForm`. A non-UK number was told to use Save anyway, and there was no tick. | Those boxes are `MobileField`, with the warning and Save anyway. |
| Hire pack home telephone and work telephone | Same as the third-party boxes. The server did not apply the same check. | `MobileField` on the page. `actionSaveHirePack` rejects `home_tel`, `work_tel`, and `mobile_tel` unless `saveAnyway_{name}` is yes, and redirects with the field. |
| Storage location telephone | The page already showed the server error. The route dropped `saveAnyway_`, so Save anyway could not pass, and the box was not highlighted. | The form is `ValidatedForm`. The route keeps `saveAnyway_` keys. A `FieldValidationError` redirect includes `field`, and the box is highlighted. |

The telephone rule is unchanged: a UK number starting 0 or +44, the right length, and a mobile starting 07 or +447 when the field is a mobile. A failure warns and offers Save anyway. It does not block with no message.

Version clash still uses `pathWithClash` / `SaveClashNotice`. `redirect()` from route handlers is `NextResponse.redirect(browserOrigin(request))` and is not inside a `try/catch` that swallows it. Server-action `redirect()` still throws, and the catches in `src/app/actions.ts` do not catch that throw before it leaves.

Not treated as silent, and not weakened: login failure text, step errors, money figure and offer errors, clash notices, and the permission checks. The bare 404 is recorded above and was not changed.

## Journey test

`npm test` remains `tsx --test tests/*.test.ts`. It does not launch a browser.

`npm run test:journeys` is `tsx scripts/journey-check.ts`. Run it after `npm run build`. It starts `next start` on a free port with `DATABASE_PATH` under the temp directory and `EMAIL_SEND_MODE=simulate`. It signs in as the office user, using the password already in `docs/AUTH-NOTES.md`, and does not print it. It drives Microsoft Edge or Chrome through the real `/claims/new` form for the three journeys in `tests/journeys/claim-journeys.ts`:

1. Non-fault repairable (`Journey Repairable`)
2. Non-fault total loss (`Journey TotalLoss`) — total loss itself is a later stage, on Assessed damage
3. Fault courtesy (`Journey Courtesy`)

Each journey ticks Skip other number, enters `+1 202 555 0143`, ticks Save anyway, presses Create claim, and asserts a `TEST-` number, step 1 done, `other_contact_skipped = 1`, and `home_tel` null. `JOURNEY_STAGE` is `"create"`. Later stages extend the same three objects and the same script. Playwright was not added. The page-check runner already drives a real browser; this script uses that approach.

A stage is not finished until `npm run test:journeys` passes together with `npm test`, `npm run typecheck` (zero errors), `npm run build`, and `npm run check:pages` (database unchanged on open, no sideways scroll).

## Safeguards checked on this walk

- Opening pages wrote nothing except the three creates and the total-loss tick on TEST-0016. That tick does not set claimed, offered, agreed, or received.
- TEST-0005 `storage_billing_end_on` remains null. The confirm button was not pressed.
- TEST-0009 offers were not edited. TEST-0006 and TEST-0007 were not opened for money changes.
- No Send was pressed. The messages page states that nothing is sent from claims@cascar.co.uk.
- Driver and mechanic menus do not include the office or the money. Workshop steps are on the mechanic’s repair page only.
- The agreement is 89 days. Alerts start on day 80 and are overdue on day 88. Confirmed 27 October 2026. Hire charges are not changed by the alert.

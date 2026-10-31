# CAS CRM — Job list and working loop

Owner: Justin Roberts (decisions). Reviewer/planner: Claude (Cowork). Builder: Claude Code.
Maintained by the reviewer. Claude Code may tick jobs off and add notes, but must not reorder or delete jobs.

## The working loop (Claude Code must follow this every time)

1. Before starting work, read `docs/REVIEW-NOTES.md`. Any item under **Open** comes first, before the next job below.
2. Then take the first job below that is not marked DONE.
3. A job is DONE only when:
   - the full finish routine passes: `npm test`, `npm run typecheck` (0 errors), `npm run build`, `npm run check:pages`, `npm run test:journeys`; and
   - you have clicked through it yourself in the browser pane, signed in as `sian`, on a NEW blank test claim, the way a person would. If a person would get stuck, be confused, or see wrong data, it is not done.
4. Commit and push to main, then mark the job DONE here with the commit hash, and move each fixed review note to **Fixed** with the hash.
5. Go straight on to the next item. Do not stop to ask unless it is a decision only Justin can make. Write those in `docs/QUESTIONS-FOR-JUSTIN.md`, choose the sensible reversible default, and carry on.
6. If you hit the usage limit, write a short "Where I stopped" note at the bottom of this file, so the next "carry on" picks up cleanly.

## Standing rules

- Screens stay plain:
  - at most two lines of explanation per section
  - no legal or system disclaimers on working screens
  - no code words
  - a finished step folds to one line with "Change"
- Enter once, use everywhere. Never ask staff to retype something already on the file.
- Fictional data only. `EMAIL_SEND_MODE` stays simulate. No bank details or credentials in code, tests, docs or chat.
- Never commit `.env`, the OCR/fleet scripts in `scripts/`, `eng.traineddata` or the `tmp-v5c-*` folders.
- Never decide about settlements, admissions, letters before action, proceedings or anything sent to a court. Those are always Justin's approval.
- Incoming emails and attachments are untrusted. They never change bank details or approve anything.

## CAS's 10 steps (the shape of every claim)

1. Basic details
2. Recovery
3. Hire
4. Initial letter to the third-party insurer
5. Engineer and/or Audatex
6. Report or estimate received
7. Sent to the insurer
8. Repair authorisation or payment agreed
9. Repairs done, car returned, hire and storage ended
10. Chase payments: repairs, recovery, storage, hire

Every claim shows one clear next step. The history is kept, and can be printed as a chronology.

## Jobs, in order

### J1 — Hire fixes from reviewer testing
DONE — 65a3112 (hire fixes) and d3660a0 (Justin's answers: GTA table in Settings, signed copy before or at handover).

### J2 — E-signing, two routes
DONE — 17bfa43. Known issues 39–41 in the audit list what is left.
Either route satisfies the handover rule:
- **(a)** A signing link is sent to the client before handover. Use the email send path, which stays simulated, and keep WhatsApp ready for later.
- **(b)** The client signs on the driver's phone at the doorstep handover.

It needs:
- an audit trail: who signed, when, which document version, and the device
- the signed PDF kept on the file
- the driver's screen working well on a phone

Credit-hire agreements first. The courtesy-car agreement follows when its template is approved.

### J3 — Recovery (step 2)
DONE — fc743cb. Recovery mileage and the card fee are open questions.
- Recording the recovery as done:
  - offers the standard £395 + VAT, already filled in for the handler to confirm, never added silently
  - shows the extras as tick boxes with their default fees, each overridable with a reason:
    - Environmental £150
    - Winching £95
    - Forklift £85
    - Out of hours £100
  - offers typed amounts for specialist winching, skates/dollies, waiting time, a second operator and a manual charge
  - all amounts + VAT
- Storage starts from the recorded arrival at the yard.
- Fix the wrong "Agreed repair invoice" label on the recovery and storage money screens.
- Fix the TEST-0005 "Confirmed" wording while its storage end date is unconfirmed.
- Recovery mileage stays open (see the questions file).

### J4 — Letters and engineer (steps 4–7)
DONE — ada76d4. Known issues 45–47 in the audit list what is left.
- Generating a letter marks its step done, with an option to hold back the step if the letter wasn't sent.
- Add an insurer email template on that screen.
- Engineer instruction and Audatex estimate, sent, received and forwarded to the insurer, each as one click with a date.
- Fault files show Audatex instead of the engineer, and the client's own insurer instead of a third-party insurer.
- The fault file's problems list must not mention credit-hire documents.

### J5 — Repairs, return and endings (steps 8–9)
DONE — 2a3d472. Known issues 45, 48 and 49 in the audit list what is left.
- Repair authorisation or reductions, repairs started, repairs complete, car returned to the client.
- Hire end:
  - **Repairable:** the hire car collection date, confirmed by a handler.
  - **Total loss:** 7 days after the qualifying payment, confirmed by a handler.
  - Partial payments and disputed salvage are flagged for review.
- Storage end: the earlier of repairs started or repair authorisation, proposed and then confirmed by a handler.
- Total loss as proper figures:
  - pre-accident value, salvage deduction and salvage category
  - payments received
  - salvage collection and actual proceeds
  - any disputed shortfall
- Changing a repairable claim to a total loss must keep the history.

### J6 — Money and chasing (step 10)
DONE — 3e0b2fd. Invoice template and sending hours are questions 7 and 8. Known issues 45, 50 and 51 in the audit.
- Each head of loss kept separately: repairs, recovery, storage, hire, other.
- Track claimed, offered, agreed, paid, outstanding and overpaid.
- Show quantity × rate, net, VAT and gross.
- Invoices from CAS templates.
- Chasers every 3 days, inside sending hours:
  - a substantive reply pauses the chase
  - an acknowledgement or out-of-office does not resolve it
  - the claim is rechecked immediately before each send
  - no backlog of chasers after an outage
- Email stays simulated until hosting is in place.
- An aged-debt view.

### J7 — Dashboard simplified
DONE — 3bf60aa.
- Cut the 19 count boxes down to about 6 that matter:
  - claims needing action today
  - overdue
  - cars on hire (credit hire and courtesy shown separately)
  - in storage
  - money awaited
  - fleet free today
- No explanation sentences under the counts.
- One "Today's work" list, with a single next step per claim.

### J8 — Intake and loose ends
DONE — 359c73a.
- A blank address shows as "Address needed", never "Unknown / UNKNOWN".
- UK phone checks.
- A friendly "Claim not found" page.
- A mechanic who is redirected gets a one-line explanation.
- The weather and journey-purpose dropdowns.

### J10 — Recovery and storage evidence (do after the review notes)
DONE — 3cbeaa2. The GTA paragraph, the terms wording and the Northern Ireland checklist wait for Justin (questions 10–12).
Insurers are increasingly testing whether recovery and storage were necessary. The file must hold the evidence, and staff should capture it as they go, not afterwards.

**Recovery (step 2)** — record:
- where the car was
- its condition
- why it could not be driven safely (unsafe, obstructing, or at risk of further damage)

**Every vehicle movement** gets its own record:
- from, to and date
- the purpose
- whether it was required by the accident or made for convenience (workshop or business)

**Storage chronology** — dated entries for each of:
- inspection access
- repair authorised
- total-loss decision
- uplift requests
- salvage instructions
- the earliest date the car could reasonably have been moved

The proposed storage end uses these dates and shows the reason.

**Customer liability:**
- The recovery and storage terms the customer signs must make them liable for those charges. This needs Justin's CAS recovery and storage agreement wording; never invent it.
- Add a customer invoice for recovery and storage.

**Offers covering more than one head of loss:**
- Recording an insurer offer that covers more than one head of loss requires splitting it by head before it can be accepted.

**Not a GTA subscriber (once Justin confirms):**
- Add an optional letter paragraph: CAS is not a GTA subscriber and does not accept GTA rates, discounts or ADR terms.

**Intake:**
- Add a jurisdiction flag: England & Wales, Scotland or Northern Ireland. Northern Ireland files get a reminder about the extra evidence that court expects.

### J11 — The awkward cases, tested end to end
DONE — 461e878. `scripts/awkward-journeys.ts` (run by `npm run test:journeys`). Fixes and findings are in progress.md and audit items 53–59.
CAS's real claims don't follow the happy path. Build a browser journey test for each case below, starting from a new claim and clicking through as `sian`. Fix whatever breaks. Each case must leave the money, the dates, the next step and the chronology correct.

1. **Partial total-loss payment.** Hire must NOT end automatically. The file is flagged for review, the shortfall is shown, and the 7-day hire end waits for a handler.
2. **Disputed salvage.** The salvage deduction is disputed, the dispute is recorded, the shortfall is chased separately, and hire/storage endings are flagged rather than set automatically.
3. **Repairable changed to total loss mid-claim.** History is kept, repair steps close with a reason, the total-loss figures open, and the hire and storage end rules switch to the total-loss rules.
4. **Vehicle swap mid-hire.** One continuous hire, with the day count unchanged. The old car is freed, the new car is clash-checked, and a new signed agreement page or addendum is required where the CAS terms need one. Never invent wording; if unclear, ask in the questions file.
5. **Agreement renewal at day 80–88.** The alert shows at day 80, it's overdue at day 88, and renewing keeps one continuous history.
6. **Insurer reply arrives just before a chaser is due.** A substantive reply pauses that chase and the chaser is NOT sent. An acknowledgement or out-of-office reply does not pause it. An uncertain reply goes to review.
7. **Two staff edit the same claim at once.** The second save gets the clash message and nothing is lost.
8. **A payment covering several heads of loss.** It must be allocated by head before anything is marked paid, with no double counting.
9. **Overpayment.** It's shown separately and never nets off another head.
10. **A fault claim:**
    - Audatex estimate
    - an authorisation with reductions
    - excess unpaid → release blocked
    - excess paid → release allowed
    - invoice to the client's own insurer = the authorised amount minus the excess

### J12 — Foundations you can test before going live
DONE — cc61aae. Export and audit (Settings, Justin only), `npm run backup` / `npm run restore` (docs/BACKUP-AND-RESTORE.md), Who can do what with `scripts/permissions-check.ts`, `npm run check:speed`.
- **Full export:**
  - one button (Justin only) exports all claims, people, money, history and documents as a zip
  - a CSV per table, plus the document files
  - test that an export can be read back
- **Backup and restore on this PC:**
  - a script makes a dated backup of the database and documents
  - a restore script puts a chosen backup back into a separate test copy
  - test it: back up, change some data, restore, then confirm the data matches the backup
  - write plain step-by-step instructions in `docs/BACKUP-AND-RESTORE.md`
- **Audit view:** a page where Justin can see who changed what and when, on any claim, with filters.
- **A permissions check page or test:** for each role (Justin, office staff, driver, mechanic), list what they can see and do, and prove it with server-side tests. That includes drivers and mechanics being refused claims, money and bank statements by direct address.
- **Speed:** generate 1,000 fictional claims in a separate test database. Confirm the dashboard, claims list and a claim page each open in under 2 seconds. Fix any slow page.

### J13 — Litigation and disputes, the basics
DONE — d8333df. Each claim has a litigation file (History → Litigation file, or the Litigation list).
Check what the Litigation section does today, then make it useful without inventing anything:
- **Parties and representatives**, with their legal capacity. Never assume CAS is the claimant or the insurer is the defendant.
- **Court references, hearings, orders and deadlines.** Every deadline records its source and how it was calculated, and is marked "needs verification" until a person confirms it. The CRM never calculates court deadlines on its own authority.
- **Auto-built from the file:**
  - a chronology
  - a schedule of loss, by head, with claimed, offered, agreed and paid
  - an evidence checklist (what's on file and what's missing)
  - a bundle index
- **No legal document is sent or filed without Justin's approval:** letters before action, claim forms, court documents. Mark anything needing qualified legal review.

### J14 — Client form on a phone
DONE — 628302e. Documents tab → Client form sends the link; the client's page is /c/… (no CAS login).
- Check the secure client link on a phone-sized screen.
- The client can save and come back, and upload photos and documents.
- They can only ever see their own submission.
- Staff review proposed changes before anything updates the claim.
- Fix anything awkward on a small screen.

### J15 — Security and GDPR features that can be built now (fictional data; no decisions needed)
DONE — 9d1fbdc. Settings → Data protection (Justin): Retention and deletion, This person's data, Breach log. Sign-in security on Manage staff logins. `npm run data-map` writes docs/DATA-MAP.md; `npm run check:pages` now runs the security checks too.
These are the parts of J9b that don't need hosting or Justin's decisions. Where a period or a wording is still undecided, use the default given here, mark it "awaiting adviser", and make it editable in Settings.

1. **Data map.** Write `docs/DATA-MAP.md`, generated from the actual schema. It lists every personal-data field and covers:
   - who it's about: client, driver, third party, witness or staff
   - why it's held
   - which roles can see it
   - where it's stored
   - how long it's kept

   Mark licence points and endorsement codes (and "no points") as **criminal offence data**, and bank statements as **financial data**. This feeds the DPIA.
2. **Retention.** A retention schedule in Settings, with default periods marked "awaiting adviser":

   | Data | Default |
   |---|---|
   | Enquiries that never became a claim | 12 months |
   | Claim file | 6 years after the claim closes |
   | Invoices and financial records | 6 years after the end of the financial year |
   | Bank statements | Delete at claim close, unless used in a dispute or litigation (then follow the claim file) |
   | Licence check | Follows the claim file |
   | Audit log | 6 years |

   - A daily job builds a **"Due for deletion" list**. Nothing is deleted automatically yet: Justin approves each batch.
   - **Legal hold** on a claim blocks deletion.
   - Deletion either removes the record or anonymises it (keeping the money totals for the accounts), and logs what was removed, when and by whom, without keeping the deleted data.
3. **"This person's data" screen** (Justin only):
   - Search for a person across all claims and roles.
   - **Export everything held about them** as a zip, for a subject access request.
   - **Restrict or erase** where allowed, blocked by legal hold and by the retention rules, with a reason recorded.
   - Everything is logged.
4. **Audit of viewing,** not just changes. Log who opened or downloaded:
   - bank statements
   - licence checks
   - signed agreements
   - exports
   - the person's-data screen

   Show these in the existing audit view, filterable.
5. **Login security:**
   - Lock the account or slow down attempts after repeated failed logins.
   - Automatic sign-out after inactivity (Settings, default 30 minutes).
   - Strong password rules.
   - Optional authenticator-app two-step login for local logins, required for Justin.
   - Structure sign-in so that **Microsoft 365 single sign-on** can be added later without a rewrite. Don't connect it yet; that needs Justin's Microsoft admin setup.
6. **Security checks in the finish routine:**
   - a dependency vulnerability check (fail on high or critical)
   - a scan for secrets in the repo
   - safe security headers
   - CSRF protection confirmed on every form
   - uploads restricted by type and size, never served as runnable content, and only through permission-checked addresses

   Fix anything these checks find.
7. **Licence check minimisation.** Store only the categories, expiry, the points and endorsement codes relevant to the hire, and the check date. No free-text criminal history. Office staff only.
8. **Breach log.** A Justin-only page to record a suspected breach:
   - when it was discovered
   - what happened
   - whose data
   - the decision on whether to report it to the ICO, with a visible 72-hour clock from discovery
   - actions taken
9. **Privacy notice slot.** The client form and the welcome email show a "Privacy notice" link. The wording is a placeholder marked "awaiting approved wording (J9a)", and the client form can't go live while it's a placeholder.
10. **Tests.**
    - Server-side tests for each item above.
    - A journey test: a person's data export, a legal hold blocking deletion, the deletion list after the period, viewing a bank statement appearing in the audit, a lockout after failed logins.
    - The usual browser walk-through as `sian` and as `justin`.

### J16 — Website enquiries into the CRM (build in this CRM repo)
DONE — 138a8c7. The website posts to `POST /website/enquiry` (JSON, or a plain form that is redirected back to the website's /thank-you.html or /not-sent.html). Staff work them from the Website enquiries menu item; the live website address goes in Settings → Website enquiries. In development only http://localhost:4000 is accepted.
The public website's "Start your claim" form must land in the CRM as an enquiry for staff to review. Nothing is typed twice.

- **A public endpoint for the website form** (no staff login). It accepts:
  - name, mobile, registration, accident date
  - whose fault (theirs / mine / not sure)
  - whether the car can be driven (yes / no / not sure)
  - what happened (short text)
  - privacy-notice consent: required, stored with its date and time
- **Treat everything it receives as UNTRUSTED.**
  - Strict size and format checks.
  - Rate limiting per IP address and a hidden spam trap.
  - No file uploads on this form.
  - It must never create a claim, change existing data or trigger any send by itself.
- **The enquiry appears on a "Website enquiries" list for office staff,** marked "Needs a call", with a count on the dashboard. "Car can't be driven" enquiries are flagged as urgent.
- **"Convert to claim"** opens the new-claim form pre-filled from the enquiry, for staff to check and save. "Not proceeding" closes it with a reason.
  - Enquiries that never become claims follow the 12-month retention rule.
- **Allowed origins.** The website address is a Settings value. In development the CRM accepts posts from the local website only.
- **Tests:**
  - validation
  - the spam trap
  - the rate limit
  - no claim created automatically
  - converting to a claim pre-fills correctly
  - retention applies
  - the usual browser walk-through

### J17 — Build the real CAS website (a SEPARATE project, not inside the CRM)
DONE — CAS-Website commit 6730c22 (local only: GitHub is not signed in on this PC, see question 25). Open it with `npm run dev` in `Code\CAS-Website` (in PowerShell, `npm.cmd run dev`), at http://localhost:4000. Its README lists the checks and what is still placeholder.
**Design reference:** `docs/website-mockup/`. `homepage-preview.html` is the approved look; open it in a browser. The screenshots are `desktop-top.png` and `phone-top.png`, and the source is `homepage-design-source.dc.html`. Match it closely: layout, colours, fonts (Barlow Condensed and Inter), the original SVG illustrations, wording and placeholders.

- **Create a new folder beside the CRM:** `C:\Users\JustinRoberts\OneDrive - Complete Accident Solutions\Code\CAS-Website`, with its own git repository.
  - If GitHub access is set up, create a PRIVATE repo under CAS's account and push.
  - If not, keep it local and say so. Never use a personal or third-party account.
- **Keep it a simple, fast, static site that is easy to host,** and choose the tooling to match. Pages:
  - Home (from the mock-up)
  - Privacy notice
  - Complaints
  - Cookies
  - Terms

  The privacy, complaints, cookies and terms pages use placeholders marked "awaiting approved wording (J9a)". Never invent legal wording.
- **The "Start your claim" form posts to the CRM endpoint from J16.** The address is configurable. Show clear success and failure messages, and never claim it was sent when it wasn't.
  - Wording: "we'll send you a secure link", not "text you", until text messaging is actually connected.
- **No tracking or analytics cookies by default.** If any are added later, they need a consent banner.
- **Accessibility:** proper headings, labels and focus states, keyboard use, contrast 4.5:1 or better, and alt text on the illustrations.
- **Mobile:** test at phone, tablet and desktop widths. No sideways scrolling, and the "Call us / Start your claim" bar shows on phones.
- **SEO basics:** a page title and description, plus LocalBusiness structured data using ONLY true facts (name, address, phone, email). No ratings until real reviews exist.
- **Placeholders stay visible as [brackets]** until Justin supplies the real values: logo, photos, opening hours, recovery hours, areas covered, company number, reviews.
- **Tests:**
  - an automated accessibility check
  - a broken-link check
  - screenshots at phone and desktop width compared against the mock-up
  - a form-to-CRM test against the local CRM
- **Report:** where it is, how to open it locally, and what's still placeholder.
- **Hosting goes with the CRM at J9,** and needs Justin's approval and costs first.

### J9a — Template and wording review by Justin (MUST be done before going live)
This is a gate. The CRM must not be used with real clients until it is complete.

**The reviewer (Claude, Cowork) prepares one read-through document containing every piece of client-facing and insurer-facing wording the CRM uses:**
- the Hire Pack and its terms
- the recovery and storage agreement
- every letter and email template
- chasers, rebuttals and the GTA paragraph
- the e-signing screen text
- draft invoices

Any gaps are marked clearly.

**Justin checks it and supplies the missing documents:**
- the client services / authority-to-act form and terms of business
- a privacy notice
- a credit repair agreement (if used)
- a courtesy car agreement
- the invoice layout, invoice numbering and VAT number
- any newer version of the Hire Pack

**His solicitor checks the items flagged for legal review**, such as the Hire Pack clause 5.3 citation and doorstep signing and cancellation rights.

**Claude Code then:**
- puts the approved wording in
- removes anything marked draft
- confirms every client and insurer document uses only approved wording

### J9b — Security and GDPR gate (MUST pass before any real client data)
CAS holds personal data, including some that is sensitive:
- bank statements
- driving licence details, and penalty points, which count as criminal offence data
- addresses, dates of birth and phone numbers

Security must be high. Nothing real goes in until every item below is done and evidenced. Items marked **(adviser)** need Justin's data protection adviser or solicitor; the CRM only supports them.

**Hosting (decision to be confirmed with costs before purchase):**
- Preferred: Microsoft Azure UK South.
- Staff sign in with their existing Microsoft 365 work accounts, with MFA (Entra ID single sign-on). Disabling a Microsoft account removes CRM access.
- A managed database with encrypted automatic backups and point-in-time restore. This means moving from SQLite to a managed database, done with fictional data and fully tested.
- Documents in UK encrypted storage.
- Fallback: Fly.io London.
- CAS owns every account. Secrets live only in secure settings: never in code, chat or git.

**Security controls (Claude Code builds and tests):**
- MFA for everyone, enforced. No demo logins. Strong session handling, with automatic sign-out after inactivity.
- Least privilege by role, enforced on the server. Re-test the permissions page from J12 on the live setup.
- Encryption in transit (HTTPS only) and at rest (database, documents and backups).
- An audit log of who viewed AND changed sensitive records, especially bank statements, licence checks and exports.
- Backups kept separately from the live system, with a restore tested before go-live and then monthly, written up in `docs/BACKUP-AND-RESTORE.md`.
- Dependency and security checks run in the finish routine. Rate-limit and lock out repeated failed logins.
- An independent security test (penetration test) before go-live **(Justin to approve the cost)**.
- Cyber Essentials certification for CAS is recommended **(Justin)**.

**GDPR (the CRM supports these; the items marked adviser need checking):**
- **Data protection pack, DRAFTED 30 October 2026 — waiting for adviser review (MUST be approved before going live).**
  - The draft contains: the DPIA, the Appropriate Policy Document for licence points (criminal offence data), the client privacy notice, and the retention periods and open points.
  - Find it in the claude.ai project "CAS CRM" as "CAS CRM — Data protection pack (draft for adviser)": https://claude.ai/artifact/3967CMrKYhjrWBUYzHVL2D
  - Justin sends it to his adviser. Once it's approved, Claude Code puts in the approved privacy notice wording and the retention periods, and removes the "awaiting adviser" marks.
- **DPIA.** A Data Protection Impact Assessment, drafted for the adviser to review **(adviser)**.
- **Criminal offence data.** Licence points and endorsements need a lawful condition and an appropriate policy document **(adviser)**.
- **Privacy notice** for clients, shown on the client form and in the welcome email. Wording is part of J9a **(adviser)**.
- **Retention.** A retention schedule in Settings, for example bank statements deleted X months after the claim closes. Automatic deletion or anonymising, with a log. Justin and the adviser set the periods.
- **Subject requests.** A "person's data" screen to export everything held about one person (subject access), and to erase or restrict where the law allows. Legal holds block deletion during disputes or litigation.
- **Data minimisation.** Only collect what the claim needs. Bank statements are visible to office staff only.
- **Processors.** A data processing agreement in place with each supplier: hosting, email, WhatsApp, lookups and any AI service that will see real data **(Justin)**.
- **Breach plan.** A short written procedure, including the ICO 72-hour reporting rule **(adviser)**.
- **ICO registration** covers this processing **(Justin)**.
- **Development and testing** always use fictional data. The live and test systems are kept fully separate.

### J9 — Before live use (needs Justin's approval and costs first)
- Hosting with tested backups and a restore.
- Real logins in place of the demo ones.
- Remove the database path from the footer.
- Microsoft 365 inbound email.
- WhatsApp Business.
- Postcode, registration (VRM) and MID lookups.

## Where I stopped

**31 October 2026 (evening) — Claude Code:** review notes R42–R47 are fixed (4be50b3). The website restyle and registered office are committed on this PC (CAS-Website 853ba3a) but not pushed: the saved GitHub sign-in cannot reach `justincascar/cas-website` (question 25). No other job is open: J9a, J9b and J9 wait for Justin. Open questions: 1–3, 5, 7 (template and numbering), 10, 12, 18, 20, 22–25, 26 (photos, hours, areas, MOT link, reviews), 27, 28 and 29.

**31 October 2026 — Claude Code:** review notes R27–R41 are fixed (df15389) and the website has the logo and company numbers (CAS-Website e640db6, local). No other job is open: J9a, J9b and J9 wait for Justin. Open questions: 1–3, 5, 7 (template and numbering), 10, 12, 18, 20 and 22–28.

**30 October 2026 (late evening) — Claude Code:** J16 (138a8c7) and J17 (CAS-Website 6730c22, local) are done. Everything on the list is done except J9a, J9b and J9, which wait for Justin. Open questions: 1–3, 5, 7, 10, 12, 18, 20 and 22–26.

**30 October 2026 (evening) — reviewer:** next are J16, then J17.

**30 October 2026 (afternoon) — reviewer:** next is J15. Then stop and write where you stopped.

**30 October 2026 — reviewer:** R22 committed and pushed in eb9b355. Then J11, J12, J13 and J14, in that order. J9a and J9 wait for Justin.
(Claude Code writes here when it pauses.)

**29 October 2026 — reviewer:** new Open items in REVIEW-NOTES.md (R1–R12) come first, then J10. J9 still waits for Justin.

## Where I stopped (28 October 2026)

J1 to J8 are done and pushed. J9 is not started: it needs Justin's approval and the costs first. Known issues still open are listed in CLAIM-JOURNEY-AUDIT.md (35, 37, 39–41, 45, 47–51). Questions 1–3 and 5–9 are open; 4 was answered on 29 October 2026.

## Where I stopped (29 October 2026)

Review notes R1–R12 are fixed (69cec49) and J10 is done (3cbeaa2). Everything on the list is done except J9, which needs Justin's approval and costs. Open questions: 1–3 and 5–12 in QUESTIONS-FOR-JUSTIN.md.

## Where I stopped (30 October 2026)

R22 (eb9b355), J11 (461e878), J12 (cc61aae), J13 (d8333df), J14 (628302e), R23–R26 (2731113) and J15 (9d1fbdc) are done and pushed. Everything on the list is done except J9a and J9, which wait for Justin. Open questions: 1–3, 5, 7, 10, 12, 18, 20, 22 and 23 in QUESTIONS-FOR-JUSTIN.md.

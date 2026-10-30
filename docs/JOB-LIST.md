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
- Check the secure client link on a phone-sized screen.
- The client can save and come back, and upload photos and documents.
- They can only ever see their own submission.
- Staff review proposed changes before anything updates the claim.
- Fix anything awkward on a small screen.

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

**30 October 2026 — reviewer:** R22 committed and pushed in eb9b355. Then J11, J12, J13 and J14, in that order. J9a and J9 wait for Justin.
(Claude Code writes here when it pauses.)

**29 October 2026 — reviewer:** new Open items in REVIEW-NOTES.md (R1–R12) come first, then J10. J9 still waits for Justin.

## Where I stopped (28 October 2026)

J1 to J8 are done and pushed. J9 is not started: it needs Justin's approval and the costs first. Known issues still open are listed in CLAIM-JOURNEY-AUDIT.md (35, 37, 39–41, 45, 47–51). Questions 1–3 and 5–9 are open; 4 was answered on 29 October 2026.

## Where I stopped (29 October 2026)

Review notes R1–R12 are fixed (69cec49) and J10 is done (3cbeaa2). Everything on the list is done except J9, which needs Justin's approval and costs. Open questions: 1–3 and 5–12 in QUESTIONS-FOR-JUSTIN.md.

## Where I stopped (30 October 2026)

R22 (eb9b355), J11 (461e878) and J12 (cc61aae) are done and pushed. Next: J13, then J14. J9a and J9 wait for Justin. Open questions: 1–3, 5, 7, 10, 12 and 16–18 in QUESTIONS-FOR-JUSTIN.md.

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

### J9 — Before live use (needs Justin's approval and costs first)
- Hosting with tested backups and a restore.
- Real logins in place of the demo ones.
- Remove the database path from the footer.
- Microsoft 365 inbound email.
- WhatsApp Business.
- Postcode, registration (VRM) and MID lookups.

## Where I stopped
(Claude Code writes here when it pauses.)

## Where I stopped (28 October 2026)

J1 to J8 are done and pushed. J9 is not started: it needs Justin's approval and the costs first. Known issues still open are listed in CLAIM-JOURNEY-AUDIT.md (35, 37, 39–41, 45, 47–51). Questions 1–3 and 5–9 are open; 4 was answered on 29 October 2026.

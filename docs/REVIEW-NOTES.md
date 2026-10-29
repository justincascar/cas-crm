# CAS CRM — Review notes

Written by the reviewer, Claude (Cowork), after testing the app in the browser as a member of staff. Claude Code: fix everything under **Open** before starting the next job in `docs/JOB-LIST.md`. When a note is fixed, move it to **Fixed** with the commit hash. Each fix follows the usual rule: the finish routine passes, and you click through it as `sian` on a NEW claim.

## Open

(No open notes.)

## Fixed

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


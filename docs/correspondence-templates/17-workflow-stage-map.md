# Workflow stage map

This is the case lifecycle these templates assume, with what triggers each one and what stops
the automation. Treat this as the spec for wiring trigger logic into the CRM — adjust freely to
match how CAS actually works if any stage doesn't match reality.

## Stages

1. **Intake** — case created in CRM → send `01-client-intake-welcome`, which now requests
   logbook, insurance certificate, driving licence **and financial disclosure (statement of
   means + 3 months' bank statements)** all at once, before the replacement vehicle is handed
   over. Do this now, not reactively later: once a claim has settled, clients are far less
   responsive, so this evidence needs to be on file before hire starts, not chased after hire
   ends. Treat it as a soft gate — strongly push to get it before/at the point the replacement
   vehicle goes out, without necessarily blocking a vehicle a client urgently needs.
2. **Recovery & storage** — vehicle recovered/stored. No template; a CRM status update.
3. **Liability notice** — as soon as the at-fault party/insurer is identified → send
   `03-insurer-notification-of-claim`. Doesn't need to wait for repair to complete.
4. **Repair** — engineer instructed (`02-engineer-instruction`) → report received → repair
   authorised → repair carried out. Send `13-client-status-update-general` on each stage
   change. If the engineer's report or the repair itself runs past its expected turnaround,
   fire `15-internal-chase-repairer-or-engineer` (e.g. 3 days overdue, then every 3 days).
5. **Vehicle returned** — repair complete → send `14-vehicle-ready-for-collection` to client.
6. **Hire pack submission** — hire agreement + engineer's report + repair invoice + BHR
   evidence all present → send `04-hire-pack-cover-letter`. This is also the point the "chase
   clock" starts.
7. **Chase sequence** (runs only while unpaid and unresolved):
   - N days after hire pack sent, no response → `05-payment-chase-1-first-reminder`
   - N days after that, still nothing → `06-payment-chase-2-final-warning`
   - Beyond that: hand-off to solicitor (outside this template set)
8. **Dispute branch** (interrupts the chase sequence when the insurer responds with a specific
   objection rather than payment):
   - Rate disputed → `07-rebuttal-rate`
   - Need disputed → `08-rebuttal-need`
   - Duration disputed → `09-rebuttal-duration`
   - Financial disclosure requested → `10-impecuniosity-disclosure-response` (in most cases this
     should now just confirm what was already collected at intake, rather than starting from
     scratch)
   - After sending a rebuttal, restart the chase clock rather than resuming the old one.
9. **Total loss branch** (replaces steps 5–6 if the engineer flags total loss at any point):
   - Settlement figure agreed → send `11-total-loss-cessation-to-insurer` (this is what stops
     the hire clock — hire charges should not accrue past the cessation date it sets) and
     `12-client-total-loss-update` to the client.
10. **Payment received** — full settlement received (whether repair or total-loss route) →
    send `16-case-closed-payment-received`, mark case closed, and **stop every chase sequence
    for this case** — this is the master stop condition.

## Stop conditions the CRM needs to enforce

- Never fire a chase (05/06) for a case marked closed, disputed-and-awaiting-CAS-response, or
  handed to solicitors.
- Hire charges (and therefore what's chased) stop accruing at whichever comes first: vehicle
  returned to client, or total-loss cessation date from `11`.
- A rebuttal (07/08/09/10) going out should reset the chase timer, not stack on top of it.
- Partial payment should reduce the outstanding balance the chase templates reference, not
  cancel the chase outright.

# CAS CRM — honest status report

**Inspected:** 17 September 2026  
**Purpose:** Snapshot of what actually exists in this repository, so future sessions do not have to re-inspect. This is not a product brochure.

**Method:** Read the source, schema, seed data, tests, README and existing docs. Application code was not changed.

**Legend**

| Letter | Meaning |
| --- | --- |
| **(a)** | Genuinely working end-to-end with real persistence (saved on this PC and still there after closing the browser) |
| **(b)** | Partially built — screens and/or database exist, but the operational job is incomplete |
| **(c)** | Simulated or mocked — the button/file record exists, but nothing real is connected |
| **(d)** | Not started at all |

Where an area is mixed, the letter is the honest overall grade, with the split explained underneath.

---

## One-line verdict

This is a **working local prototype**, not a production CRM. You can open it on this PC, **sign in as demonstration staff**, create and edit fictional claims, and they are saved. There is **no live email/WhatsApp/phone**, and **no live vehicle or insurance lookup**. Postcode lookup talks to real free internet services (not a licensed Royal Mail address file). Data is **not** in-memory and does **not** reset when you close the browser; it only reseeds if you delete the database file.

Do **not** put live client data in it.

---

## Storage and authentication

### Persistent storage — yes, on this PC only

- Database: SQLite via Node’s built-in `node:sqlite`.
- Location: `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite`  
  On this machine that is typically  
  `C:\Users\JustinRoberts\AppData\Local\CAS-CRM\cas-crm.sqlite`  
  (kept off OneDrive on purpose so the file is not locked).
- First start with an empty file: the app creates the tables and seeds **12 fictional TEST claims** plus fleet, tasks, money lines and demonstration staff.
- After that, new claims, notes, tasks, screen saves, generated letters and logged correspondence stay until you delete the file.
- Override path: environment variable `DATABASE_PATH`.

This is **not** a shared office database. It lives on one Windows PC. Two browsers on the same PC share the same file. Another staff member on another computer cannot see it unless you later host it.

### Real authentication — local staff login only **(b)**

- The same four demonstration staff (Justin, Sian, Tom, Megan) sign in with username and password.
- Passwords are stored as scrypt hashes. Sessions use an HTTP-only cookie. See `docs/AUTH-NOTES.md`.
- Pages and server actions refuse claim, client, fleet and financial data unless that session is valid. Direct URLs while logged out redirect to `/login`.
- **Still this PC only.** Not a shared office server.
- **No fine-grained claim permissions.** Any signed-in staff member can open every file, including licence details labelled “restricted”.
- **Administrator vs staff:** Justin Roberts is an administrator and can manage staff logins at `/settings/staff`. Sian, Tom and Megan are staff. Standard staff are refused that screen on the server.
- Notes and actions still default the actor to the file handler, or to Sian if none is set, unless the form says otherwise.

**Grade: storage (a) for a single PC; authentication (b) — login enforced, administrator can manage staff logins, still equal access to every claim, not multi-user hosting.**

---

## Checklist by area

### Dashboard — **(a)**

Working desk with counts that open filtered claim lists. Figures are **queried from SQLite**, not hardcoded in the page.

What it currently displays:

| Card / section | Where the number comes from |
| --- | --- |
| New enquiries / incomplete forms | Claims flagged as new enquiry or incomplete form |
| Tasks due today | Open tasks whose due date is today (Europe/London) |
| Overdue tasks | Open tasks whose due date is before today |
| Active hire | Claims with hire status `active` |
| Vehicles in storage | Claims with storage status `active` |
| Fleet available | Count of fleet vehicles with status `available` |
| Awaited liability responses | Claims with insurer liability still pending |
| Awaited engineer reports | Claims with engineering status `awaiting_report` |
| Repair authorisations awaited | Claims with repair status `awaiting_auth` |
| Repairs in progress | Claims with repair status `in_progress` |
| Ready for customer return | Repairs complete, repaired vehicle not yet returned |
| Total-loss payments awaited | Total-loss files where a qualifying payment is not confirmed |
| Off-hire dates approaching | Files with a scheduled off-hire date |
| Salvage awaiting collection | Salvage status `awaiting_collection` |
| Agreement renewals (day 80 / unsigned) | Hire agreements at/after renewal alert day, or unsigned |
| Unread correspondence | Files with unread logged correspondence |
| Offers awaiting review | Financial lines with offer status `awaiting_review` |
| Litigation deadlines | Claims that have a litigation row |
| Tasks by handler | Same open-task query, grouped by seeded staff name |
| Fleet snapshot | Counts of fleet vehicles by status |
| Amounts by head of loss | Sum of `financial_lines` — claimed / offered / agreed / received kept **separate** (never added together) |
| All prototype files | Full claim list from the database |

**Caveat:** On a fresh database those numbers come from the **seeded TEST files**, not from live CAS work. After you add or change records, the dashboard follows the saved data. Clicking a count goes to `/claims?queue=…` or `/tasks` / `/hire` as labelled.

Also on the dashboard: search (file number, client name, registration, insurer reference).

### Claim records — **(a)** core file; **(b)** full operational CRM

What works and is saved:

- Unique file references (`TEST-0001` onwards on a fresh database; next number is calculated, not typed by hand).
- Claim list, search, open file, edit current position / circumstances / liability / roadworthiness / handler / next action.
- Notes and tasks on the file.
- Dated **file history** (`claim_events`): staff can record steps such as initial TP insurer letter, engineer instructed, repairs started.
- Linked people, vehicles, third parties, witnesses, recovery jobs, MID recording table, correspondence, documents.
- Right-hand **file screens** (Alpha-style viewing pane, not a pixel clone). Values persist in `claim_screen_data`. Saving client, vehicle, accident, insurer, storage, recovery and third-party screens also updates the main tables.

Visible screens (not hidden): Communications; General; Client; Driver; Owner; Insurer; Vehicle; Damage (with diagram); Accident; Witnesses; TP1; TP2; Hire vehicle; Reserve; Hire mitigation; Delivery/collection; Hire details; Additional drivers; Assessed damage; Storage; Recovery; Financial summary.

Hidden on purpose (duplicate of other surfaces): Navigation, History, Extra charges, Hire-car register, Loss-of-use dates as a second chronology.

Gaps:

- No photograph/document **file upload**.
- Client-entered vs staff-reviewed facts are not fully separated.
- Financial-summary invoice boxes save as JSON on the screen and **do not** update the money ledger used by the dashboard.
- Licence numbers stored but not locked down.

Seeded files (fictional only — not live 100714 data):

| Ref | Illustration |
| --- | --- |
| TEST-0001 | New enquiry, incomplete form (Aled Morgan) |
| TEST-0002 | Roadworthy; vehicle reserved; **charges not started** (Bethan Lewis, CF64 DLE) |
| TEST-0003 | Undriveable; recovery and like-for-like hire running |
| TEST-0004 | Fault courtesy; **not** credit hire |
| TEST-0005 | Liability + engineer wait |
| TEST-0006 | Engineer in; repair authorisation awaited |
| TEST-0007 | Repairs in progress; hire on |
| TEST-0008 | Repairs complete; customer not returned; hire still on |
| TEST-0009 | Total loss; offer not treated as qualifying payment |
| TEST-0010 | Qualifying payment; off-hire countdown |
| TEST-0011 | Day-80 **unsigned** renewal (must not be marked signed) |
| TEST-0012 | Offer awaiting review; court issue **not** approved |

### Client intake — **(a)** with simulated lookups

`/claims/new` is a working numbered intake (client/owner/driver split, vehicle, tax/MOT/insurance recording, damage, accident, maps link, police, witnesses, recovery, storage from recovery day, up to three third parties with insurer and TPI agent). Submitting creates a real claim, people, vehicles and history rows in SQLite.

Lookups on the form:

- Postcode: real free internet lookup (see Integrations). Not a full Royal Mail house list unless a paid key is added.
- Registration / tax / MOT / insurance: **simulated** for a handful of demo plates, or when no DVLA key is configured. Make, colour, tax and MOT stay editable. A failed lookup does not block the form. Insurance is never invented from a scrape.
- Accident date cannot be after today (Europe/London). Checked in the browser and when the server saves.
- Date of birth shows a live age. Drivers under 17 cannot be saved. Client/owner/hirer under 17 needs a confirmation tick. Future and over-110-year dates are rejected.

Casing rule is implemented: vehicle registration in capitals; other typed fields title-cased.

Intake can queue **simulated** WhatsApp photo / recovery messages. Nothing is sent.

### Fleet / hire — **(b)**

Working:

- Fleet list (10 demonstration vehicles CAS 1–CAS 10) with status and location.
- Reservations persist. Overlapping allocations, including staff bookings, are **blocked** (tested).
- Opening a claim or reserving a vehicle **does not** start hire/storage charges (tested).
- Hire episodes, agreements (88-day max, day-80 alert), handovers exist in the database; some are seeded.
- Per-file **Hire Pack**: collect hirer / additional driver / charges / mitigation / handover fields from the file; generate HTML from the supplied `Hire Pack.doc` structure. Missing fields listed, not invented. Signatures not fabricated. Driver delivery/collection sheets marked internal.
- Fault courtesy is stored as courtesy, not credit hire (TEST-0004).

Not finished:

- No live Word merge of the original `.doc`.
- Pack rental period in the legal wording is **89 days**; CRM alerts remain **88 days** (flagged for review, not silently changed).
- Credit period in the pack is **51 weeks**.
- Handover/return as a complete operational process (mileage, fuel, keys, signed originals) is only partly modelled.
- Cross-hire is a field, not a full supplier workflow.
- Starting hire only when the replacement is actually supplied is a rule in tests/seed, not a complete timed workflow engine.

### Engineering / repairs — **(b)**

Working enough for a claims desk **status board**:

- Claim fields: `repair_status`, `engineering_status`, repairs complete / vehicle returned.
- Dashboard queues for engineer reports, repair authorisation, repairs in progress, ready for return.
- Assessed-damage screen (including total-loss flag).
- Chronology events for engineer instructed / repairs authorised / repairs started.
- Repairable hire may end only after repairs complete **and** the repaired vehicle is returned (tested).

Not started or only labelled:

- No engineer job book, no report file ingest, no bodyshop diary.
- Garage / MOT expansion is explicitly later work (**d**).
- Engineer instruction letter is placeholder wording, not CAS’s real template.

### Financials / invoicing — **(b)**

Working:

- `financial_lines` table with claimed / offered / agreed / received in **integer pence**.
- Financials page lists those lines from the database.
- Dashboard totals come from the same table and stay distinct (an offer is not a receipt).
- New intake can add claimed recovery/storage lines from captured amounts.
- Indicative CAS defaults (storage £39/day, recovery £395, etc.) are **shown in Settings** and **not applied automatically**.

Not working as real invoicing:

- The Financials page is largely a **read-only** ledger of seeded (or intake-created) lines. There is no “raise invoice / record payment” desk that writes new ledger rows.
- File screen “Financial summary” invoice boxes persist as JSON only; they do **not** feed dashboard totals.
- No VAT return, no payment pack from CAS templates, no credit-control letters.

### Documents — **(b)**

Working:

- Generate and store HTML letters from file history dates: initial TP insurer letter, engineer instruction, repair commencement, liability chaser.
- Hire Pack generation (above).
- Recovery/storage agreement placeholder from intake facts (unsigned).
- Documents list and print view. Unsigned stays unsigned. Seeded “signed copy uploaded” rows are labelled simulated.

Not working:

- Not CAS’s real letter library / Word templates.
- No electronic signing.
- No upload of signed PDFs/photos.
- Court / pre-action packs not generated; letter before action must not be produced without specific approval (not built as a sendable pack).

### Email / WhatsApp / telephone — **(c)** for live send/receive; **(a)** for filing on the PC

On each file (`/claims/[id]/work/comms`) and on `/communications`:

- Compose “send” email / WhatsApp: stored as `simulated_sent` with a warning. **Nothing leaves the office.**
- Log incoming email / WhatsApp: saved against the file.
- Record outgoing/incoming calls: logged only; **no live dial**. Unanswered can create a call-back task.
- Failed validation (blank to/subject) is shown as failure, not pretended success.

Office mailbox, WhatsApp Business and telephony are **not connected**.

### Automation — **(c)** display of seeded rules; runner **(d)**

`/automations` lists rows from the `automations` table (engineer chaser on 3 **calendar** days, labelled demonstration). Nothing is sent. There is **no scheduler** that runs while the browser is closed. A substantive-reply pause is described in copy, not implemented as a live mail-reader.

### Authentication / permissions — **(b)**

Local staff login is enforced on the server. Justin Roberts is an administrator and can manage staff logins at `/settings/staff`. The other three demo accounts are staff and are refused that screen. All signed-in staff still have equal access to all claims. Fine-grained claim permissions, client isolation and a shared office server are **not** built. See `docs/AUTH-NOTES.md`.

Settings shows prototype flags (file prefix `TEST-`, 88 days, day 80, 3-day chaser) and the staff list. Stage 2 in the brief still covers per-file permissions and hosting.

### Litigation — **(b)**

`/litigation` lists seeded stages and deadlines with source text. Court issue stays unapproved unless the flag is set (TEST-0012 is not approved). No issue-proceedings workflow, no real pre-action pack, CAS is not assumed to be claimant.

### Garage / MOT / client portal / hosting — **(d)**

Allowed later; not blocking claims work; not built. No public deploy, no backups/restore product.

---

## External integrations

| Integration | Status | Notes |
| --- | --- | --- |
| Postcode (default) | **Live free APIs**, not PAF | postcodes.io + Nominatim + OpenStreetMap Overpass. Confirms the postcode and sometimes a street/house list. Welsh postcodes often have **no house list**. Manual typing remains. |
| Postcode (Ideal Postcodes / Royal Mail PAF) | **Adapter ready, not live** | Used only if `IDEAL_POSTCODES_API_KEY` is set. No key in the repo. Do not invent one. |
| Vehicle registration | **Stubbed** | Three demo plates (CF64 DLE, SA12 CWA, WN12 PSH). Does not identify the keeper. Does not infer transmission. |
| Tax / MOT | **Stubbed** + GOV.UK links | Same demo plates; otherwise “confirm on GOV.UK”. |
| MID / insurance | **Absent as a live lookup** | Staff can **record** an authorised AskMID result. One seeded manual record on TEST-0002. Do not scrape AskMID. |
| Google Maps | **Link only** | Builds a maps search URL from the accident location. No Maps API key. |
| Email | **Stubbed** | `SimulatedEmailGateway` |
| WhatsApp | **Stubbed** | `SimulatedWhatsAppGateway` |
| Telephone | **Stubbed** | `SimulatedPhoneGateway` |
| E-signing | **Absent** | |
| Microsoft 365 / IMAP | **Absent** | |
| Hosting / backups | **Absent** | Local prototype only |

`.env` is gitignored. There is no committed secrets file.

---

## What the stack is

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Node 24.
- Money: integer pence. Dates: ISO UTC stored, Europe/London displayed (including BST).
- Run: `npm run dev` or `Start-CAS-CRM.bat` → http://localhost:3000. Tests: `npm test` (`tests/*.test.ts`).
- Banner on every page: **Prototype — fictional test data.**

### Main routes

`/`, `/claims`, `/claims/new`, `/claims/[id]`, `/claims/[id]/work/[screen]`, `/claims/[id]/hire-pack`, `/tasks`, `/hire`, `/documents`, `/documents/[id]`, `/communications`, `/financials`, `/automations`, `/litigation`, `/settings`, `/settings/staff` (administrators only), `/login`.

### Database tables (schema)

`settings`, `staff`, `people`, `vehicles`, `fleet_vehicles`, `claims`, `claim_parties`, `claim_third_parties`, `notes`, `tasks`, `reservations`, `hire_episodes`, `agreements`, `handovers`, `financial_lines`, `correspondence`, `documents`, `claim_events`, `automations`, `litigation`, `mid_lookups`, `claim_witnesses`, `recovery_jobs`, `vehicle_compliance_checks`, `claim_screen_data`, `audit_log`, plus `hire_pack_data` created by migration.

### Tests covering behavioural rules

`tests/rules.test.ts`, `intake.test.ts`, `screens.test.ts`, `letters.test.ts`, `hire-pack.test.ts`, `seed.test.ts`, `text.test.ts`, `postcode.test.ts`, `auth.test.ts`, `dates-age.test.ts`, `staff-admin.test.ts`. These check hire/reservation/agreement rules, intake mapping, letter generation, postcode mapping, accident/DOB rules and staff roles — **not** live mailbox, DVLA or PAF.

---

## Files future sessions should open first

| File | Why |
| --- | --- |
| `docs/CAS-Claude-Code-Build-Brief.md` | Requirements (source of truth) |
| `docs/architecture.md` | Stack and date/money rules |
| `docs/DEPENDENCIES.md` | What CAS still has to supply (accounts, templates, keys) |
| `docs/progress.md` | Short running log of earlier build steps (less complete than this snapshot) |
| `docs/STATUS-REPORT.md` | This inspection |
| `CLAUDE.md` | Instructions for coding sessions |
| `README.md` | How to open the prototype (slightly stale on postcode: it still says lookups are not connected; free postcode **is** wired) |
| `src/lib/db/schema.sql` | Data model |
| `src/lib/db/seed.ts` | Fictional TEST files |
| `src/lib/db/queries.ts` | Dashboard counts |
| `src/lib/claim-screens.ts` | File screen definitions |
| `src/app/actions.ts` | All server writes |
| `src/lib/lookups/postcode.ts` | Free vs Ideal Postcodes |
| `src/lib/email/gateway.ts` (and whatsapp/phone) | Simulated sending |

### Git

Initial commit of the prototype as it stood: see repository `git log`. Staff login was added in a later commit.

---

## What is still blocked on CAS (not on more screens)

From `docs/DEPENDENCIES.md` and this inspection:

1. Shared office hosting and per-file / role permissions (local staff login is in `docs/AUTH-NOTES.md`).
2. Licensed postcode key if house-level drop-downs are required (`IDEAL_POSTCODES_API_KEY`).
3. Vehicle lookup provider (not keeper identification).
4. Office mailbox, WhatsApp Business, telephone system.
5. Real CAS letter / agreement Word templates and e-sign.
6. Confirm 88 vs 89 day hire maximum, 3 calendar-day chaser vs business days, production file-number format, storage billing-end practice.
7. Hosting and backups — do not purchase during prototype work.

---

## Bottom line for “can I start entering client details?”

You can enter **fictional** client details and they will be saved on this PC. You should **not** enter real clients until there is login, backup, and a decision that this database is the office record.

The dashboard numbers you see today are **real counts of saved records**. On a new install those records are the twelve TEST files. They are sample data, but they are stored in the database, not painted onto the screen.

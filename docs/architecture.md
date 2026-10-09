# Architecture

## Why this stack

Justin needs a maintainable system on a Windows PC, without buying hosting yet. The machine had Git but not Node or Python. Node.js 24 LTS was installed with winget so the CRM can run locally in a browser.

- **Next.js** — one codebase for screens and server logic.
- **SQLite via Node’s built-in `node:sqlite`** — persistent file database, no separate database server, no Visual Studio build tools.
- **Database location** — `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite` so OneDrive cannot lock it.
- **Stored files** — `%LOCALAPPDATA%\CAS-CRM\files`. Each file is a `documents` row (type tag such as V5C, original filename, link to a vehicle and/or a claim).
- **Tailwind CSS** — layout without a separate design kit.

PostgreSQL can replace SQLite later if CAS hosts a shared office server. Lookup, email and WhatsApp sit behind adapter interfaces so providers can change.

## Date and money rules

- Store timestamps as ISO-8601 UTC text.
- Display in Europe/London, including BST. Calendar “today” and “now” for validation and alerts use `Europe/London` (`londonTodayIso` / `londonNow`), not the server’s default timezone.
- Accident dates cannot be after today’s London date.
- Store money as integer pence. Display with `en-GB` currency formatting.
- Never add claimed + agreed, or treat offered as received.

## Key modules

- `src/lib/domain/rules.ts` — hire, reservation, chaser and agreement rules (tested). Engineer and hire-pack payment chases share the same stop/reset pattern.
- `src/lib/documents/` — CAS letter/email wording (`cas-wording.ts`), Hire Pack terms (`cas-hire-terms.ts`, not invented).
- `src/lib/lookups/` — postcode lookup uses free postcodes.io and OpenStreetMap; vehicle lookup remains simulated.
- `src/lib/db/` — schema, seed, queries, claim screen persistence (`claim_screen_data`).
- Financial circumstances, the impecuniosity checklist and mitigation statements are dated rows on the claim (`financial_circumstances`, `impecuniosity_accounts`, `impecuniosity_checklist_events`, `impecuniosity_concerns`, `impecuniosity_approvals`, `mitigation_statements`). A change adds a row. It does not update the earlier one. Checklist status is the latest handler-set event, not a count of files. The listed evidence set is every bank account for the relevant period, wage slips or a benefit schedule, household commitments, and other income or support. Impecuniosity evidence files use the existing `documents` table with type `impecuniosity_evidence`. The disclosure letter and an email that asserts impecuniosity are refused unless the checklist is Complete and an administrator has approved relying on it. That approval is not a decision that the charges can be recovered. The background note is `docs/impecuniosity-legal-research.md`. There is no client portal for this section. Two simultaneous saves are last-write-wins, the same as the rest of the claim record. The screen says so.
- Pre-hire checks are separate from that gate. Before `generateHireAgreementDocument` allocates an agreement number or inserts the document, it refuses unless every person who will drive the hire vehicle has a staff-entered licence check, and the file has either a bank account listed on Financial circumstances (`impecuniosity_accounts.kind = bank_account`) or a saved no-bank explanation on the latest financial-circumstances row. The checklist does not need to be Complete, and impecuniosity approval is not required. There is no administrator override and no approve-anyway. Uploaded impecuniosity files are not labelled as bank statements, so a file on its own does not satisfy the bank half. There is no second upload area; bank statements stay on Financial circumstances. Licence checks are rows in `licence_checks`: the check code, categories, points and endorsements, expiry, the date checked, and who recorded it, typed from the free gov.uk/check-driving-licence lookup. The CRM does not call DVLA. Automated checking is only if CAS later secures bulk DVLA access. A check older than 21 days (the demonstration window, not a DVLA ruling) still counts as recorded. The handover screen shows a stale warning and does not stop. Drivers are party role `driver`, anyone named on Client driver details, and additional drivers named on the hire pack or Additional drivers. An owner, hirer or client who is not one of those is not included. If nobody is recorded as a driver, the client is included. A stored licence number is not the check. There is no separate preview-for-signing or mark-ready-to-sign step; generating the agreement is the step that files it, and it stays unsigned.
- `src/app/` — screens. Server actions write to SQLite. Each claim file has a right-hand viewing pane of operational screens taken from the current CRM.

## Security posture

Staff must sign in. Passwords are stored hashed in SQLite. Sessions use an HTTP-only cookie. Roles are `administrator` or `staff`. Only an administrator can manage staff logins (`/settings/staff`). Anyone who is signed in can currently see every file — there are no per-claim permissions yet. The database still lives on this PC only.

Driving licence numbers are labelled restricted in the UI; that is not yet a separate access level.

Do not put live client data into this prototype until backups and permission levels are agreed.

Microsoft 365 mail for this app is limited to `claims@cascar.co.uk` (2 October 2026). The app registration `6979ea43-e90c-4dba-a3d0-92d0047d9b6a` has an Exchange Online application access policy, RestrictAccess, scoped to the mail-enabled security group **CAS CRM claims mailbox**. That group exists only because the claims address is a shared mailbox, which cannot be the policy scope by itself. Its only member is `claims@cascar.co.uk`. A send or read failure on another mailbox is the restriction working. Do not remove the policy, and do not add other mailboxes to the group, to widen it.

Demonstration usernames and passwords: `docs/AUTH-NOTES.md`.

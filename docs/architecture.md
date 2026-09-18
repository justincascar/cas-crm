# Architecture

## Why this stack

Justin needs a maintainable system on a Windows PC, without buying hosting yet. The machine had Git but not Node or Python. Node.js 24 LTS was installed with winget so the CRM can run locally in a browser.

- **Next.js** — one codebase for screens and server logic.
- **SQLite via Node’s built-in `node:sqlite`** — persistent file database, no separate database server, no Visual Studio build tools.
- **Database location** — `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite` so OneDrive cannot lock it.
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
- `src/app/` — screens. Server actions write to SQLite. Each claim file has a right-hand viewing pane of operational screens taken from the current CRM.

## Security posture

Staff must sign in. Passwords are stored hashed in SQLite. Sessions use an HTTP-only cookie. Roles are `administrator` or `staff`. Only an administrator can manage staff logins (`/settings/staff`). Anyone who is signed in can currently see every file — there are no per-claim permissions yet. The database still lives on this PC only.

Driving licence numbers are labelled restricted in the UI; that is not yet a separate access level.

Do not put live client data into this prototype until backups and permission levels are agreed.

Demonstration usernames and passwords: `docs/AUTH-NOTES.md`.

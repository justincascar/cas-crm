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
- Display in Europe/London, including BST.
- Store money as integer pence. Display with `en-GB` currency formatting.
- Never add claimed + agreed, or treat offered as received.

## Key modules

- `src/lib/domain/rules.ts` — hire, reservation, chaser and agreement rules (tested).
- `src/lib/lookups/` — postcode lookup uses free postcodes.io and OpenStreetMap; vehicle lookup remains simulated.
- `src/lib/db/` — schema, seed, queries, claim screen persistence (`claim_screen_data`).
- `src/app/` — screens. Server actions write to SQLite. Each claim file has a right-hand viewing pane of operational screens taken from the current CRM.

## Security posture (Stage 1)

There is **no real login** yet. Anyone who can open http://localhost:3000 on this PC can see the fictional files. Stage 2 adds staff accounts, permissions, and client isolation on the server. Driving licence numbers are stored but the UI marks them restricted; that is not yet access-controlled.

Do not put live client data into this prototype.

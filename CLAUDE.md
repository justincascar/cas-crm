# CAS CRM — instructions for future coding sessions

This is the Complete Accident Solutions Ltd claims CRM. The owner is Justin Roberts (solicitor, MD, South Wales). He is not a software developer. Use British English, GBP, UK dates (dd/MM/yyyy) and Europe/London. Do not invent credentials, signatures, agreement terms, case law or successful integrations.

## Source of truth

- Requirements: `docs/CAS-Claude-Code-Build-Brief.md`
- Architecture: `docs/architecture.md`
- Progress: `docs/progress.md`
- Dependencies still needed from CAS: `docs/DEPENDENCIES.md`

Follow the brief. Do not stop at mock-ups. Stage 1 is a working dashboard with persistent TEST claims. Later stages add real staff login, live lookups, live sending and litigation packs.

## How to run

From `CAS-CRM`:

```
npm test
npm run dev
```

Open http://localhost:3000. The SQLite database lives in `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite` (not OneDrive). Delete that file to reseed fictional data.

## Architecture defaults already chosen

- Next.js App Router (Node 24), TypeScript, Tailwind.
- SQLite via `node:sqlite` (no extra native build tools).
- Money as integer pence. Dates as ISO UTC text, displayed in Europe/London.
- Lookup providers behind adapters; current implementations are labelled simulated.
- Demonstration file prefix `TEST-`. Agreement max 88 days, renewal alert day 80, engineer chaser 3 calendar days (labelled demonstration setting).
- Each file has a dated chronology. Letters are generated from those dates. Email is filed against the claim; live mailbox send/receive is simulated until CAS's provider is connected.

## Behaviour that must not regress

- Opening a claim or reserving a vehicle does not start hire/storage charges.
- Fault courtesy is not credit hire.
- Overlapping fleet allocations, including staff bookings, are blocked.
- Repairable hire ends only after repairs complete AND the repaired vehicle is returned.
- Total-loss off-hire countdown starts only after a handler-confirmed qualifying payment, then +7 days.
- Storage billing end is an explicit date, not an invented grace period.
- Offers are not receipts. Do not add claimed and agreed together.
- Unsigned renewals stay unsigned. Never fabricate a signature or backdate.
- Unauthorised sending is blocked in this prototype. Failed integrations must show failure.

## What not to do

- Do not purchase hosting, connect live email/WhatsApp, or deploy publicly during prototype development.
- Do not scrape MID or assume a vehicle lookup identifies the keeper.
- Do not infer transmission from incomplete lookup results.
- Do not generate a letter before action without specific approval.
- Garage/MOT expansion is allowed later; do not block claims work on it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

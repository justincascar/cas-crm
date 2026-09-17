# CAS CRM — how to open it

This is a working prototype of the Complete Accident Solutions claims system. It uses **fictional test data only**. It does not send real emails or WhatsApp messages and it does not connect to live insurance databases.

## Open the system

1. Make sure this folder is `CAS-CRM`.
2. Double-click `Start-CAS-CRM.bat`, **or** open a terminal in this folder and type `npm run dev`.
3. In your browser, go to **http://localhost:3000**. You will be asked to sign in.
4. Use a demonstration username and password from `docs/AUTH-NOTES.md` (fictional only).
5. Leave the terminal window open while you use it. Close that window (or press Ctrl+C) when you have finished.

The first time this project was set up, Node.js was installed so the computer can run the website locally. You do not need to install anything else for ordinary use.

## What you should see

- A sign-in screen. Without signing in, claim lists and file pages are not shown.
- After sign-in, a banner: **Prototype — fictional test data**, and **Logged in as [name] — Log out**.
- Dashboard counts. Click a count to open the matching files.
- Twelve files numbered **TEST-0001** to **TEST-0012**.
- Search by file number, client name, registration or insurer reference.
- Open a file, edit details, add a note or a task. Close the browser, open it again — the change should still be there.

Your data is saved on this PC at:

`C:\Users\JustinRoberts\AppData\Local\CAS-CRM\cas-crm.sqlite`

It is kept there on purpose, not in OneDrive, because OneDrive can lock the file. To reset the fictional examples, delete that file and start the system again.

## Quick checks (about 10 minutes)

1. Dashboard loads and shows counts.
2. Click **New enquiries / incomplete forms** — TEST-0001 should appear.
3. Search `CF64 DLE` — TEST-0002 (Bethan Lewis).
4. Open TEST-0002: roadworthy, reservation, **charges started = no**.
5. Open TEST-0003: undriveable, recovery and hire already running.
6. Open TEST-0004: fault courtesy, **credit hire = no**.
7. Open TEST-0008: repairs complete, customer not yet returned, hire still on.
8. Open TEST-0011: unsigned renewal, not marked signed.
9. Open TEST-0012: offer awaiting review, not treated as paid; court issue not approved.
10. Hire / Fleet: try to reserve a vehicle that is already allocated for the same dates — it should refuse.
11. Add a note on any file, refresh the page, confirm it remains.

## Not connected yet

Live vehicle/MID lookups, live email, WhatsApp, electronic signing, CAS letter templates. Staff sign-in is in place locally (see `docs/AUTH-NOTES.md`); finer permissions and a shared office server are not. See `docs/DEPENDENCIES.md`.

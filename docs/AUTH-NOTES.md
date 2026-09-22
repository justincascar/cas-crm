# Staff login (demonstration)

Inspected and added 17 September 2026.

## How it works

Staff sign in on `/login` with a **username and password**. The server checks the password against a **hash** stored in the local SQLite `staff` table (not plain text). A session token is stored in an HTTP-only cookie (`cas_session`) and in a `sessions` table. Closing the browser tab and refreshing keeps you signed in until you log out or the session expires (7 days).

Every claims desk page, and every server action that reads or writes claim, client, fleet or financial data, checks that session **on the server**. Hitting a claim URL while logged out redirects to login. A request without a valid cookie does not receive that data.

The four demonstration people are the same handler names already on the TEST files: Justin Roberts, Sian Evans, Tom Hughes, Megan Price.

**Roles:** Justin Roberts (managing director) is an **administrator**. Sian, Tom and Megan are **staff**. Administrator and staff can open every file. Two further demonstration logins are restricted on the server, not only in the menu:

- **Driver** (`driver`) can open My jobs today and complete a handover (mileage, fuel, photographs) on a booking assigned to them for today. A direct address such as `/financials` or another claim is refused.
- **Bodyshop / mechanic** (`mechanic`) can open My jobs today and add repair photographs, pre/post diagnostic scans and a geometry report on a repair assigned to them for today. Nothing else on the claim.

An administrator creates, disables and resets every login, including these two roles, at **Settings → Manage staff logins**.

## Demonstration usernames and passwords

These are **fictional** and only for this prototype on this PC. They are not CAS office passwords. Do not reuse them for email, banking or live systems.

| Name | Username | Password |
| --- | --- | --- |
| Justin Roberts | `justin` | `CasDemo.Justin` |
| Sian Evans | `sian` | `CasDemo.Sian` |
| Tom Hughes | `tom` | `CasDemo.Tom` |
| Megan Price | `megan` | `CasDemo.Megan` |
| Demo Driver | `driver` | `CasDemo.Driver` |
| Demo Mechanic | `mechanic` | `CasDemo.Mechanic` |

On a fresh database, or an older database that had staff rows but no passwords, these hashes are created automatically when the app starts.

To use different demonstration passwords without changing the code, put them in `.env.local` (that file is gitignored):

```
CAS_DEMO_PASSWORD_JUSTIN=...
CAS_DEMO_PASSWORD_SIAN=...
CAS_DEMO_PASSWORD_TOM=...
CAS_DEMO_PASSWORD_MEGAN=...
CAS_DEMO_PASSWORD_DRIVER=...
CAS_DEMO_PASSWORD_MECHANIC=...
```

Then delete the SQLite file (or clear `password_hash` on staff) so the new hashes can be written. Existing hashes are not overwritten on every start.

## What this stage does not do

- **Still one PC only.** This is not a shared office server. Another computer cannot sign in to this database.
- **Administrator and staff still see every file.** Driver and mechanic do not. There is still no per-file permission inside the office roles. Handler is still a field on the file, not an access wall.
- Email, WhatsApp and vehicle lookup remain simulated. Vehicle details can always be typed by hand.

Those two limits (shared hosting / per-file permissions) are the next access-control jobs, not this one.

## Log out

Use **Log out** next to “Logged in as [name]” in the top bar.

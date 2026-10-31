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

## Login security (J15, 30 October 2026)

- **Lockout.** After 5 failed attempts a username is locked for 15 minutes, even with the right password. An administrator resetting the password unlocks it. Every attempt is in the audit view.
- **Sign-out after inactivity.** A session ends after 30 minutes without use (Settings → Manage staff logins → Sign-in security; 5 to 480 minutes). Using any page keeps it alive.
- **Strong passwords.** A new or reset password needs at least 12 characters using three of: lower case, capitals, numbers, symbols; not the username or a common word. The demonstration passwords above are unchanged.
- **Authenticator app.** Required for an administrator (Justin): at his next sign-in the CRM shows a key to add to Microsoft Authenticator, Google Authenticator or similar, then asks for a six-digit code each time. Staff can switch one on in Settings → Your sign-in. A lost phone: Settings → Manage staff logins → Reset (lost phone); the person sets it up again at their next sign-in. Justin's was reset after the J15 walk-through, so he sets it up with his own phone.
- **How Justin sets up his authenticator (R47).** Sign in as `justin` with his password. The CRM shows "Set up your authenticator app" with a key. On his phone, open Microsoft Authenticator (or Google Authenticator), add an account, choose to enter a key, name it "CAS CRM" and type the key (or, on the phone, tap the link to open it in the app). Type the six-digit code the app shows and press "Switch it on and continue". From then on each sign-in asks for the newest code. If he leaves the set-up page without finishing, nothing is switched on: the next sign-in shows a new key, the earlier key is thrown away, and a code from the earlier key is refused. Delete any "CAS CRM" entry made from an earlier key on the phone.
- **The other demo logins (`sian`, `tom`, `megan`, `driver`, `mechanic`) do not ask for an authenticator code.** That is intended for now: it is required for an administrator only, and optional for everyone else (Settings → Your sign-in). Whether every member of staff must use one before live use is question 29.
- **Microsoft 365 single sign-on** is shown as "not connected yet". Sign-in goes through a provider list and staff rows carry the provider and an external id, so it can be added beside the local login without a rewrite. Connecting it needs CAS's Microsoft admin set-up.
- **Cross-site posts** are refused: a form post must come from the CRM's own pages.
- The page check runs on a copy of this PC's database, so its sign-in as Justin never touches Justin's own authenticator.

## What this stage does not do

- **Still one PC only.** This is not a shared office server. Another computer cannot sign in to this database.
- **Administrator and staff still see every file.** Driver and mechanic do not. There is still no per-file permission inside the office roles. Handler is still a field on the file, not an access wall.
- Email, WhatsApp and vehicle lookup remain simulated. Vehicle details can always be typed by hand.

Those two limits (shared hosting / per-file permissions) are the next access-control jobs, not this one.

## Log out

Use **Log out** next to “Logged in as [name]” in the top bar.

# Backing up and restoring the CRM on this PC

The CRM keeps two things on this PC, outside OneDrive:

- the database: `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite`
- the stored documents: `%LOCALAPPDATA%\CAS-CRM\files`

A backup copies both into one dated folder. A restore copies a chosen backup into a **separate** folder so you can check it. It never writes over the live CRM.

## Make a backup

1. Open a terminal in the `CAS-CRM` folder (the one with `package.json`).
2. Type:

   ```
   npm run backup
   ```

   It is safe to do this while the CRM is open.
3. It says where the backup went, for example
   `C:\Users\...\AppData\Local\CAS-CRM\backups\cas-crm-backup-2026-10-30-140512`.

To put the backup somewhere else, such as a USB drive, name the folder after a double dash:

```
npm run backup -- "E:\CAS backups"
```

Each backup folder holds:

- `cas-crm.sqlite`: a complete copy of the database
- `files`: every stored document
- `manifest.json`: the number of rows in each table and a fingerprint of each table, so a restore can be checked

**Keep backups off this PC as well.** A backup on the same disk does not help if the disk fails. Copy the backup folder to a USB drive or another computer regularly.

## Check a backup by restoring it into a test copy

1. In the same terminal, type `npm run restore --` followed by the backup folder in quotes:

   ```
   npm run restore -- "C:\Users\...\AppData\Local\CAS-CRM\backups\cas-crm-backup-2026-10-30-140512"
   ```

2. It copies the backup into a new folder named `restore-test-...` beside the live CRM folder, then checks the copy against the backup's manifest.
3. If it says **"The restored copy matches the backup"**, the backup is good. If it lists differences, do not rely on that backup and make a new one.

To choose the test folder yourself, name an empty folder after the backup folder:

```
npm run restore -- "<backup folder>" "D:\restore-check"
```

The restore refuses to write into the live CRM folder, or into a folder that already has a database in it.

## Actually going back to a backup (only if the live data is lost or damaged)

This replaces the live data, so do it carefully and only when needed. If in doubt, ask before doing it.

1. Close the CRM (stop `npm run dev` or the CRM window).
2. Make a backup of the current state first, even if it is damaged: `npm run backup`.
3. Restore the backup you want into a test copy, as above, and check that it says it matches.
4. In File Explorer, rename the live `%LOCALAPPDATA%\CAS-CRM\cas-crm.sqlite` to `cas-crm.sqlite.old`. Also delete `cas-crm.sqlite-wal` and `cas-crm.sqlite-shm` if they are there, and rename the live `files` folder to `files.old`.
5. Copy `cas-crm.sqlite` and the `files` folder from the test copy into `%LOCALAPPDATA%\CAS-CRM`.
6. Start the CRM and open a few files to check them.
7. Keep the `.old` copies until you are sure.

## Tested

`tests/j12-foundations.test.ts` makes a backup, changes the live data, restores into a separate folder, and checks that the restored copy matches the backup (every table and document) and not the later changes.

## Full export (Justin only)

Settings → **Full export and audit** → **Download the full export** gives one zip: a CSV file for every table and every stored document. Passwords and sign-in sessions are left out. This is a readable copy of everything, for keeping or for moving to another system. It is not a backup the CRM can restore from; use `npm run backup` for that.

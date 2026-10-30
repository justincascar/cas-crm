/**
 * Makes a dated backup of the CRM database and stored documents on this PC.
 *
 *   npm run backup                       → into %LOCALAPPDATA%\CAS-CRM\backups
 *   npm run backup -- "D:\CAS backups"   → into the folder you name (for example a USB drive)
 *
 * Safe while the CRM is running. See docs/BACKUP-AND-RESTORE.md.
 */
import path from "node:path";
import { makeBackup } from "../src/lib/ops/backup.ts";

const home = process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
const databasePath = process.env.DATABASE_PATH || path.join(home, "CAS-CRM", "cas-crm.sqlite");
const filesRoot = process.env.CAS_FILES_DIR || path.join(home, "CAS-CRM", "files");
const backupsRoot = process.argv[2] || path.join(home, "CAS-CRM", "backups");

try {
  const folder = makeBackup({ databasePath, filesRoot, backupsRoot });
  console.log(`Backup made: ${folder}`);
  console.log("It holds cas-crm.sqlite, the files folder and manifest.json (row counts and fingerprints).");
} catch (error) {
  console.error(`The backup was not made. ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

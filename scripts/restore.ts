/**
 * Restores a chosen backup into a separate test copy. It never writes over the live CRM database.
 *
 *   npm run restore -- "C:\...\CAS-CRM\backups\cas-crm-backup-2026-10-30-140512"
 *   npm run restore -- "<backup folder>" "<empty folder for the test copy>"
 *
 * Then it checks the copy against the backup's manifest and says whether it matches. See docs/BACKUP-AND-RESTORE.md.
 */
import path from "node:path";
import { restoreBackup } from "../src/lib/ops/backup.ts";

const home = process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
const liveDatabasePath = process.env.DATABASE_PATH || path.join(home, "CAS-CRM", "cas-crm.sqlite");
const backupFolder = process.argv[2];
if (!backupFolder) {
  console.error("Name the backup folder to restore, for example: npm run restore -- \"C:\\...\\cas-crm-backup-2026-10-30-140512\"");
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetFolder = process.argv[3] || path.join(home, "CAS-CRM", `restore-test-${stamp}`);

try {
  const problems = restoreBackup({ backupFolder, targetFolder, liveDatabasePath });
  console.log(`Restored into: ${targetFolder}`);
  if (problems.length === 0) {
    console.log("The restored copy matches the backup: every table has the same rows and contents, and every document is there.");
  } else {
    console.error(`The restored copy does not match the backup:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Nothing was restored. ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

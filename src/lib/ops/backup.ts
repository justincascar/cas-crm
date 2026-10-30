import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Backup and restore on this PC (J12). A backup is a dated folder with a consistent copy of the database
 * (VACUUM INTO, safe while the CRM is running), a copy of every stored document, and a manifest of row counts and a
 * fingerprint of each table. A restore copies a chosen backup into a separate folder, never over the live database.
 * docs/BACKUP-AND-RESTORE.md has the step-by-step instructions.
 */

export type Manifest = {
  madeAt: string;
  tables: Record<string, { rows: number; sha256: string }>;
  documents: number;
};

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Row count and a fingerprint of every table, so a restore can be checked against the backup. */
export function tableFingerprints(db: DatabaseSync): Record<string, { rows: number; sha256: string }> {
  const out: Record<string, { rows: number; sha256: string }> = {};
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    out[name] = { rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return out;
}

function copyFolder(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) count += copyFolder(source, target);
    else if (item.isFile()) {
      fs.copyFileSync(source, target);
      count += 1;
    }
  }
  return count;
}

/** Makes a dated backup folder inside backupsRoot and returns its path. */
export function makeBackup(input: { databasePath: string; filesRoot: string; backupsRoot: string; when?: Date }): string {
  const when = input.when || new Date();
  const folder = path.join(input.backupsRoot, `cas-crm-backup-${stamp(when)}`);
  if (fs.existsSync(folder)) throw new Error(`A backup folder with this time already exists: ${folder}`);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, "cas-crm.sqlite");
  const live = new DatabaseSync(input.databasePath);
  try {
    live.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    live.close();
  }
  const documents = copyFolder(input.filesRoot, path.join(folder, "files"));
  const copy = new DatabaseSync(target, { readOnly: true });
  let tables: Manifest["tables"];
  try {
    tables = tableFingerprints(copy);
  } finally {
    copy.close();
  }
  const manifest: Manifest = { madeAt: when.toISOString(), tables, documents };
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  return folder;
}

/**
 * Copies a backup into targetFolder: cas-crm.sqlite and files/. Refuses to write over the live database. Returns the
 * differences between the restored copy and the backup's manifest; an empty list means it matches.
 */
export function restoreBackup(input: { backupFolder: string; targetFolder: string; liveDatabasePath?: string }): string[] {
  const manifestPath = path.join(input.backupFolder, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("That folder is not a CRM backup: there is no manifest.json.");
  const target = path.resolve(input.targetFolder);
  if (input.liveDatabasePath && path.resolve(path.dirname(input.liveDatabasePath)) === target) {
    throw new Error("Restore into a separate folder, not the live CRM folder. Nothing was copied.");
  }
  const restoredDb = path.join(target, "cas-crm.sqlite");
  if (fs.existsSync(restoredDb)) throw new Error(`There is already a database in ${target}. Choose an empty folder. Nothing was copied.`);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(input.backupFolder, "cas-crm.sqlite"), restoredDb);
  copyFolder(path.join(input.backupFolder, "files"), path.join(target, "files"));
  return compareWithManifest(restoredDb, path.join(target, "files"), JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest);
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, item) => total + (item.isDirectory() ? countFiles(path.join(dir, item.name)) : item.isFile() ? 1 : 0), 0);
}

export function compareWithManifest(databasePath: string, filesFolder: string, manifest: Manifest): string[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const now = tableFingerprints(db);
    const problems: string[] = [];
    for (const [table, expected] of Object.entries(manifest.tables)) {
      const found = now[table];
      if (!found) problems.push(`${table} is missing`);
      else if (found.rows !== expected.rows) problems.push(`${table} has ${found.rows} rows, the backup had ${expected.rows}`);
      else if (found.sha256 !== expected.sha256) problems.push(`${table} has different contents from the backup`);
    }
    const files = countFiles(filesFolder);
    if (files !== manifest.documents) problems.push(`${files} documents, the backup had ${manifest.documents}`);
    return problems;
  } finally {
    db.close();
  }
}

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected table name ${name}.`);
  return `"${name}"`;
}

/** A hash of every row. node:sqlite rows are null-prototype, so fields are read by name. */
export function databaseFingerprint(db: DatabaseSync): Map<string, string> {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>;
  const out = new Map<string, string>();
  for (const table of tables) {
    const name = String(table.name);
    const quoted = quoteIdentifier(name);
    const columns = db.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{ name: string; pk: number }>;
    const primary = columns
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => String(column.name));
    const rows = db.prepare(`SELECT rowid AS __rowid, * FROM ${quoted} ORDER BY rowid`).all() as Array<Record<string, string | number | bigint | null | undefined>>;
    for (const row of rows) {
      const keyParts = primary.length > 0 ? primary.map((column) => String(row[column] ?? "")) : [String(row.__rowid ?? "")];
      const payload = columns.map((column) => `${String(column.name)}=${row[String(column.name)] ?? ""}`).join("\n");
      out.set(`${name}:${keyParts.join("|")}`, createHash("sha256").update(payload).digest("hex"));
    }
  }
  return out;
}

/** Names rows that were added, removed or changed. An empty list means the database is unchanged. */
export function fingerprintChanges(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  for (const [key, hash] of after) {
    if (!before.has(key)) changes.push(`added ${key}`);
    else if (before.get(key) !== hash) changes.push(`changed ${key}`);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changes.push(`removed ${key}`);
  }
  changes.sort();
  return changes;
}

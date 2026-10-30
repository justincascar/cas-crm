import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readZip, writeZip } from "./zip";

/**
 * The full export (J12): every table as a CSV file, plus every stored document, in one zip. Sign-in secrets are left
 * out: the sessions table and the staff password hashes. Everything else is exported as it is held.
 */

const LEFT_OUT_TABLES = new Set(["sessions", "submit_keys"]);
const LEFT_OUT_COLUMNS: Record<string, string[]> = { staff: ["password_hash"] };

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Reads a CSV written by toCsv back into rows of text. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function exportTables(db: DatabaseSync): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => !LEFT_OUT_TABLES.has(name));
}

function filesUnder(root: string, dir = ""): string[] {
  const here = path.join(root, dir);
  if (!fs.existsSync(here)) return [];
  const out: string[] = [];
  for (const item of fs.readdirSync(here, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...filesUnder(root, rel));
    else if (item.isFile()) out.push(rel);
  }
  return out;
}

export type ExportSummary = { tables: Record<string, number>; documents: number };

export function buildFullExport(db: DatabaseSync, filesRoot: string, when = new Date()): { zip: Buffer; summary: ExportSummary } {
  const entries: Array<{ name: string; data: Buffer }> = [];
  const tables: Record<string, number> = {};
  for (const table of exportTables(db)) {
    const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
      .map((column) => column.name)
      .filter((column) => !(LEFT_OUT_COLUMNS[table] || []).includes(column));
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
    tables[table] = rows.length;
    entries.push({ name: `tables/${table}.csv`, data: Buffer.from(toCsv(columns, rows), "utf8") });
  }
  const documents = filesUnder(filesRoot);
  for (const rel of documents) entries.push({ name: `documents/${rel}`, data: fs.readFileSync(path.join(filesRoot, rel)) });
  const summary: ExportSummary = { tables, documents: documents.length };
  const readme = [
    "Complete Accident Solutions CRM — full export",
    `Made: ${when.toISOString()}`,
    "",
    "tables/ has one CSV file per table. The first line of each is the column names. Money is in pence. Dates are UTC.",
    "documents/ has every stored document, in the same folders as on the CRM's computer.",
    "Left out on purpose: the sessions table and the staff password hashes.",
    "",
    ...Object.entries(tables).map(([table, count]) => `${table}: ${count} rows`),
    `documents: ${documents.length} files`,
  ].join("\r\n");
  entries.unshift({ name: "README.txt", data: Buffer.from(readme, "utf8") });
  return { zip: writeZip(entries, when), summary };
}

/** Reads an export back and checks it against its own README counts. Returns the rows per table. */
export function readFullExport(zip: Buffer): { tables: Record<string, string[][]>; documents: Map<string, Buffer> } {
  const files = readZip(zip);
  const tables: Record<string, string[][]> = {};
  const documents = new Map<string, Buffer>();
  for (const [name, data] of files) {
    if (name.startsWith("tables/") && name.endsWith(".csv")) tables[name.slice(7, -4)] = parseCsv(data.toString("utf8"));
    else if (name.startsWith("documents/")) documents.set(name.slice(10), data);
  }
  const readme = files.get("README.txt")?.toString("utf8") || "";
  for (const [table, rows] of Object.entries(tables)) {
    const stated = readme.match(new RegExp(`^${table}: (\\d+) rows`, "m"));
    if (!stated || Number(stated[1]) !== rows.length - 1) throw new Error(`${table} does not match the README count.`);
  }
  return { tables, documents };
}

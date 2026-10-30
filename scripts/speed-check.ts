/**
 * J12: 1,000 fictional claims in a separate test database, then the dashboard, the claims list and a claim page are
 * each timed. Each must open in under 2 seconds.
 *
 * From CAS-CRM, after a production build:
 *   npm run check:speed
 *
 * The extra claims are copies of the seeded TEST files (with their history, money and hire), under new TEST
 * references. The demonstration database is not used.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { freePort, passwordFor, signIn, stopTree, waitUntilReady } from "./journey-check.ts";

const TARGET_CLAIMS = 1000;
const LIMIT_MS = 2000;

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** Copies the seeded claims, with their child rows, until there are TARGET_CLAIMS claims. */
function fillClaims(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = OFF;");
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  db.exec(schema);
  migrate(db);
  seed(db);
  const sources = (db.prepare(`SELECT id FROM claims ORDER BY file_reference`).all() as Array<{ id: string }>).map((r) => r.id);
  const claimCols = columns(db, "claims");
  const childTables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((name) => name !== "claims" && columns(db, name).includes("claim_id") && columns(db, name).includes("id"));
  let count = Number((db.prepare(`SELECT COUNT(*) AS n FROM claims`).get() as { n: number }).n);
  let serial = 5000;
  db.exec("BEGIN");
  while (count < TARGET_CLAIMS) {
    for (const source of sources) {
      if (count >= TARGET_CLAIMS) break;
      serial += 1;
      const newId = `speed-${serial}`;
      const others = claimCols.filter((c) => c !== "id" && c !== "file_reference");
      db.prepare(
        `INSERT INTO claims(id, file_reference, ${others.join(", ")}) SELECT ?, ?, ${others.join(", ")} FROM claims WHERE id = ?`,
      ).run(newId, `TEST-${serial}`, source);
      for (const table of childTables) {
        const cols = columns(db, table).filter((c) => c !== "id" && c !== "claim_id");
        db.prepare(
          `INSERT INTO "${table}"(id, claim_id${cols.length ? `, ${cols.join(", ")}` : ""})
           SELECT id || '-' || ?, ?${cols.length ? `, ${cols.join(", ")}` : ""} FROM "${table}" WHERE claim_id = ?`,
        ).run(String(serial), newId, source);
      }
      count += 1;
    }
  }
  db.exec("COMMIT");
  db.close();
  return count;
}

async function timed(origin: string, cookie: string, address: string): Promise<{ ms: number; status: number; path: string }> {
  const started = performance.now();
  const response = await fetch(`${origin}${address}`, { headers: { cookie }, redirect: "follow" });
  await response.text();
  return { ms: Math.round(performance.now() - started), status: response.status, path: new URL(response.url).pathname };
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build first.");
    process.exitCode = 1;
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-speed-"));
  const dbPath = path.join(dir, "cas-crm.sqlite");
  const made = fillClaims(dbPath);
  console.log(`Test database: ${made} fictional claims.`);
  const port = await freePort(3500);
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: dbPath, CAS_FILES_DIR: path.join(dir, "files"), EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let failed = 0;
  try {
    await waitUntilReady(origin, child);
    const cookie = await signIn(origin, "sian", passwordFor("Sian Evans", "sian"));
    const pages = [
      { label: "Claims desk (dashboard)", address: "/" },
      { label: "All claims", address: "/claims" },
      { label: "A claim page", address: "/claims/speed-5500" },
    ];
    for (const page of pages) {
      await timed(origin, cookie, page.address); // the first request after start-up prepares the database
      const runs = [await timed(origin, cookie, page.address), await timed(origin, cookie, page.address), await timed(origin, cookie, page.address)];
      const slowest = Math.max(...runs.map((r) => r.ms));
      const ok = runs.every((r) => r.status === 200 && r.path === page.address) && slowest < LIMIT_MS;
      if (!ok) failed += 1;
      console.log(`${ok ? "PASS" : "FAIL"}  ${page.label}: ${runs.map((r) => `${r.ms} ms`).join(", ")} (limit ${LIMIT_MS} ms)${runs[0].path !== page.address ? ` — ended on ${runs[0].path}` : ""}`);
    }
  } catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : "The speed check failed.");
  } finally {
    if (child.exitCode === null && !child.killed) stopTree(child);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* The database file can still be open for a moment. */
    }
  }
  if (failed) {
    process.exitCode = 1;
    console.error(`${failed} page${failed === 1 ? " was" : "s were"} too slow or did not open.`);
    return;
  }
  console.log(`Speed check passed: each page opened in under ${LIMIT_MS / 1000} seconds with ${TARGET_CLAIMS} claims.`);
}

main().then(() => process.exit(process.exitCode ?? 0));

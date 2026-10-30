/**
 * J12: proves, on the server, what each role can open. Signs in as Justin, Sian (office staff), the demonstration
 * driver and the demonstration mechanic, and requests every address in ROLE_ACCESS directly, as if typed in.
 *
 * From CAS-CRM, after a production build (run by npm run test:journeys):
 *   npx tsx scripts/permissions-check.ts
 *
 * Uses its own database and files folder, never the demonstration ones.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROLE_ACCESS } from "../src/lib/auth/role-access.ts";
import type { StaffAccessRole } from "../src/lib/auth/roles.ts";
import { freePort, passwordFor, signIn, stopTree, waitUntilReady } from "./journey-check.ts";

const PEOPLE: Array<{ role: StaffAccessRole; name: string; username: string }> = [
  { role: "administrator", name: "Justin Roberts", username: "justin" },
  { role: "staff", name: "Sian Evans", username: "sian" },
  { role: "driver", name: "Demo Driver", username: "driver" },
  { role: "mechanic", name: "Demo Mechanic", username: "mechanic" },
];

/** A fictional bank statement on TEST file c1, so the bank-statement address has something to refuse. */
function addBankStatement(dbPath: string, filesDir: string): string {
  const rel = "claims/c1/documents/permissions-check-bank.pdf";
  fs.mkdirSync(path.join(filesDir, "claims", "c1", "documents"), { recursive: true });
  fs.writeFileSync(path.join(filesDir, rel), "%PDF-1.4 fictional bank statement");
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, original_filename, stored_relpath, mime_type, byte_size, created_at)
       VALUES ('doc-permissions-bank', 'c1', 'Bank statement (fictional)', 'file', 'bank_statements', 1, 0, 0, 'bank.pdf', ?, 'application/pdf', 33, ?)`,
    ).run(rel, new Date().toISOString());
  } finally {
    db.close();
  }
  return "doc-permissions-bank";
}

/** Opened: a 200 that stayed on the address asked for. Refused: a 403, a redirect elsewhere, or the Justin-only message. */
async function opens(origin: string, cookie: string, address: string, justinOnly: boolean): Promise<{ opened: boolean; how: string }> {
  const response = await fetch(`${origin}${address}`, { headers: { cookie }, redirect: "follow" });
  const finalPath = new URL(response.url).pathname;
  const body = response.headers.get("content-type")?.includes("zip") ? "" : await response.text();
  if (response.status === 403) return { opened: false, how: "403" };
  if (finalPath !== address.split("?")[0]) return { opened: false, how: `redirected to ${finalPath}` };
  if (justinOnly && /Only Justin can (open the audit view|download the full export|open the retention schedule|open a person|use the breach log)/.test(body)) return { opened: false, how: "Only Justin message" };
  return { opened: response.status === 200, how: String(response.status) };
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build first.");
    process.exitCode = 1;
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-permissions-"));
  const dbPath = path.join(dir, "cas-crm.sqlite");
  const filesDir = path.join(dir, "files");
  const port = await freePort(3400);
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: dbPath, CAS_FILES_DIR: filesDir, EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let failed = 0;
  try {
    await waitUntilReady(origin, child);
    const cookies = new Map<StaffAccessRole, string>();
    for (const person of PEOPLE) cookies.set(person.role, await signIn(origin, person.username, passwordFor(person.name, person.username)));
    const bankDoc = addBankStatement(dbPath, filesDir);
    for (const area of ROLE_ACCESS) {
      const address = area.path.replace(":claim", "c1").replace(":bankDoc", bankDoc);
      for (const person of PEOPLE) {
        const expected = area.open[person.role];
        const result = await opens(origin, cookies.get(person.role)!, address, Boolean(area.justinOnly));
        const ok = result.opened === expected;
        if (!ok) failed += 1;
        console.log(`${ok ? "PASS" : "FAIL"}  ${person.role.padEnd(13)} ${expected ? "opens  " : "refused"}  ${area.label} (${address}) — ${result.how}`);
      }
    }
  } catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : "The permissions check failed.");
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
    console.error(`${failed} permission check${failed === 1 ? "" : "s"} failed.`);
    return;
  }
  console.log("Permissions check passed: every role was opened or refused as the table says, by direct address, on the server.");
}

main().then(() => process.exit(process.exitCode ?? 0));

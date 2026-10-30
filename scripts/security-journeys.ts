/**
 * J15: the security and data-protection journeys, against a production build, through the real sign-in (including
 * Justin's authenticator step) and the real pages and forms.
 *
 * From CAS-CRM, after a production build (run by npm run test:journeys):
 *   npx tsx scripts/security-journeys.ts
 *
 * Uses its own database and files folder, never the demonstration ones. EMAIL_SEND_MODE is simulate.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readZip } from "../src/lib/ops/zip.ts";
import { freePort, passwordFor, readDb, signIn, stopTree, waitUntilReady } from "./journey-check.ts";

type Check = { name: string; run: () => Promise<string | null> };

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build first.");
    process.exitCode = 1;
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-security-journeys-"));
  const dbPath = path.join(dir, "cas-crm.sqlite");
  const filesDir = path.join(dir, "files");
  const port = await freePort(3600);
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: dbPath, CAS_FILES_DIR: filesDir, EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (chunk: Buffer) => (serverLog = (serverLog + chunk.toString()).slice(-3000)));
  child.stderr?.on("data", (chunk: Buffer) => (serverLog = (serverLog + chunk.toString()).slice(-3000)));
  let failed = 0;
  try {
    await waitUntilReady(origin, child);
    const sian = await signIn(origin);
    const justin = await signIn(origin, "justin", passwordFor("Justin Roberts", "justin"), dbPath);
    // TEST-0003 closed seven years ago, with a fictional bank statement on file.
    fs.mkdirSync(path.join(filesDir, "claims", "c3", "documents"), { recursive: true });
    fs.writeFileSync(path.join(filesDir, "claims", "c3", "documents", "journey-bank.pdf"), "%PDF-1.4 fictional bank statement");
    readDb(dbPath, (db) => {
      db.prepare(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, source) VALUES ('ev-journey-close', 'c3', 'case_closed', 'Case closed', 'Closed', '2019-03-10T10:00:00.000Z', '2019-03-10T10:00:00.000Z', 'staff')`,
      ).run();
      db.prepare(
        `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, original_filename, stored_relpath, mime_type, byte_size, created_at)
         VALUES ('doc-journey-bank', 'c3', 'Bank statement', 'file', 'bank_statements', 1, 0, 0, 'bank.pdf', 'claims/c3/documents/journey-bank.pdf', 'application/pdf', 33, ?)`,
      ).run(new Date().toISOString());
    });
    const get = (cookie: string, address: string) => fetch(`${origin}${address}`, { headers: { cookie }, redirect: "manual" });
    const post = (cookie: string, address: string, fields: Record<string, string>) =>
      fetch(`${origin}${address}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), redirect: "manual" });
    const dueText = async () => {
      await post(justin, "/settings/retention/save", { intent: "rebuild" });
      return (await get(justin, "/settings/retention")).text();
    };

    const checks: Check[] = [
      {
        name: "A lockout after repeated failed logins",
        async run() {
          for (let i = 0; i < 5; i += 1) {
            await fetch(`${origin}/login/submit`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "megan", password: "not-her-password" }) });
          }
          const right = await fetch(`${origin}/login/submit`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ username: "megan", password: passwordFor("Megan Price", "megan") }),
          });
          const location = right.headers.get("location") || "";
          if (!location.includes("error=locked")) return `The right password got through a locked username: ${right.status} ${location}`;
          const page = await fetch(`${origin}${new URL(location, origin).pathname}${new URL(location, origin).search}`).then((r) => r.text());
          return /locked for 15 minutes/.test(page) ? null : "The sign-in page did not say the username is locked.";
        },
      },
      {
        name: "Viewing a bank statement appears in the audit",
        async run() {
          const file = await get(sian, "/documents/doc-journey-bank/file");
          if (file.status !== 200) return `Sian could not open the bank statement: ${file.status}`;
          if (!/attachment/.test(file.headers.get("content-disposition") || "") || file.headers.get("x-content-type-options") !== "nosniff") return "The file was not sent as a safe download.";
          const audit = await get(justin, "/audit?kind=viewed").then((r) => r.text());
          return /Downloaded Bank statements/.test(audit) && /Sian Evans/.test(audit) ? null : "The audit view does not show Sian downloading the bank statement.";
        },
      },
      {
        name: "The deletion list after the period, and a legal hold blocking deletion",
        async run() {
          if (!/TEST-0003: claim file closed 10\/03\/2019/.test(await dueText())) return "The closed claim is not on the due-for-deletion list.";
          await post(justin, "/claims/c3/litigation/save", { intent: "hold", reason: "Fictional dispute" });
          if (/TEST-0003: claim file/.test(await dueText())) return "A claim on legal hold is still on the deletion list.";
          await post(justin, "/claims/c3/litigation/save", { intent: "unhold" });
          if (!/TEST-0003: claim file/.test(await dueText())) return "Lifting the hold did not put the claim back on the list.";
          const staffTry = await post(sian, "/settings/retention/save", { intent: "approve", item: "claim:c3", reason: "x" });
          if (!decodeURIComponent((staffTry.headers.get("location") || "").replaceAll("+", " ")).includes("Only Justin")) return "Sian could approve a deletion.";
          await post(justin, "/settings/retention/save", { intent: "approve", item: "claim:c3", reason: "Past its retention period" });
          const name = readDb(dbPath, (db) => (db.prepare(`SELECT p.full_name FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c3'`).get() as { full_name: string }).full_name);
          if (name !== "Removed") return "Approving the claim did not anonymise it.";
          const log = await get(justin, "/settings/retention").then((r) => r.text());
          return /money lines kept/.test(log) ? null : "The deletion log does not record what was removed.";
        },
      },
      {
        name: "A person's data export",
        async run() {
          const refused = await get(sian, "/settings/person-data/export?person=p-aled");
          if (refused.status !== 403) return `Sian could export a person's data: ${refused.status}`;
          const search = await get(justin, "/settings/person-data?q=Aled").then((r) => r.text());
          if (!/TEST-0001/.test(search)) return "Searching for the person did not find their claim.";
          const response = await get(justin, "/settings/person-data/export?person=p-aled");
          if (response.status !== 200) return `The export failed: ${response.status}`;
          const files = readZip(Buffer.from(await response.arrayBuffer()));
          if (!files.has("README.txt") || !files.has("person.csv") || !/Aled Morgan/.test(files.get("person.csv")?.toString() || "")) return "The export is missing the person's record.";
          const audit = await get(justin, "/audit?kind=viewed").then((r) => r.text());
          return /Exported everything held about one person/.test(audit) ? null : "The export is not in the audit view.";
        },
      },
    ];
    for (const check of checks) {
      let problem: string | null;
      try {
        problem = await check.run();
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (problem) failed += 1;
      console.log(`${problem ? "FAIL" : "PASS"}  ${check.name}${problem ? `  ${problem}` : ""}`);
    }
  } catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : error);
    if (serverLog.trim()) console.error(serverLog.trim());
  } finally {
    if (child.exitCode === null && !child.killed) stopTree(child);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* The database can still be open for a moment. */
    }
  }
  console.log(failed ? `${failed} security journey${failed === 1 ? "" : "s"} failed.` : "Security journeys passed. Email stayed on simulate. The demonstration database was not used.");
  if (failed) process.exitCode = 1;
}

main();

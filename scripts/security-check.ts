/**
 * J15: the security checks in the finish routine (run by npm run check:pages, after the page check).
 *
 *   1. Dependencies: npm audit, failing on any high or critical vulnerability.
 *   2. Secrets: no private keys, live API keys or tokens in any tracked file, and no .env tracked.
 *   3. Headers: a running production build sends the safe security headers.
 *   4. Cross-site posts: a post from another site is refused on the sign-in, a staff form and the client form.
 *   5. Uploads: every route that serves a stored file checks permission and sends it as a download that cannot run.
 *
 * Uses its own copy-free test database (a fresh one in a temp folder), never the demonstration one.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freePort, stopTree, waitUntilReady } from "./journey-check.ts";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

function dependencyCheck() {
  // One command string: Windows runs npm through the shell, and passing arguments separately is deprecated there.
  const run = spawnSync("npm audit --json", { cwd: process.cwd(), encoding: "utf8", shell: true });
  try {
    const report = JSON.parse(run.stdout || "{}") as { metadata?: { vulnerabilities?: Record<string, number> }; error?: { summary?: string } };
    if (report.error) {
      record("Dependencies", false, `npm audit could not run: ${report.error.summary || "no answer from the registry"}`);
      return;
    }
    const v = report.metadata?.vulnerabilities || {};
    const bad = Number(v.high || 0) + Number(v.critical || 0);
    record("Dependencies", bad === 0, `npm audit: ${Number(v.critical || 0)} critical, ${Number(v.high || 0)} high, ${Number(v.moderate || 0)} moderate, ${Number(v.low || 0)} low`);
  } catch {
    record("Dependencies", false, `npm audit gave no report: ${(run.stderr || "").slice(0, 200)}`);
  }
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["a private key", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a live Stripe key", /\bsk_live_[0-9a-zA-Z]{16,}/],
  ["a GitHub token", /\bgh[pousr]_[0-9A-Za-z]{30,}/],
  ["a Slack token", /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["an assigned secret", /\b(api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][A-Za-z0-9_\-./+]{20,}["']/i],
];

function secretScan() {
  const files = spawnSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "ls-files"], { cwd: process.cwd(), encoding: "utf8" })
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  if (files.some((file) => /(^|\/)\.env(\..*)?$/.test(file) && !file.endsWith(".example"))) {
    record("Secrets", false, "A .env file is tracked by git.");
    return;
  }
  const found: string[] = [];
  for (const file of files) {
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|sqlite|woff2?|ttf|traineddata)$/i.test(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const [what, pattern] of SECRET_PATTERNS) if (pattern.test(text)) found.push(`${file}: ${what}`);
  }
  record("Secrets", found.length === 0, found.length ? `Found: ${found.join("; ")}` : `${files.length} tracked files scanned; no keys or tokens found`);
}

function uploadRoutes() {
  const problems: string[] = [];
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name === "route.ts" ? [path.join(dir, entry.name)] : []));
  const routes = walk(path.join(process.cwd(), "src", "app")).filter((file) => /readStoredFile\(/.test(fs.readFileSync(file, "utf8")));
  for (const file of routes) {
    const text = fs.readFileSync(file, "utf8");
    const name = path.relative(process.cwd(), file);
    if (!/requireSignedIn|getRequestStaff/.test(text)) problems.push(`${name} does not check who is signed in`);
    if (!/canReadDocument|isOfficeRole|canUsePersonData|canExportAndAudit/.test(text)) problems.push(`${name} has no permission check`);
    if (!/attachment/.test(text)) problems.push(`${name} does not send the file as a download`);
    if (!/nosniff/.test(text)) problems.push(`${name} does not stop the browser guessing the type`);
  }
  record("Uploads", problems.length === 0, problems.length ? problems.join("; ") : `${routes.length} file routes: signed in, permission checked, sent as a download with nosniff`);
}

async function liveChecks() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    record("Headers", false, "There is no production build. Run npm run build first.");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-security-"));
  const port = await freePort(3500);
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: path.join(dir, "cas-crm.sqlite"), CAS_FILES_DIR: path.join(dir, "files"), EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitUntilReady(origin, child);
    const page = await fetch(`${origin}/login`);
    const wanted: Array<[string, RegExp]> = [
      ["x-content-type-options", /^nosniff$/],
      ["x-frame-options", /^(DENY|SAMEORIGIN)$/],
      ["content-security-policy", /frame-ancestors/],
      ["referrer-policy", /./],
      ["permissions-policy", /./],
    ];
    const missing = wanted.filter(([name, value]) => !value.test(page.headers.get(name) || "")).map(([name]) => name);
    record("Headers", missing.length === 0, missing.length ? `Missing or wrong: ${missing.join(", ")}` : "nosniff, frame protection, content security policy, referrer and permissions policies are sent");
    const refused: string[] = [];
    for (const target of ["/login/submit", "/claims/c1/hire/swap", "/c/some-link/save", "/settings/breaches/save", "/website/enquiry"]) {
      const response = await fetch(`${origin}${target}`, {
        method: "POST",
        redirect: "manual",
        headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
        body: "username=sian&password=x",
      });
      if (response.status !== 403) refused.push(`${target} answered ${response.status}`);
    }
    // A sandboxed frame on another site sends Origin "null"; only the browser's own same-origin mark lets that through.
    const sandboxed = await fetch(`${origin}/login/submit`, { method: "POST", redirect: "manual", headers: { origin: "null", "content-type": "application/x-www-form-urlencoded" }, body: "username=sian" });
    if (sandboxed.status !== 403) refused.push(`a "null" origin answered ${sandboxed.status}`);
    record("Cross-site posts", refused.length === 0, refused.length ? refused.join("; ") : "posts from another site are refused on the sign-in, staff, client-form, Justin-only and website-enquiry forms");
  } finally {
    if (child.exitCode === null && !child.killed) stopTree(child);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* The database can still be open for a moment. */
    }
  }
}

async function main() {
  dependencyCheck();
  secretScan();
  uploadRoutes();
  await liveChecks();
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed ? `${failed} security check${failed === 1 ? "" : "s"} failed.` : "Security checks passed.");
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

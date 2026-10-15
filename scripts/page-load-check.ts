/**
 * Loads every main page of the production build and fails if any shows an error.
 *
 * Run from the CAS-CRM folder, after a production build:
 *   npm run check:pages
 *
 * Starts `next start` on a free port (from 3100). It does not use port 3000 and does not stop another server.
 * Signs in as the Justin test user from docs/AUTH-NOTES.md. It only reads pages. It does not submit forms or send email.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { SESSION_COOKIE } from "../src/lib/auth/constants.ts";
import { CLAIM_SCREENS } from "../src/lib/claim-screens.ts";

const CLAIM_ID = "c5";
const HEAD_SCREENS = ["recovery", "storage", "hire", "vehicle"] as const;

const PAGES: Array<{ name: string; path: string }> = [
  { name: "Dashboard", path: "/" },
  { name: "Claims list", path: "/claims" },
  { name: "Claim overview (TEST-0005)", path: `/claims/${CLAIM_ID}` },
  ...CLAIM_SCREENS.map((screen) => ({
    name: `Work: ${screen.label}`,
    path: `/claims/${CLAIM_ID}/work/${screen.key}`,
  })),
  ...HEAD_SCREENS.map((head) => ({
    name: `Head of loss: ${head}`,
    path: `/claims/${CLAIM_ID}/heads/${head}`,
  })),
  { name: "My jobs today", path: "/jobs" },
  { name: "Tasks", path: "/tasks" },
  { name: "Hire / Fleet", path: "/hire" },
  { name: "Documents", path: "/documents" },
  { name: "Communications", path: "/communications" },
  { name: "Financials", path: "/financials" },
  { name: "Automations", path: "/automations" },
  { name: "Litigation", path: "/litigation" },
  { name: "Settings", path: "/settings" },
];

const ERROR_TEXT = [
  "Application error: a server-side exception has occurred",
  "Application error: a client-side exception has occurred",
  "missing required error components",
];

function justinPassword(): string {
  const notes = fs.readFileSync(path.join(process.cwd(), "docs", "AUTH-NOTES.md"), "utf8");
  const line = notes.split(/\r?\n/).find((row) => row.includes("| Justin Roberts |"));
  const cells = line?.split("|").map((cell) => cell.trim().replaceAll("`", "")) ?? [];
  if (cells[2] !== "justin" || !cells[3]) {
    throw new Error("The Justin test sign-in is not in docs/AUTH-NOTES.md in the expected place.");
  }
  return cells[3];
}

function emailSendMode(): string {
  const envFile = path.join(process.cwd(), ".env");
  const fromFile = fs.existsSync(envFile)
    ? fs
        .readFileSync(envFile, "utf8")
        .split(/\r?\n/)
        .find((row) => row.startsWith("EMAIL_SEND_MODE="))
        ?.slice("EMAIL_SEND_MODE=".length)
        .trim()
    : "";
  return fromFile || process.env.EMAIL_SEND_MODE || "";
}

function freePort(start = 3100): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      if (port > start + 30) {
        reject(new Error(`No free port from ${start}.`));
        return;
      }
      const server = net.createServer();
      server.once("error", () => attempt(port + 1));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };
    attempt(start);
  });
}

function sessionCookie(response: Response): string | null {
  const set = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const found = set.find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return found ? found.split(";")[0] : null;
}

async function fetchWithCookie(
  url: string,
  cookie: string,
  init: RequestInit = {},
): Promise<{ response: Response; url: string; cookie: string }> {
  let current = url;
  let jar = cookie;
  for (let hop = 0; hop < 8; hop += 1) {
    const headers = new Headers(init.headers);
    if (jar) headers.set("cookie", jar);
    const response = await fetch(current, { ...init, headers, redirect: "manual" });
    const nextCookie = sessionCookie(response);
    if (nextCookie) jar = nextCookie;
    if (response.status < 300 || response.status >= 400) return { response, url: current, cookie: jar };
    const location = response.headers.get("location");
    if (!location) return { response, url: current, cookie: jar };
    current = new URL(location, current).href;
    init = { method: "GET" };
  }
  throw new Error(`Too many redirects from ${url}`);
}

function pageProblem(response: Response, html: string, finalUrl: string): string | null {
  const pathName = new URL(finalUrl).pathname;
  if (response.status !== 200) return `HTTP ${response.status}`;
  if (pathName === "/login" || pathName.startsWith("/login/")) return "sent back to sign-in";
  const marker = ERROR_TEXT.find((text) => html.includes(text));
  if (marker) return marker;
  if (!html.includes("Complete Accident Solutions")) return "the signed-in screen did not load";
  if (!html.trim()) return "empty response";
  return null;
}

async function waitUntilReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = "not started";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The server stopped before it was ready (${last}).`);
    try {
      const response = await fetch(`${origin}/login`, { redirect: "manual" });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "connection refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The server did not answer on ${origin} (${last}).`);
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build, then npm run check:pages.");
    process.exitCode = 1;
    return;
  }
  const mode = emailSendMode();
  if (mode === "live") {
    console.error("EMAIL_SEND_MODE is live. The page check was not started.");
    process.exitCode = 1;
    return;
  }

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  const keepLog = (chunk: Buffer) => {
    serverLog = (serverLog + chunk.toString("utf8")).slice(-4000);
  };
  child.stdout?.on("data", keepLog);
  child.stderr?.on("data", keepLog);

  const stop = () => {
    if (child.exitCode === null && !child.killed) child.kill();
  };
  process.once("exit", stop);

  try {
    await waitUntilReady(origin, child);
    const signedIn = await fetchWithCookie(`${origin}/login/submit`, "", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "justin", password: justinPassword(), next: "/" }),
    });
    const cookie = signedIn.cookie;
    const signedInPath = new URL(signedIn.url).pathname;
    if (!cookie || signedInPath === "/login" || signedInPath.startsWith("/login/")) {
      console.error("Sign-in did not return a session. Nothing else was opened.");
      console.error(serverLog.trim());
      process.exitCode = 1;
      return;
    }

    let failed = 0;
    for (const page of PAGES) {
      const loaded = await fetchWithCookie(`${origin}${page.path}`, cookie);
      const html = await loaded.response.text();
      const problem = pageProblem(loaded.response, html, loaded.url);
      const finalPath = new URL(loaded.url).pathname + new URL(loaded.url).search;
      const where = finalPath === page.path ? page.path : `${page.path} -> ${finalPath}`;
      if (problem) {
        failed += 1;
        console.log(`FAIL  ${where}  ${page.name}  ${problem}`);
      } else {
        console.log(`PASS  ${where}  ${page.name}`);
      }
    }
    console.log(`${PAGES.length - failed} passed, ${failed} failed, port ${port}, email mode ${mode || "not set"}.`);
    if (failed > 0) {
      console.error(serverLog.trim());
      process.exitCode = 1;
    }
  } finally {
    stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

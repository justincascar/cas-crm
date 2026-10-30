/**
 * Loads every main page of the production build and fails if any shows an error.
 *
 * Run from the CAS-CRM folder, after a production build:
 *   npm run check:pages
 *
 * Starts `next start` on a free port (from 3100). It does not use port 3000 and does not stop another server.
 * Signs in as the Justin test user from docs/AUTH-NOTES.md. It only reads pages. It does not submit forms or send email.
 * After sign-in, and before any page is opened, it hashes the database. Opening the pages must not change that hash.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { stopBrowserProfile } from "./stop-browser-profile.ts";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SESSION_COOKIE } from "../src/lib/auth/constants.ts";
import { signIn as journeySignIn } from "./journey-check.ts";
import { CLAIM_SCREENS } from "../src/lib/claim-screens.ts";
import { dbPath, get, withDatabase } from "../src/lib/db/connection.ts";
import { databaseFingerprint, fingerprintChanges } from "../src/lib/db/database-fingerprint.ts";

const CLAIM_ID = "c5";
/** Every claim page must fit a 1280px laptop and a 1024px screen without sideways scroll. */
const SCROLL_WIDTHS = [1280, 1024] as const;
const HEAD_SCREENS = ["recovery", "storage", "hire", "vehicle"] as const;
const CLAIM_TAB_PAGES: Array<{ name: string; path: string }> = [
  { name: "Claim overview (TEST-0008)", path: "/claims/c8" },
  { name: "Email / WhatsApp / Calls (TEST-0008)", path: "/claims/c8/work/comms" },
  { name: "File screens (TEST-0008)", path: "/claims/c8/work/general" },
  { name: "Handover (TEST-0008)", path: "/claims/c8/handover" },
  { name: "Documents (TEST-0008)", path: "/claims/c8/documents" },
  { name: "Vehicles (TEST-0008)", path: "/claims/c8/vehicles" },
  { name: "Repair evidence (TEST-0008)", path: "/claims/c8/repair" },
  { name: "Hire Pack (TEST-0008)", path: "/claims/c8/hire-pack" },
  { name: "Pre-hire checks (TEST-0008)", path: "/claims/c8/prehire" },
  { name: "Financial circumstances (TEST-0008)", path: "/claims/c8/financial" },
  { name: "Litigation file (TEST-0012)", path: "/claims/c12/litigation" },
  { name: "Litigation file not opened (TEST-0008)", path: "/claims/c8/litigation" },
  { name: "Who can do what", path: "/settings/roles" },
  { name: "Recovery (TEST-0008)", path: "/claims/c8/heads/recovery" },
  { name: "Storage (TEST-0008)", path: "/claims/c8/heads/storage" },
  { name: "Hire (TEST-0008)", path: "/claims/c8/heads/hire" },
  { name: "Vehicle damage (TEST-0008)", path: "/claims/c8/heads/vehicle" },
  { name: "Details (TEST-0008)", path: "/claims/c8/details" },
  { name: "Hire tab (TEST-0008)", path: "/claims/c8/hire" },
  { name: "Money tab (TEST-0008)", path: "/claims/c8/money" },
  { name: "Messages (TEST-0008)", path: "/claims/c8/messages" },
  { name: "History (TEST-0008)", path: "/claims/c8/history" },
  { name: "Print chronology (TEST-0008)", path: "/claims/c8/history/print" },
  { name: "Work client redirect (TEST-0005)", path: "/claims/c5/work/client" },
  { name: "Storage redirect (TEST-0005)", path: "/claims/c5/heads/storage" },
  { name: "Hire head redirect (TEST-0005)", path: "/claims/c5/heads/hire" },
  { name: "Recovery redirect (TEST-0008)", path: "/claims/c8/heads/recovery" },
];

const PAGES: Array<{ name: string; path: string }> = [
  { name: "Dashboard", path: "/" },
  { name: "Gaps to explain before any dispute", path: "/gaps" },
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
  { name: "Driver jobs", path: "/driver-jobs" },
  { name: "Documents", path: "/documents" },
  { name: "Communications", path: "/communications" },
  { name: "Financials", path: "/financials" },
  { name: "Aged debt", path: "/financials/aged-debt" },
  { name: "Automations", path: "/automations" },
  { name: "Litigation", path: "/litigation" },
  { name: "Settings", path: "/settings" },
  { name: "Client form, unknown link", path: "/c/not-a-real-link" },
  { name: "Privacy notice", path: "/privacy" },
  { name: "Retention and deletion", path: "/settings/retention" },
  { name: "This person's data", path: "/settings/person-data" },
  { name: "Breach log", path: "/settings/breaches" },
  { name: "Staff logins", path: "/settings/staff" },
  ...CLAIM_TAB_PAGES,
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

function browserExecutable(): string {
  const candidates = [
    process.env.CAS_PAGE_CHECK_BROWSER || "",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("No Edge or Chrome browser was found for the sideways-scroll check.");
  return found;
}

type CdpMessage = { id?: number; method?: string; result?: { result?: { value?: ScrollMeasure } }; error?: { message: string } };

type ScrollMeasure = {
  scrollWidth: number;
  clientWidth: number;
  path: string;
  overflow: string;
};

class BrowserSession {
  private nextId = 0;
  private waiters = new Map<number, (message: CdpMessage) => void>();
  private listeners = new Map<string, Array<() => void>>();

  constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.waiters.has(message.id)) {
        const resolve = this.waiters.get(message.id);
        this.waiters.delete(message.id);
        resolve?.(message);
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener();
      }
    });
  }

  send(method: string, params?: object): Promise<CdpMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The sideways-scroll browser timed out during ${method}.`)), 20_000);
      this.waiters.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The sideways-scroll browser timed out waiting for ${method}.`)), 20_000);
      const list = this.listeners.get(method) || [];
      const handler = () => {
        clearTimeout(timer);
        this.listeners.set(
          method,
          (this.listeners.get(method) || []).filter((item) => item !== handler),
        );
        resolve();
      };
      list.push(handler);
      this.listeners.set(method, list);
    });
  }
}

async function measureClaimPages(origin: string, cookie: string): Promise<Array<{ path: string; problem: string }>> {
  const debugPort = await freePort(9222);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cas-page-check-"));
  const browser = spawn(
    browserExecutable(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userData}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const stopBrowser = () => {
    if (browser.exitCode === null && !browser.killed) browser.kill();
    stopBrowserProfile(userData);
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* Edge can still be releasing the profile folder. The check does not need that folder afterwards. */
    }
  };
  try {
    const deadline = Date.now() + 15_000;
    let socketUrl = "";
    while (Date.now() < deadline) {
      try {
        const list = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page) {
          socketUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* the browser is still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!socketUrl) throw new Error("The sideways-scroll browser did not open a page.");
    const socket = new WebSocket(socketUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("The sideways-scroll browser connection failed.")));
    });
    const session = new BrowserSession(socket);
    await session.send("Page.enable");
    await session.send("Network.enable");
    const cookieValue = cookie.slice(cookie.indexOf("=") + 1);
    await session.send("Network.setCookie", {
      name: SESSION_COOKIE,
      value: cookieValue,
      url: origin,
      path: "/",
    });
    const problems: Array<{ path: string; problem: string }> = [];
    for (const width of SCROLL_WIDTHS) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const page of CLAIM_TAB_PAGES) {
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url: `${origin}${page.path}` });
      await loaded;
      const measured = await session.send("Runtime.evaluate", {
        expression: `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const root = document.documentElement;
          const scrolling = [];
          for (const el of document.querySelectorAll("*")) {
            const style = getComputedStyle(el);
            if ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth) {
              scrolling.push((el.id || el.className || el.tagName).toString().slice(0, 80));
            }
          }
          resolve({
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            path: location.pathname,
            overflow: scrolling.slice(0, 4).join(" | "),
          });
        })))`,
        awaitPromise: true,
        returnByValue: true,
      });
      const value = measured.result?.result?.value;
      if (!value) {
        problems.push({ path: page.path, problem: "the sideways-scroll check did not return a measurement" });
        continue;
      }
      if (value.path === "/login" || value.path.startsWith("/login/")) {
        problems.push({ path: page.path, problem: "sent back to sign-in" });
        continue;
      }
      if (value.scrollWidth > value.clientWidth) {
        problems.push({
          path: page.path,
          problem: `at ${width}px: sideways scroll ${value.scrollWidth}px wider than ${value.clientWidth}px${value.overflow ? ` (${value.overflow})` : ""}`,
        });
      }
    }
    }
    socket.close();
    return problems;
  } finally {
    stopBrowser();
  }
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

function warmDatabase() {
  const db = new DatabaseSync(dbPath());
  try {
    withDatabase(db, () => {
      get(`SELECT id FROM claims LIMIT 1`);
    });
  } finally {
    db.close();
  }
}

function readViewAuditIds(): string[] {
  const db = new DatabaseSync(dbPath());
  try {
    return (db.prepare(`SELECT id FROM audit_log WHERE action = 'view'`).all() as Array<{ id: string }>).map((row) => String(row.id));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function readFingerprint() {
  const db = new DatabaseSync(dbPath());
  try {
    db.exec("PRAGMA query_only = ON;");
    return databaseFingerprint(db);
  } finally {
    db.close();
  }
}

/** As Justin, through the authenticator step (J15), reading the key from this PC's demonstration database. */
async function signIn(origin: string): Promise<string> {
  try {
    return await journeySignIn(origin, "justin", justinPassword(), dbPath());
  } catch {
    throw new Error("Sign-in did not return a session. No claim page was opened.");
  }
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

  // J15: the check runs on a copy of this PC's demonstration database, so signing in as Justin through the
  // authenticator step never sets up or changes Justin's own authenticator on the real one.
  const realDb = dbPath();
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-page-check-"));
  const copy = path.join(copyDir, "cas-crm.sqlite");
  warmDatabase();
  const source = new DatabaseSync(realDb);
  try {
    source.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }
  process.env.DATABASE_PATH = copy;
  // A fresh copy for each run: Justin's key on the copy is set up from the page and removed with the copy.
  const reset = new DatabaseSync(copy);
  try {
    reset.exec(`UPDATE staff SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = 'staff-justin'`);
  } catch {
    /* An older database without the columns: nothing to reset. */
  } finally {
    reset.close();
  }
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, CAS_PAGE_CHECK: "1" },
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
    const cookie = await signIn(origin);
    const beforePages = readFingerprint();

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
    const sideways = await measureClaimPages(origin, cookie);
    let scrollFailed = 0;
    for (const page of CLAIM_TAB_PAGES) {
      const found = sideways.filter((item) => item.path === page.path);
      if (found.length) {
        failed += 1;
        scrollFailed += 1;
        console.log(`FAIL  ${page.path}  ${page.name} sideways scroll  ${found.map((item) => item.problem).join("; ")}`);
      } else {
        console.log(`PASS  ${page.path}  ${page.name} no sideways scroll at 1280px or 1024px`);
      }
    }
    // Keeping a session alive and recording who viewed what are expected writes; anything else is a change.
    const viewIds = new Set(readViewAuditIds());
    const databaseChanges = fingerprintChanges(beforePages, readFingerprint()).filter(
      (change) => !change.includes(" sessions:") && ![...viewIds].some((id) => change.includes(id)),
    );
    if (databaseChanges.length > 0) {
      console.log(`FAIL  database changed while pages were opened: ${databaseChanges.join("; ")}`);
    } else {
      console.log("PASS  database unchanged after opening every page");
    }
    console.log(
      `${PAGES.length - (failed - scrollFailed)} passed, ${failed - scrollFailed} failed, ${CLAIM_TAB_PAGES.length - scrollFailed} claim pages fit 1280px and 1024px, ${scrollFailed} scrolled sideways, database ${databaseChanges.length === 0 ? "unchanged" : "changed"}, port ${port}, email mode ${mode || "not set"}.`,
    );
    if (failed > 0 || databaseChanges.length > 0) {
      console.error(serverLog.trim());
      process.exitCode = 1;
    }
  } finally {
    stop();
    try {
      fs.rmSync(copyDir, { recursive: true, force: true });
    } catch {
      /* The copy can still be open for a moment. */
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

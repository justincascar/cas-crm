/**
 * Drives the three new-claim journeys in a real browser.
 *
 * From CAS-CRM, after a production build:
 *   npm run test:journeys
 *
 * Uses its own database. It does not open the demonstration database, does not
 * confirm a storage end, and does not send email. EMAIL_SEND_MODE is simulate.
 *
 * Later stages extend tests/journeys/claim-journeys.ts and this script.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CLAIM_JOURNEYS, JOURNEY_PHONE_WARNING, JOURNEY_STAGE, type ClaimJourney } from "../tests/journeys/claim-journeys.ts";

const ACCIDENT_DATE = "2026-10-20";

type CdpMessage = {
  id?: number;
  method?: string;
  result?: {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  error?: { message: string };
};

class BrowserSession {
  private nextId = 0;
  private waiters = new Map<number, (message: CdpMessage) => void>();

  constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.waiters.has(message.id)) {
        const resolve = this.waiters.get(message.id);
        this.waiters.delete(message.id);
        resolve?.(message);
      }
    });
  }

  send(method: string, params?: object): Promise<CdpMessage> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The journey browser timed out during ${method}.`)), 20_000);
      this.waiters.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const message = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const details = message.result?.exceptionDetails;
    if (details) {
      throw new Error(details.exception?.description || details.text || "The page script failed.");
    }
    return message.result?.result?.value as T;
  }
}

function sianPassword(): string {
  const notes = fs.readFileSync(path.join(process.cwd(), "docs", "AUTH-NOTES.md"), "utf8");
  const line = notes.split(/\r?\n/).find((row) => row.includes("| Sian Evans |"));
  const cells = line?.split("|").map((cell) => cell.trim().replaceAll("`", "")) ?? [];
  if (cells[2] !== "sian" || !cells[3]) {
    throw new Error("The Sian test sign-in is not in docs/AUTH-NOTES.md in the expected place.");
  }
  return cells[3];
}

function freePort(start = 3200): Promise<number> {
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

function browserExecutable(): string {
  const candidates = [
    process.env.CAS_PAGE_CHECK_BROWSER || "",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("No Edge or Chrome browser was found for the journey check.");
  return found;
}

function sessionCookie(response: Response): string | null {
  const set = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const found = set.find((item) => item.startsWith("cas_session="));
  return found ? found.split(";")[0] : null;
}

async function waitUntilReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 40_000;
  let last = "not started";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The journey server stopped before it was ready (${last}).`);
    try {
      const response = await fetch(`${origin}/login`, { redirect: "manual" });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "connection refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The journey server did not answer on ${origin} (${last}).`);
}

async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/login/submit`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "sian", password: sianPassword(), next: "/" }),
  });
  const cookie = sessionCookie(response);
  if (!cookie || response.status !== 303) throw new Error("Sign-in as Sian did not return a session.");
  return cookie;
}

async function openBrowser(): Promise<{ session: BrowserSession; stop: () => void }> {
  const debugPort = await freePort(9222);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cas-journey-"));
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
  const stop = () => {
    if (browser.exitCode === null && !browser.killed) browser.kill();
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* The profile folder can still be releasing. */
    }
  };
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
  if (!socketUrl) {
    stop();
    throw new Error("The journey browser did not open a page.");
  }
  const socket = new WebSocket(socketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("The journey browser socket failed.")));
  });
  const session = new BrowserSession(socket);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  return { session, stop };
}

const FILL = `
function setControl(name, value) {
  const el = document.querySelector('[name="' + name + '"]');
  if (!el) return "missing " + name;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue("");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
}
function clickBox(name) {
  const el = document.querySelector('[name="' + name + '"]');
  if (!(el instanceof HTMLInputElement)) return "missing " + name;
  if (!el.checked) el.click();
  return el.checked ? "checked" : "not-checked";
}
`;

async function fillJourney(session: BrowserSession, journey: ClaimJourney): Promise<string | null> {
  const spec = JSON.stringify({
    forename: journey.forename,
    surname: journey.surname,
    claimType: journey.claimType,
    roadworthiness: journey.roadworthiness,
    phone: JOURNEY_PHONE_WARNING,
    accidentDate: ACCIDENT_DATE,
    needsRecovery: journey.needsRecovery,
    needsReplacement: journey.needsReplacement,
  });
  const filled = await session.evaluate<string>(`(() => {
    ${FILL}
    const spec = ${spec};
    const notes = [];
    notes.push(setControl("client_forename", spec.forename));
    notes.push(setControl("client_surname", spec.surname));
    notes.push(setControl("claimType", spec.claimType));
    notes.push(setControl("roadworthiness", spec.roadworthiness));
    notes.push(setControl("accidentDate", spec.accidentDate));
    notes.push(setControl("accidentTime", "14:30"));
    notes.push(setControl("location", "Cardiff"));
    notes.push(setControl("circumstances", spec.forename + " " + spec.surname + " journey check."));
    notes.push(setControl("veh_registration", "AB12CDE"));
    notes.push(setControl("veh_make", "Ford"));
    notes.push(setControl("veh_model", "Focus"));
    notes.push(setControl("client_mobile", spec.phone));
    return notes.join(" | ");
  })()`);
  if (filled.includes("missing")) return filled;

  const warned = await session.evaluate<string>(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const phone = ${JSON.stringify(JOURNEY_PHONE_WARNING)};
    const input = document.querySelector('[name="client_mobile"]');
    if (input instanceof HTMLInputElement && input.value !== phone) {
      const tracker = input._valueTracker;
      if (tracker) tracker.setValue("");
      setter.call(input, phone);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const deadline = Date.now() + 8000;
    return new Promise((resolve) => {
      const attempt = () => {
        const box = document.querySelector('[name="saveAnyway_client_mobile"]');
        if (box instanceof HTMLInputElement) {
          if (!box.checked) box.click();
          resolve(document.body.innerText.includes("Save anyway") && box.checked ? "saved-anyway" : "not-ticked");
          return;
        }
        if (Date.now() > deadline) resolve("missing-save-anyway");
        else setTimeout(attempt, 100);
      };
      attempt();
    });
  })()`);
  if (warned !== "saved-anyway") return warned;

  const skipped = await session.evaluate<string>(`(() => { ${FILL} return clickBox("client_skipOtherTel"); })()`);
  if (skipped !== "checked") return `skip ${skipped}`;

  if (journey.needsRecovery) {
    const recovery = await session.evaluate<string>(`(() => { ${FILL} return clickBox("needsRecovery"); })()`);
    if (recovery !== "checked") return `recovery ${recovery}`;
  }
  if (journey.needsReplacement) {
    const hire = await session.evaluate<string>(`(() => { ${FILL} return clickBox("needsReplacement"); })()`);
    if (hire !== "checked") return `replacement ${hire}`;
  }

  const stillSkipped = await session.evaluate<boolean>(`(() => {
    const el = document.querySelector('[name="client_skipOtherTel"]');
    return el instanceof HTMLInputElement && el.checked && !document.querySelector('[name="client_otherTel"]');
  })()`);
  if (!stillSkipped) return "Skip other number did not clear the other number box.";
  return null;
}

type PageState = {
  path: string;
  search: string;
  formError: string;
  reference: string;
  stepState: string;
  stepText: string;
};

async function readPage(session: BrowserSession): Promise<PageState> {
  return session.evaluate<PageState>(`({
    path: location.pathname,
    search: location.search,
    formError: document.querySelector("[data-form-error]")?.innerText || "",
    reference: (document.querySelector("#claim-summary .font-mono")?.textContent || document.querySelector('[data-slim="reference"]')?.textContent || "").trim(),
    stepState: document.querySelector('[data-step="details"]')?.getAttribute("data-state") || "",
    stepText: document.querySelector('[data-step="details"]')?.innerText || "",
  })`);
}

async function createJourney(session: BrowserSession, origin: string, journey: ClaimJourney): Promise<{ reference: string } | string> {
  await session.send("Page.navigate", { url: `${origin}/claims/new` });
  const opened = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < opened) {
    const state = await readPage(session);
    if (state.path === "/claims/new") {
      const hasForm = await session.evaluate<boolean>(`(() => {
        const input = document.querySelector('[name="client_mobile"]');
        return input instanceof HTMLInputElement && Boolean(input._valueTracker);
      })()`);
      if (hasForm) {
        ready = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) return "The new-claim form did not open.";

  const problem = await fillJourney(session, journey);
  if (problem) return problem;

  await session.evaluate<void>(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Create claim");
    if (!button) throw new Error("Create claim was not on the page.");
    button.click();
  })()`);

  const deadline = Date.now() + 20_000;
  let last = await readPage(session);
  while (Date.now() < deadline) {
    last = await readPage(session);
    if (/^\/claims\/(?!new$)[^/]+$/.test(last.path) && last.reference && last.stepState === "done") break;
    if (last.formError || (last.path === "/claims/new" && last.search.includes("error="))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (last.formError) return last.formError.replace(/\s+/g, " ");
  if (last.path === "/claims/new") return `Stayed on New claim. ${last.search}`;
  if (!/^TEST-\d+$/.test(last.reference)) return `No claim number on ${last.path}.`;
  if (last.stepState !== "done" || !/Done/.test(last.stepText)) {
    return `Step 1 was ${last.stepState || "missing"} on ${last.reference}. ${last.stepText.replace(/\s+/g, " ")}`;
  }
  return { reference: last.reference };
}

function storedJourney(dbPath: string, reference: string) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA query_only = ON;");
    return db
      .prepare(
        `SELECT c.file_reference, c.claim_type, c.roadworthiness, c.needs_replacement, c.needs_recovery,
                c.other_contact_skipped, p.home_tel, p.mobile_tel
         FROM claims c JOIN people p ON p.id = c.client_person_id
         WHERE c.file_reference = ?`,
      )
      .get(reference) as
      | {
          file_reference: string;
          claim_type: string;
          roadworthiness: string;
          needs_replacement: number;
          needs_recovery: number;
          other_contact_skipped: number;
          home_tel: string | null;
          mobile_tel: string | null;
        }
      | undefined;
  } finally {
    db.close();
  }
}

async function main() {
  if (JOURNEY_STAGE !== "create") {
    console.error("This script only runs the create stage. Extend it with the journey file.");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build, then npm run test:journeys.");
    process.exitCode = 1;
    return;
  }

  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-journey-db-"));
  const databasePath = path.join(databaseDir, "cas-crm.sqlite");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: databasePath, EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    serverLog = (serverLog + chunk.toString("utf8")).slice(-2000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    serverLog = (serverLog + chunk.toString("utf8")).slice(-2000);
  });
  const stopServer = () => {
    if (child.exitCode === null && !child.killed) child.kill();
    try {
      fs.rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      /* The database file can still be open for a moment. */
    }
  };

  let stopBrowser: () => void = () => undefined;
  const results: Array<{ id: string; reference?: string; problem?: string }> = [];
  try {
    await waitUntilReady(origin, child);
    const cookie = await signIn(origin);
    const browser = await openBrowser();
    stopBrowser = browser.stop;
    const [cookieName, ...cookieRest] = cookie.split("=");
    await browser.session.send("Network.setCookie", { name: cookieName, value: cookieRest.join("="), url: origin });

    for (const journey of CLAIM_JOURNEYS) {
      const created = await createJourney(browser.session, origin, journey);
      if (typeof created === "string") {
        results.push({ id: journey.id, problem: created });
        console.log(`FAIL  ${journey.title}  ${created}`);
        continue;
      }
      const row = storedJourney(databasePath, created.reference);
      if (!row) {
        results.push({ id: journey.id, problem: `${created.reference} was not in the test database.` });
        console.log(`FAIL  ${journey.title}  ${created.reference} was not stored.`);
        continue;
      }
      const problems: string[] = [];
      if (row.other_contact_skipped !== 1) problems.push("other number was not skipped");
      if (row.home_tel) problems.push(`other number stored as ${row.home_tel}`);
      if (row.mobile_tel !== JOURNEY_PHONE_WARNING) problems.push(`mobile stored as ${row.mobile_tel || "blank"}`);
      if (row.claim_type !== journey.claimType) problems.push(`liability ${row.claim_type}`);
      if (row.roadworthiness !== journey.roadworthiness) problems.push(`roadworthiness ${row.roadworthiness}`);
      if (Boolean(row.needs_replacement) !== journey.needsReplacement) problems.push("replacement flag");
      if (Boolean(row.needs_recovery) !== journey.needsRecovery) problems.push("recovery flag");
      if (problems.length) {
        results.push({ id: journey.id, reference: created.reference, problem: problems.join("; ") });
        console.log(`FAIL  ${journey.title}  ${created.reference}  ${problems.join("; ")}`);
      } else {
        results.push({ id: journey.id, reference: created.reference });
        console.log(`PASS  ${journey.title}  ${created.reference}  step 1 done`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The journey check failed.");
    if (serverLog.trim()) console.error(serverLog.trim());
    process.exitCode = 1;
  } finally {
    stopBrowser();
    stopServer();
  }

  const failed = results.filter((item) => item.problem);
  if (failed.length || results.length !== CLAIM_JOURNEYS.length) {
    process.exitCode = 1;
    console.error(`${failed.length || CLAIM_JOURNEYS.length} journey check${failed.length === 1 ? "" : "s"} failed.`);
    return;
  }
  console.log("Journey checks passed. Email stayed on simulate. The demonstration database was not used.");
}

main();

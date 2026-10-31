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
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { stopBrowserProfile } from "./stop-browser-profile.ts";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { totpCode } from "../src/lib/auth/totp.ts";
import { CLAIM_JOURNEYS, JOURNEY_PHONE_WARNING, type ClaimJourney, type JourneyId } from "../tests/journeys/claim-journeys.ts";

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

export class BrowserSession {
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

export function passwordFor(name: string, username: string): string {
  const notes = fs.readFileSync(path.join(process.cwd(), "docs", "AUTH-NOTES.md"), "utf8");
  const line = notes.split(/\r?\n/).find((row) => row.includes(`| ${name} |`));
  const cells = line?.split("|").map((cell) => cell.trim().replaceAll("`", "")) ?? [];
  if (cells[2] !== username || !cells[3]) {
    throw new Error(`The ${name} test sign-in is not in docs/AUTH-NOTES.md in the expected place.`);
  }
  return cells[3];
}

export function sianPassword(): string {
  return passwordFor("Sian Evans", "sian");
}

export function freePort(start = 3200): Promise<number> {
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

export async function waitUntilReady(origin: string, child: ChildProcess): Promise<void> {
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

/**
 * Signs in. An administrator (and anyone who switched it on) has the authenticator step (J15): on a fresh test
 * database the app shows a new key to set up, which is read from the page; afterwards the key is read from the test
 * database given. The code is worked out the way an authenticator app does.
 */
export async function signIn(origin: string, username = "sian", password = sianPassword(), databasePath?: string): Promise<string> {
  const response = await fetch(`${origin}/login/submit`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, next: "/" }),
  });
  const location = response.headers.get("location") || "";
  if (location && ["/login/setup", "/login/code"].includes(new URL(location, origin).pathname)) {
    const step = location.endsWith("/login/setup") ? "setup" : "code";
    const set = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    const challenge = (set.find((item) => item.startsWith("cas_challenge=")) || "").split(";")[0];
    let secret = "";
    if (step === "setup") {
      const page = await fetch(`${origin}/login/setup`, { headers: { cookie: challenge } }).then((r) => r.text());
      secret = /data-totp-secret="([A-Z2-7]+)"/.exec(page)?.[1] || "";
    } else if (databasePath) {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        secret = String((db.prepare(`SELECT totp_secret FROM staff WHERE lower(username) = ?`).get(username.toLowerCase()) as { totp_secret?: string } | undefined)?.totp_secret || "");
      } finally {
        db.close();
      }
    }
    if (!secret) throw new Error(`Sign-in as ${username} needs the authenticator step and no key was found.`);
    const done = await fetch(`${origin}/login/code/submit`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: challenge },
      body: new URLSearchParams({ code: totpCode(secret), step }),
    });
    const cookie = sessionCookie(done);
    if (!cookie || done.status !== 303) throw new Error(`Sign-in as ${username} did not pass the authenticator step.`);
    return cookie;
  }
  const cookie = sessionCookie(response);
  if (!cookie || response.status !== 303) throw new Error(`Sign-in as ${username} did not return a session.`);
  return cookie;
}

export async function openBrowser(): Promise<{ session: BrowserSession; stop: () => void }> {
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
    if (browser.exitCode === null && !browser.killed) stopTree(browser);
    stopBrowserProfile(userData);
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
    // R50: no postcode in "Cardiff", so the suggestion is Not yet known; staff choose England & Wales here.
    notes.push(setControl("jurisdiction", "england_wales"));
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

export async function createJourney(session: BrowserSession, origin: string, journey: ClaimJourney): Promise<{ reference: string } | string> {
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

export function storedJourney(dbPath: string, reference: string) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA query_only = ON;");
    return db
      .prepare(
        `SELECT c.id, c.file_reference, c.claim_type, c.roadworthiness, c.needs_replacement, c.needs_recovery,
                c.other_contact_skipped, p.home_tel, p.mobile_tel
         FROM claims c JOIN people p ON p.id = c.client_person_id
         WHERE c.file_reference = ?`,
      )
      .get(reference) as
      | {
          id: string;
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

type MadeClaim = { id: JourneyId; reference: string; claimId: string };

export async function gotoPath(session: BrowserSession, origin: string, path: string) {
  await session.send("Page.navigate", { url: `${origin}${path}` });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await session.evaluate<string>(`location.pathname`);
    if (current === path.split("?")[0]) {
      const ready = await session.evaluate<boolean>(`document.readyState === "complete" && document.body.innerText.length > 20`);
      if (ready) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The page did not open: ${path}`);
}

export async function postFields(session: BrowserSession, path: string, fields: Record<string, string>) {
  const spec = JSON.stringify({ path, fields });
  return session.evaluate<{ status: number; location: string }>(`(() => {
    const spec = ${spec};
    const body = new URLSearchParams(spec.fields);
    if (!body.get("submitKey")) body.set("submitKey", crypto.randomUUID());
    return fetch(spec.path, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
}

export function readDb<T>(dbPath: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

/**
 * The journey database starts from the fictional seed. Two changes are made before the hire journeys:
 * CAS 2's booking on TEST-0003 is moved into the past while the car is still out, so a car on hire with a booking
 * past its end date is on the fleet; and CAS 6 comes back from the bodyshop, so the three files have three free cars.
 */
function prepareFleet(dbPath: string) {
  readDb(dbPath, (db) => {
    const ended = new Date(Date.now() - 10 * 86_400_000).toISOString();
    db.prepare(`UPDATE reservations SET end_at = ? WHERE id = 'r-c3'`).run(ended);
    db.prepare(`UPDATE fleet_vehicles SET status = 'available', location = 'CAS yard, Bridgend' WHERE id = 'fv-6'`).run();
  });
}

export function londonToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const HIRE_DAY = londonToday();
const HIRE_DAY_UK = HIRE_DAY.split("-").reverse().join("/");

export type Submitted = { status: number; location: string; problem?: string };

/**
 * Fills a form on the page by its field names and submits it the way the button would.
 * A file is attached as a small fictional PDF.
 */
export async function submitForm(
  session: BrowserSession,
  selector: string,
  values: Record<string, string>,
  files: string[] = [],
): Promise<Submitted> {
  const spec = JSON.stringify({ selector, values, files });
  return session.evaluate<Submitted>(`(() => {
    const spec = ${spec};
    const form = document.querySelector(spec.selector);
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No form " + spec.selector };
    for (const [name, value] of Object.entries(spec.values)) {
      const fields = [...form.querySelectorAll('[name="' + name + '"]')];
      if (fields.length === 0) return { status: 0, location: "", problem: "No field " + name };
      for (const field of fields) {
        if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
          field.checked = field.value === value || (field.type === "checkbox" && value === "on");
        } else {
          field.value = value;
        }
      }
    }
    const body = new FormData(form);
    if (!body.get("submitKey")) body.set("submitKey", crypto.randomUUID());
    for (const name of spec.files) {
      const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);
      body.set(name, new File([bytes], name + ".pdf", { type: "application/pdf" }));
    }
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
}

export function followed(result: Submitted, label: string): string | null {
  if (result.problem) return `${label}: ${result.problem}`;
  const location = decodeURIComponent(result.location.replaceAll("+", " "));
  if (result.status >= 400 || result.status === 0 || location.includes("error=")) return `${label} ${result.status} ${location}`;
  return null;
}

export function refusedWith(result: Submitted, words: RegExp, label: string): string | null {
  if (result.problem) return `${label}: ${result.problem}`;
  const location = decodeURIComponent(result.location.replaceAll("+", " "));
  if (!location.includes("error=")) return `${label} was not refused. ${location}`;
  if (!words.test(location)) return `${label} was refused for the wrong reason. ${location}`;
  return null;
}

export async function saveClientDetails(session: BrowserSession, origin: string, dbPath: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/details/client`);
  const filled = await session.evaluate<string>(`(() => {
    ${FILL}
    for (const box of document.querySelectorAll('input[type="checkbox"]')) {
      if (box instanceof HTMLInputElement && box.name.startsWith("saveAnyway_") && !box.checked) box.click();
    }
    return [setControl("address", "12 Journey Road\\nCardiff"), setControl("postcode", "CF10 1AA"), setControl("dob", "1985-04-12")].join("|");
  })()`);
  if (filled.includes("missing")) return `client fields ${filled}`;
  await session.evaluate<void>(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen");
    if (!button) throw new Error("Save this screen was not on the client page.");
    button.click();
  })()`);
  const deadline = Date.now() + 20_000;
  let retried = false;
  while (Date.now() < deadline) {
    const stored = readDb(dbPath, (db) =>
      db
        .prepare(`SELECT p.date_of_birth AS dob, p.postcode FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`)
        .get(claimId) as { dob: string | null; postcode: string | null },
    );
    if (stored.dob === "1985-04-12" && stored.postcode === "CF10 1AA") return null;
    const page = await session.evaluate<{ error: string }>(`({ error: document.querySelector("[data-form-error]")?.innerText || "" })`);
    if (page.error && /Save anyway/.test(page.error) && !retried) {
      retried = true;
      await session.evaluate<void>(`(() => {
        for (const box of document.querySelectorAll('input[type="checkbox"]')) {
          if (box instanceof HTMLInputElement && box.name.startsWith("saveAnyway_") && !box.checked) box.click();
        }
        [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen")?.click();
      })()`);
      continue;
    }
    if (page.error && !/Save anyway/.test(page.error)) return page.error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "The client address and date of birth were not saved.";
}

function claimFiles(dbPath: string, claimId: string, documentType: string) {
  return readDb(dbPath, (db) =>
    db
      .prepare(`SELECT id, title FROM documents WHERE claim_id = ? AND document_type = ? ORDER BY created_at ASC, rowid ASC`)
      .all(claimId, documentType) as Array<{ id: string; title: string | null }>,
  );
}

export async function saveLicenceCheck(session: BrowserSession, origin: string, claimId: string, licenceNumber: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const box = await session.evaluate<boolean>(`Boolean(document.querySelector('form[action$="/prehire/save"] [data-licence-number-box] input[name="licenceNumber"]'))`);
  if (!box) return "The licence card did not ask for the missing licence number.";
  const withoutNumber = await submitForm(
    session,
    'form[action$="/prehire/save"]',
    { licenceNumber: "", category: "B", penaltyPoints: "0", licenceExpiresOn: "2030-01-01", result: "ok" },
  );
  const refused = refusedWith(withoutNumber, /licence number/, "Licence check with no licence number");
  if (refused) return refused;
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const saved = await submitForm(
    session,
    'form[action$="/prehire/save"]',
    { licenceNumber, category: "B", penaltyPoints: "0", licenceExpiresOn: "2030-01-01", result: "ok" },
    ["document"],
  );
  return followed(saved, "licence check");
}

async function uploadBankStatement(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  return followed(
    await submitForm(session, 'form[action$="/hire/bank"]', { statementPeriod: "July to September 2026" }, ["document"]),
    "bank statement",
  );
}

export async function saveNoBank(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  return followed(
    await submitForm(session, 'form[action$="/hire/no-bank"]', { noBank: "yes", explanation: "The client has no bank account." }),
    "no bank account",
  );
}

export async function setDailyRate(session: BrowserSession, origin: string, claimId: string, group: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const missing = await session.evaluate<string>(`document.querySelector("[data-rate]")?.getAttribute("data-rate") || ""`);
  if (missing !== "missing") return `The Hire tab did not say the daily rate is missing (${missing || "no rate box"}).`;
  return followed(await submitForm(session, 'form[action$="/hire/rate"]', { group }), "daily rate");
}

function countOnHire(dbPath: string) {
  return readDb(dbPath, (db) => Number((db.prepare(`SELECT COUNT(*) AS n FROM fleet_vehicles WHERE status = 'on_hire'`).get() as { n: number }).n));
}

export function hireFacts(dbPath: string, claimId: string) {
  return readDb(dbPath, (db) => {
    const episode = db
      .prepare(
        `SELECT he.started_at, he.fleet_vehicle_id, he.rate_pence_per_day, he.rate_taken_on, v.registration
         FROM hire_episodes he
         LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
         LEFT JOIN vehicles v ON v.id = fv.vehicle_id
         WHERE he.claim_id = ? AND he.fleet_vehicle_id IS NOT NULL
         ORDER BY CASE WHEN he.collection_at IS NULL AND he.billing_end_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(claimId) as
      | { started_at: string | null; fleet_vehicle_id: string; rate_pence_per_day: number | null; rate_taken_on: string | null; registration: string | null }
      | undefined;
    const job = db
      .prepare(
        `SELECT id, assignee_id, planned_at, place_text FROM day_assignments
         WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL LIMIT 1`,
      )
      .get(claimId) as { id: string; assignee_id: string | null; planned_at: string | null; place_text: string | null } | undefined;
    const docs = db
      .prepare(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key IN ('hire_agreement', 'hire_pack')`)
      .get(claimId) as { n: number };
    const licence = db
      .prepare(`SELECT p.licence_number AS n FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`)
      .get(claimId) as { n: string | null };
    return { episode, job, documents: Number(docs.n), licenceNumber: licence.n || "" };
  });
}

async function offeredCars(session: BrowserSession) {
  return session.evaluate<string[]>(`(() => {
    const select = document.querySelector('form[action$="/hire/choose"] [name="fleetVehicleId"]');
    if (!(select instanceof HTMLSelectElement)) return [];
    return [...select.options].map((item) => item.value).filter(Boolean);
  })()`);
}

export async function chooseFirstCar(session: BrowserSession, origin: string, claimId: string, driverId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire?date=${HIRE_DAY}`);
  const options = await offeredCars(session);
  if (!options.length) return { problem: "No free car was offered." };
  const picked = options[0];
  const sent = await submitForm(session, 'form[action$="/hire/choose"]', {
    fleetVehicleId: picked,
    method: "deliver",
    driverId,
    date: HIRE_DAY,
    time: "09:30",
  });
  const problem = followed(sent, "Reserve this car");
  if (problem) return { problem };
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const chosen = await session.evaluate<{ registration: string; summary: string }>(`({
    registration: document.querySelector("[data-chosen-car]")?.getAttribute("data-chosen-car") || "",
    summary: document.querySelector("[data-car-summary]")?.textContent?.replace(/\\s+/g, " ").trim() || "",
  })`);
  if (!chosen.registration) return { problem: "The car was not kept after Reserve this car." };
  return { fleetId: picked, registration: chosen.registration, summary: chosen.summary, options };
}

export function londonTimeNow(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

/** Fills the "Before the client signs" box. Transmission and date of issue are sent only when the box asks for them. */
async function fillBeforeSigning(session: BrowserSession, values: Record<string, string>): Promise<string | null> {
  const spec = JSON.stringify(values);
  const result = await session.evaluate<Submitted>(`(() => {
    const values = ${spec};
    const form = document.querySelector('form[action$="/hire/before-signing"]');
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No before-signing form" };
    const body = new FormData(form);
    for (const [name, value] of Object.entries(values)) {
      if (form.querySelector('[name="' + name + '"]')) body.set(name, value);
    }
    body.set("submitKey", crypto.randomUUID());
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((r) => ({ status: r.status, location: r.url }));
  })()`);
  return followed(result, "before signing");
}

/** R22: the boxes for details missing on the chosen car's fleet record. Only the boxes on the page are filled. */
async function fillCarDetails(session: BrowserSession, values: Record<string, string>): Promise<string | null> {
  const spec = JSON.stringify(values);
  const result = await session.evaluate<Submitted>(`(() => {
    const values = ${spec};
    const form = document.querySelector('form[action$="/hire/car-details"]');
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No car details form" };
    const body = new FormData(form);
    for (const [name, value] of Object.entries(values)) {
      if (form.querySelector('[name="' + name + '"]')) body.set(name, value);
    }
    body.set("submitKey", crypto.randomUUID());
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((r) => ({ status: r.status, location: r.url }));
  })()`);
  return followed(result, "car details");
}

function fleetCarRecord(dbPath: string, fleetVehicleId: string) {
  return readDb(dbPath, (db) =>
    db
      .prepare(`SELECT v.transmission, v.seats, v.colour, v.gta_group, v.fuel FROM fleet_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.id = ?`)
      .get(fleetVehicleId) as { transmission: string | null; seats: number | null; colour: string | null; gta_group: string | null; fuel: string | null } | undefined,
  );
}

export async function completeHandover(session: BrowserSession, origin: string, claimId: string, signed: boolean) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const sent = await submitForm(
    session,
    'form[action$="/hire/handover"]',
    // The car goes out after the client signs, so the handover time is now (R2).
    { mileage: "1500", date: HIRE_DAY, time: londonTimeNow(), fuelLevel: "full" },
    signed ? ["signedAgreement"] : [],
  );
  return sent;
}

/**
 * Route (a): office sends the signing link (simulated email), the link is read from the email filed on the claim,
 * and the client signs on that page: name, a drawn signature, the agreement tick.
 */
async function signThroughLink(session: BrowserSession, origin: string, dbPath: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const sent = followed(
    await submitForm(session, 'form[action$="/hire/esign-link"]', { to: "journey.client@example.test" }),
    "Send signing link",
  );
  if (sent) return sent;
  const body = readDb(dbPath, (db) =>
    String(
      (db
        .prepare(`SELECT body FROM correspondence WHERE claim_id = ? AND template_key = 'hire_agreement_signing_link' ORDER BY created_at DESC LIMIT 1`)
        .get(claimId) as { body: string } | undefined)?.body || "",
    ),
  );
  const link = /\/sign\/[A-Za-z0-9_-]+/.exec(body)?.[0];
  if (!link) return "The signing link was not in the email filed on the claim.";
  await gotoPath(session, origin, link);
  const drawn = await session.evaluate<string>(`(() => {
    const canvas = document.querySelector('canvas[aria-label="Signature"]');
    if (!(canvas instanceof HTMLCanvasElement)) return "no signature box";
    const box = canvas.getBoundingClientRect();
    const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: "pen", isPrimary: true,
      clientX: box.left + x * box.width, clientY: box.top + y * box.height,
    }));
    fire("pointerdown", 0.1, 0.6);
    for (let i = 1; i <= 12; i += 1) fire("pointermove", 0.1 + i * 0.06, 0.6 - Math.sin(i / 2) * 0.3);
    fire("pointerup", 0.85, 0.5);
    const hidden = document.querySelector('[name="signaturePng"]');
    const tick = document.querySelector('[name="agreed"]');
    if (tick instanceof HTMLInputElement && !tick.checked) tick.click();
    return hidden instanceof HTMLInputElement && hidden.value.startsWith("data:image/png") ? "drawn" : "not drawn";
  })()`);
  if (drawn !== "drawn") return `The signature could not be drawn (${drawn}).`;
  await session.evaluate<void>(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Sign the agreement");
    button?.click();
  })()`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await session.evaluate<{ thanks: boolean; error: string }>(`({
      thanks: Boolean(document.querySelector("[data-sign-thanks]")),
      error: document.querySelector("[data-form-error]")?.textContent || "",
    })`);
    if (state.thanks) break;
    if (state.error) return state.error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const signed = readDb(dbPath, (db) =>
    db.prepare(`SELECT status, signer_name, device FROM esign_requests WHERE claim_id = ? ORDER BY requested_at DESC LIMIT 1`).get(claimId) as
      | { status: string; signer_name: string | null; device: string | null }
      | undefined,
  );
  if (signed?.status !== "signed" || !signed.signer_name || !signed.device) return `The signing was not recorded (${signed?.status || "none"}).`;
  return null;
}

async function recordRecoveryJourney(session: BrowserSession, origin: string, dbPath: string, claimId: string) {
  const before = readDb(dbPath, (db) =>
    db.prepare(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'recovery' AND claimed_pence > 0`).get(claimId) as { n: number },
  );
  if (Number(before.n) !== 0) return "Recovery money was on the file before the recovery was recorded.";
  await gotoPath(session, origin, `/claims/${claimId}/money/recovery`);
  const offered = await session.evaluate<{ standard: boolean; amount: string; open: string }>(`({
    standard: Boolean(document.querySelector('[name="recoveryTick_standard"]')?.checked),
    amount: document.querySelector('[name="recoveryAmount_standard"]')?.value || "",
    open: document.querySelector("[data-recovery-step]")?.getAttribute("data-recovery-step") || "",
  })`);
  if (offered.open !== "open" || !offered.standard || offered.amount !== "395") {
    return `The recovery form did not offer the standard £395 to confirm (${JSON.stringify(offered)}).`;
  }
  const sent = followed(
    await submitForm(session, 'form[action$="/recovery/record"]', {
      arrivedDate: HIRE_DAY,
      arrivedTime: "00:05",
      carCondition: "Front end crushed, coolant leaking.",
      notDriveable: "unsafe",
    }),
    "Record recovery",
  );
  if (sent) return sent;
  const after = readDb(dbPath, (db) => ({
    line: db.prepare(`SELECT claimed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'recovery'`).get(claimId) as { claimed_pence: number } | undefined,
    claim: db.prepare(`SELECT storage_started_on FROM claims WHERE id = ?`).get(claimId) as { storage_started_on: string | null },
  }));
  if (after.line?.claimed_pence !== 47400) return `Recovery claimed ${after.line?.claimed_pence ?? "nothing"}, not £474.00.`;
  if (after.claim.storage_started_on !== HIRE_DAY) return `Storage did not start on the day the car arrived at the yard (${after.claim.storage_started_on}).`;
  await gotoPath(session, origin, `/claims/${claimId}`);
  const step = await session.evaluate<string>(`document.querySelector('[data-step="recovery"]')?.getAttribute("data-state") || ""`);
  if (step !== "done") return `Step 2 was ${step || "missing"} after recording the recovery.`;
  return null;
}

async function hireOutline(session: BrowserSession) {
  return session.evaluate<{
    count: number;
    statuses: string[];
    bank: boolean;
    error: string;
    still: string;
    produce: number;
    links: number;
    text: string;
  }>(`(() => {
    const steps = [...document.querySelectorAll("[data-hire-step]")];
    const error = document.querySelector("[data-form-error]");
    return {
      count: steps.length,
      statuses: steps.map((item) => item.getAttribute("data-status") || ""),
      bank: Boolean(document.querySelector("[data-bank-step]")),
      error: error?.textContent?.replace(/\\s+/g, " ").trim() || "",
      still: document.querySelector("[data-still-needed]")?.textContent?.replace(/\\s+/g, " ").trim() || "",
      produce: [...document.querySelectorAll("button")].filter((item) => (item.textContent || "").includes("Produce agreement for signature")).length,
      links: error ? error.querySelectorAll("a").length : 0,
      text: document.body.innerText,
    };
  })()`);
}

async function pageText(origin: string, path: string, cookie: string) {
  const response = await fetch(`${origin}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: response.status, text: await response.text() };
}

async function runHireJourneys(session: BrowserSession, origin: string, dbPath: string, made: MadeClaim[], officeCookie: string) {
  const repairable = made.find((item) => item.id === "repairable");
  const totalLoss = made.find((item) => item.id === "total-loss");
  const fault = made.find((item) => item.id === "fault-courtesy");
  if (!repairable || !totalLoss || !fault) return "The three files were not all created.";
  prepareFleet(dbPath);

  // 0. Step 2: no recovery money until the recovery is recorded. Then the standard fee is confirmed and storage starts.
  const recovery = await recordRecoveryJourney(session, origin, dbPath, repairable.claimId);
  if (recovery) return `Repairable recovery: ${recovery}`;

  // 1. A new blank non-fault file. Address and date of birth are typed on the client's details.
  const details = await saveClientDetails(session, origin, dbPath, repairable.claimId);
  if (details) return `Repairable client details: ${details}`;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const needSent = await submitForm(session, 'form[action$="/hire/need"]', {
    choice: "yes",
    reason: "The client's car cannot be driven and is needed for work.",
  });
  const needProblem = followed(needSent, "Hire needed");
  if (needProblem) return needProblem;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const opened = await hireOutline(session);
  if (opened.count !== 5) return `Repairable showed ${opened.count} hire steps, not 5.`;
  if (opened.error) return `Repairable showed an error before anything was pressed. ${opened.error}`;
  if (!opened.still.includes("licence check") || !opened.still.includes("bank statements")) {
    return `Repairable did not say what is still needed. ${opened.still}`;
  }
  if (!opened.bank) return "Repairable hid the bank-statement step.";
  if (opened.produce > 1) return `Repairable showed ${opened.produce} Produce agreement buttons.`;

  // 2. Only genuinely free cars. CAS 2 is out on TEST-0003 with a booking that ended ten days ago.
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire?date=${HIRE_DAY}`);
  const offered = await offeredCars(session);
  for (const held of ["fv-1", "fv-2", "fv-3", "fv-5", "fv-7", "fv-8", "fv-9"]) {
    if (offered.includes(held)) return `A car that is not free (${held}) was offered: ${offered.join(", ")}.`;
  }
  const fleetPage = await pageText(origin, "/hire", officeCookie);
  if (!/Fleet records to check/.test(fleetPage.text) || !/ended .* but the car has not been returned/.test(fleetPage.text)) {
    return "Hire / Fleet did not list CAS 2 under Fleet records to check.";
  }

  // 3. Reserve with a driver. The job is on Driver jobs and on that driver's My jobs today.
  const before = countOnHire(dbPath);
  const chosen = await chooseFirstCar(session, origin, repairable.claimId, "staff-driver");
  if ("problem" in chosen) return `Repairable car: ${chosen.problem}`;
  if (!/reserved for .*delivery · driver Demo Driver/.test(chosen.summary)) return `The chosen car did not collapse to one line. ${chosen.summary}`;
  const facts = hireFacts(dbPath, repairable.claimId);
  if (!facts.job) return "Repairable: no driver delivery job was saved.";
  if (facts.job.assignee_id !== "staff-driver") return "Repairable: the delivery job was not on the chosen driver.";
  if (!facts.job.planned_at || !facts.job.place_text) return "Repairable: the delivery job has no date or address.";
  if (facts.episode?.started_at) return "Repairable: choosing a car started the hire.";
  const driverJobs = await pageText(origin, "/driver-jobs", officeCookie);
  if (!driverJobs.text.includes(`data-driver-job="${repairable.reference}"`) || !driverJobs.text.includes('data-driver-assignee="staff-driver"')) {
    return "The delivery was not on the office Driver jobs list for the chosen driver.";
  }
  const driverCookie = await signIn(origin, "driver", passwordFor("Demo Driver", "driver"));
  const myJobs = await pageText(origin, "/jobs", driverCookie);
  if (!myJobs.text.includes(repairable.reference)) return "The delivery was not on the driver's My jobs today.";

  // 4. The agreement is refused while the checks are missing, with a link for each.
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const blocked = await submitForm(session, 'form[action$="/hire/agreement"]', {});
  const blockedText = decodeURIComponent(blocked.location.replaceAll("+", " "));
  if (!/licence check/i.test(blockedText) || !/bank statement/i.test(blockedText)) {
    return `Produce agreement was not blocked by the checks. ${blockedText}`;
  }
  await session.send("Page.navigate", { url: blocked.location });
  const shown = Date.now() + 15_000;
  let listed = await hireOutline(session);
  while (Date.now() < shown && listed.links < 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    listed = await hireOutline(session);
  }
  if (listed.links < 2) return `The block did not link each missing check. ${listed.error}`;

  // 5. Licence number typed on the check card, then the check, then the bank statement.
  const licence = await saveLicenceCheck(session, origin, repairable.claimId, "JOURN850412AB9CD");
  if (licence) return `Repairable licence check: ${licence}`;
  if (hireFacts(dbPath, repairable.claimId).licenceNumber !== "JOURN850412AB9CD") return "The licence number was not saved to the client's record.";
  const licenceFiles = claimFiles(dbPath, repairable.claimId, "licence_check");
  if (licenceFiles.length !== 1 || !String(licenceFiles[0].title || "").startsWith("Licence check")) {
    return "Repairable licence upload was not labelled and stored once.";
  }
  const bank = await uploadBankStatement(session, origin, repairable.claimId);
  if (bank) return `Repairable bank statement: ${bank}`;
  const bankFiles = claimFiles(dbPath, repairable.claimId, "bank_statements");
  if (bankFiles.length !== 1 || !String(bankFiles[0].title || "").startsWith("Bank statement")) {
    return "Repairable bank statement was not labelled and counted once.";
  }

  // 6. Still refused: the client's car has no group, so there is no daily rate. Then the rate is set.
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const noRate = refusedWith(await submitForm(session, 'form[action$="/hire/agreement"]', {}), /daily rate/, "Agreement with no daily rate");
  if (noRate) return noRate;
  const rate = await setDailyRate(session, origin, repairable.claimId, "S3");
  if (rate) return `Repairable rate: ${rate}`;
  const stored = hireFacts(dbPath, repairable.claimId).episode;
  if (!stored?.rate_pence_per_day || stored.rate_taken_on !== HIRE_DAY) return "The daily rate was not stored on the hire with today's date.";

  // R22: the chosen car has no gearbox, seats or GTA group on its fleet record. Staff enter them on the hire screen once.
  const carId = stored.fleet_vehicle_id;
  readDb(dbPath, (db) => {
    db.prepare(`UPDATE vehicles SET transmission = NULL, seats = NULL, gta_group = NULL WHERE id = (SELECT vehicle_id FROM fleet_vehicles WHERE id = ?)`).run(carId);
  });
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const missingCar = refusedWith(await submitForm(session, 'form[action$="/hire/agreement"]', {}), /hire car gearbox.*seats.*GTA group/i, "Agreement with car details missing");
  if (missingCar) return missingCar;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const carDetailsSaved = await fillCarDetails(session, { transmission: "Manual", seats: "5", gtaGroup: "S3", fuel: "Petrol", colour: "Grey", location: "CAS yard" });
  if (carDetailsSaved) return `Car details: ${carDetailsSaved}`;
  const record = fleetCarRecord(dbPath, carId);
  if (record?.transmission !== "Manual" || record?.seats !== 5 || record?.gta_group !== "S3") {
    return "The car details entered on the hire screen were not saved to the fleet record.";
  }

  // R27: the client's own car has no group on the file, so the agreement waits for it (or a reason) on the Hire tab.
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const noClientGroup = refusedWith(await submitForm(session, 'form[action$="/hire/agreement"]', {}), /client's own car group/i, "Agreement with no client car group");
  if (noClientGroup) return noClientGroup;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const groupSaved = followed(await submitForm(session, 'form[action$="/hire/group-check"]', { clientGroup: "S3" }), "group check");
  if (groupSaved) return groupSaved;

  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  // R1: mileage and fuel out, and the licence date of issue, go on the agreement before the client signs.
  const readings = await fillBeforeSigning(session, { mileage: "1500", fuelLevel: "full", licenceIssuedOn: "2015-06-01" });
  if (readings) return `Before signing: ${readings}`;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const produced = followed(await submitForm(session, 'form[action$="/hire/agreement"]', {}), "agreement");
  if (produced) return produced;
  if (hireFacts(dbPath, repairable.claimId).documents < 1) return "Repairable agreement was not stored.";
  const agreementBody = readDb(dbPath, (db) =>
    String(
      (db.prepare(`SELECT body_html FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(repairable.claimId) as { body_html: string } | undefined)?.body_html || "",
    ),
  );
  if (!/Transmission: Manual/.test(agreementBody) || !/Seats: 5/.test(agreementBody) || !/Group of vehicle supplied \(not used for the rate\): S3/.test(agreementBody)) {
    return "The car details saved on the hire screen are not on the agreement.";
  }

  // 7. Handover is refused without a signed agreement. The client signs through the link, then the handover completes.
  const unsigned = refusedWith(await completeHandover(session, origin, repairable.claimId, false), /signed hire agreement/i, "Handover with no signed copy");
  if (unsigned) return unsigned;
  const signedByLink = await signThroughLink(session, origin, dbPath, repairable.claimId);
  if (signedByLink) return `Repairable signing link: ${signedByLink}`;
  const handed = followed(await completeHandover(session, origin, repairable.claimId, false), "handover");
  if (handed) return `Repairable handover: ${handed}`;
  const started = hireFacts(dbPath, repairable.claimId);
  const startedAt = started.episode?.started_at || "";
  const london = startedAt ? new Date(startedAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) : "";
  if (london !== HIRE_DAY_UK) return `Repairable hire started on ${london || "nothing"}, not the handover date.`;
  if (started.episode?.rate_pence_per_day !== stored.rate_pence_per_day) return "The hire did not keep the stored daily rate.";
  const signedFiles = claimFiles(dbPath, repairable.claimId, "signed_hire_agreement");
  if (signedFiles.length !== 1 || signedFiles[0].title !== "Signed hire agreement") return "The signed copy was not filed as Signed hire agreement.";
  const after = countOnHire(dbPath);
  if (after !== before + 1) return `On-hire count did not rise by one (was ${before}, now ${after}).`;

  // 8. The header, the claims list and the next action have moved on.
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  const header = await session.evaluate<{ step: string; summary: string; note: boolean }>(`({
    step: document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || "",
    summary: document.querySelector("#claim-summary")?.textContent?.replace(/\\s+/g, " ") || "",
    note: Boolean(document.querySelector("[data-staff-note]")),
  })`);
  if (header.step !== "done") return `Repairable step 3 was ${header.step || "missing"}.`;
  if (header.note) return `The header still shows a stored note. ${header.summary}`;
  if (/Daily rate missing|no daily rate/i.test(header.summary)) return `The header says the daily rate is missing. ${header.summary}`;
  if (/Next action: Arrange hire/.test(header.summary)) return `The header next action did not move on. ${header.summary}`;
  const list = await pageText(origin, `/claims?q=${encodeURIComponent(repairable.reference)}`, officeCookie);
  if (/intake captured/.test(list.text) || /Pre-hire checks and choose a vehicle/.test(list.text)) return "The claims list still shows the old intake wording.";
  if (/Hire · /.test(list.text)) return "The claims list position still says Hire after the hire started.";

  const refused = await fetch(`${origin}/documents/${bankFiles[0].id}/file`, { headers: { cookie: driverCookie }, redirect: "manual" });
  const refusedText = await refused.text();
  if (refused.status !== 403 || !refusedText.includes("You cannot open that file.")) {
    return `Driver bank statement URL returned ${refused.status}.`;
  }

  // Total loss: the booked car is not offered and a forced booking is refused.
  await gotoPath(session, origin, `/claims/${totalLoss.claimId}/hire`);
  const tlNeed = followed(await submitForm(session, 'form[action$="/hire/need"]', { choice: "not_yet", reason: "" }), "Not yet");
  if (tlNeed) return tlNeed;
  await gotoPath(session, origin, `/claims/${totalLoss.claimId}`);
  const waiting = await session.evaluate<{ state: string; text: string }>(`({
    state: document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || "",
    text: document.querySelector('[data-step="hire"]')?.innerText || "",
  })`);
  if (waiting.state === "done" || waiting.state === "not_needed") return `Not yet closed step 3 (${waiting.state}).`;
  if (!waiting.text.includes("Not yet – client keeps own car")) return `Step 3 did not stay open for not yet. ${waiting.text}`;
  await gotoPath(session, origin, `/claims/${totalLoss.claimId}/hire`);
  const tlYes = followed(await submitForm(session, 'form[action$="/hire/need"]', { choice: "yes", reason: "Car written off. Client needs a car for work." }), "Hire needed later");
  if (tlYes) return tlYes;
  await gotoPath(session, origin, `/claims/${totalLoss.claimId}/hire?date=${HIRE_DAY}`);
  if ((await offeredCars(session)).includes(chosen.fleetId)) return "The booked car was still offered on the second file for the same dates.";
  const forcedSent = await session.evaluate<Submitted>(`(() => {
    const body = new URLSearchParams({
      fleetVehicleId: ${JSON.stringify(chosen.fleetId)},
      method: "deliver",
      date: ${JSON.stringify(HIRE_DAY)},
      time: "10:00",
      address: "2 Test Street, Cardiff",
      returnHash: "#car",
      submitKey: crypto.randomUUID(),
    });
    return fetch(location.pathname + "/choose", { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((r) => ({ status: r.status, location: r.url }));
  })()`);
  const forced = refusedWith(forcedSent, /This car has just been booked/, "Forced booking of a car already booked");
  if (forced) return forced;
  const laterCar = await chooseFirstCar(session, origin, totalLoss.claimId, "");
  if ("problem" in laterCar) return `Total loss car: ${laterCar.problem}`;
  if (laterCar.fleetId === chosen.fleetId) return "Total loss was given the car already booked on the other file.";
  if (!/driver not chosen/.test(laterCar.summary)) return `An unassigned delivery did not say so. ${laterCar.summary}`;
  const noBank = await saveNoBank(session, origin, totalLoss.claimId);
  if (noBank) return `Total loss no bank account: ${noBank}`;
  const tlLicence = await saveLicenceCheck(session, origin, totalLoss.claimId, "JOURN850412TL9CD");
  if (tlLicence) return `Total loss licence check: ${tlLicence}`;
  const tlNoRate = refusedWith(await completeHandover(session, origin, totalLoss.claimId, true), /daily rate/, "Handover with no daily rate");
  if (tlNoRate) return tlNoRate;
  const tlRate = await setDailyRate(session, origin, totalLoss.claimId, "S2");
  if (tlRate) return `Total loss rate: ${tlRate}`;
  const tlHand = followed(await completeHandover(session, origin, totalLoss.claimId, true), "total loss handover");
  if (tlHand) return tlHand;

  // Fault courtesy car: licence check only, no rate, no agreement, no signed copy.
  await gotoPath(session, origin, `/claims/${fault.claimId}/hire`);
  const faultNeed = followed(await submitForm(session, 'form[action$="/hire/need"]', { choice: "yes", reason: "" }), "Courtesy needed");
  if (faultNeed) return faultNeed;
  await gotoPath(session, origin, `/claims/${fault.claimId}/hire`);
  const courtesy = await hireOutline(session);
  if (courtesy.bank) return "The courtesy file showed a bank-statement step.";
  if (courtesy.produce) return "The courtesy file offered a hire agreement.";
  if (/credit hire/i.test(courtesy.text)) return "The courtesy file showed credit-hire wording.";
  if (/taken from Settings|daily rate/i.test(courtesy.text)) return "The courtesy file talked about a daily rate.";
  const faultLicence = await saveLicenceCheck(session, origin, fault.claimId, "JOURN850412FC9CD");
  if (faultLicence) return `Courtesy licence check: ${faultLicence}`;
  const faultCar = await chooseFirstCar(session, origin, fault.claimId, "staff-driver");
  if ("problem" in faultCar) return `Courtesy car: ${faultCar.problem}`;
  const faultHand = followed(await completeHandover(session, origin, fault.claimId, false), "courtesy handover");
  if (faultHand) return faultHand;
  if (hireFacts(dbPath, fault.claimId).documents !== 0) return "The courtesy file stored a hire agreement.";
  await gotoPath(session, origin, `/claims/${fault.claimId}`);
  const faultStep = await session.evaluate<string>(`document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || ""`);
  if (faultStep !== "done") return `Courtesy step 3 was ${faultStep || "missing"}.`;
  return null;
}

export async function stepState(session: BrowserSession, key: string) {
  return session.evaluate<string>(`document.querySelector('[data-step="${key}"]')?.getAttribute("data-state") || ""`);
}

/** Submits the step form for one intent with the date already filled in, as one click would. */
export async function oneClick(session: BrowserSession, intent: string, extra: Record<string, string> = {}) {
  const spec = JSON.stringify({ intent, extra });
  const result = await session.evaluate<Submitted>(`(() => {
    const spec = ${spec};
    const form = document.querySelector('input[name="intent"][value="' + spec.intent + '"]')?.closest("form");
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No form for " + spec.intent };
    const body = new FormData(form);
    for (const [name, value] of Object.entries(spec.extra)) body.set(name, value);
    if (!body.get("occurredOn")) return { status: 0, location: "", problem: spec.intent + " had no date filled in" };
    body.set("submitKey", crypto.randomUUID());
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
  if (result.problem) return result.problem;
  const location = decodeURIComponent(result.location.replaceAll("+", " "));
  if (result.status >= 400 || location.includes("stepError=")) return `${intent}: ${location}`;
  return null;
}

/**
 * Steps 4 to 7. Generating the initial letter marks step 4 as sent. Engineer instructed, report received and
 * sent to the insurer are one click each with today's date. The fault file offers no third-party letter or engineer.
 */
async function runLettersJourney(session: BrowserSession, origin: string, dbPath: string, made: MadeClaim[]) {
  const repairable = made.find((item) => item.id === "repairable");
  const fault = made.find((item) => item.id === "fault-courtesy");
  if (!repairable || !fault) return "The files were not all created.";

  await gotoPath(session, origin, `/claims/${repairable.claimId}/messages`);
  const offered = await session.evaluate<string[]>(`[...document.querySelectorAll('select[name="templateKey"] option')].map((item) => item.textContent || "")`);
  if (!offered.some((text) => text.includes("Email: Initial email to the third-party insurer"))) return "The insurer email was not offered on a non-fault file.";
  const picked = await session.evaluate<string>(`(() => {
    const select = document.querySelector('select[name="templateKey"]');
    if (!(select instanceof HTMLSelectElement)) return "no select";
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "initial_tp_insurer");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return "";
  })()`);
  if (picked) return `Letter choice: ${picked}`;
  await new Promise((resolve) => setTimeout(resolve, 400));
  const holdBack = await session.evaluate<boolean>(`Boolean(document.querySelector('input[name="holdBack"]'))`);
  if (!holdBack) return "The hold-back tick was not offered with the initial letter.";
  await session.evaluate(`[...document.querySelectorAll("button")].find((item) => (item.textContent || "").includes("Generate and open"))?.click()`);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !(await session.evaluate<string>(`location.pathname`)).startsWith("/documents/")) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  if ((await stepState(session, "initial_letter")) !== "done") return "Step 4 was not done after the letter was generated.";

  const chose = await oneClick(session, "route", { route: "engineer", occurredOn: HIRE_DAY });
  if (chose) return `Route: ${chose}`;
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  const instructed = await oneClick(session, "engineer_instructed");
  if (instructed) return instructed;
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  if ((await stepState(session, "engineer")) !== "done") return "Step 5 was not done after one click.";
  const report = followed(await submitForm(session, 'form[action$="/steps/report"]', { outcome: "repairable", estimateNet: "1250.00", estimateVat: "250.00", estimateGross: "1500.00" }), "Report received");
  if (report) return report;
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  if ((await stepState(session, "engineer_report")) !== "done") return "Step 6 was not done after the report was recorded.";
  // R32: the estimate given at step 6 is the amount claimed on the Repairs head.
  const repairsClaimed = readDb(dbPath, (db) => (db.prepare(`SELECT claimed_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'repairs'`).get(repairable.claimId) as { claimed_pence: number } | undefined)?.claimed_pence);
  if (repairsClaimed !== 150000) return `Step 6 estimate was not put on the Repairs head (${repairsClaimed}).`;
  const forwarded = await oneClick(session, "report_sent");
  if (forwarded) return forwarded;
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  if ((await stepState(session, "send_report")) !== "done") return "Step 7 was not done after one click.";
  const dated = readDb(dbPath, (db) =>
    db
      .prepare(
        `SELECT event_type FROM claim_events WHERE claim_id = ? AND event_type IN ('engineer_instructed', 'engineer_report_received', 'engineer_report_sent_to_insurer')`,
      )
      .all(repairable.claimId),
  );
  if (dated.length !== 3) return `Expected three dated steps, found ${dated.length}.`;

  await gotoPath(session, origin, `/claims/${fault.claimId}`);
  const faultPage = await session.evaluate<{ steps: string[]; text: string }>(`({
    steps: [...document.querySelectorAll("[data-step]")].map((item) => item.getAttribute("data-step") || ""),
    text: document.querySelector("[data-claim-problems]")?.textContent || "",
  })`);
  if (faultPage.steps.includes("engineer") || faultPage.steps.includes("initial_letter")) return "The fault file showed an engineer or third-party letter step.";
  if (!faultPage.steps.includes("audatex_send") || !faultPage.steps.includes("own_insurer")) return "The fault file did not show Audatex and the client's own insurer.";
  if (/Instruct the engineer|repair authorisation|licence chase|V5C|Bank statements|liability notification/i.test(faultPage.text)) {
    return `The fault file's problems list mentioned a credit-hire or third-party item: ${faultPage.text}`;
  }
  await gotoPath(session, origin, `/claims/${fault.claimId}/messages`);
  const faultOffered = await session.evaluate<string[]>(`[...document.querySelectorAll('select[name="templateKey"] option')].map((item) => item.textContent || "")`);
  if (faultOffered.some((text) => /third-party insurer|hire pack|rebuttal|liability chaser/i.test(text))) return "The fault file offered a third-party insurer letter or email.";
  return null;
}

/**
 * Steps 8 and 9 on the repairable file after step 7: authorisation, repairs started and complete, car returned,
 * then the storage end and hire end, each confirmed by the handler. The hire end waits until the car is back.
 */
async function runEndingsJourney(session: BrowserSession, origin: string, dbPath: string, made: MadeClaim[]) {
  const repairable = made.find((item) => item.id === "repairable");
  if (!repairable) return "The repairable file was not created.";
  const page = `/claims/${repairable.claimId}`;
  const clicks: Array<[string, Record<string, string>, string | null]> = [
    ["authorisation", { authorised: "1850", reduction: "120", reductionNote: "labour rate reduced" }, "repair_authorisation"],
    ["repairs_started", {}, null],
    ["repairs_complete", {}, null],
    ["car_returned", {}, null],
  ];
  for (const [intent, extra, doneStep] of clicks) {
    await gotoPath(session, origin, page);
    const problem = await oneClick(session, intent, extra);
    if (problem) return problem;
    if (doneStep) {
      await gotoPath(session, origin, page);
      if ((await stepState(session, doneStep)) !== "done") return `Step ${doneStep} was not done after one click.`;
    }
  }
  await gotoPath(session, origin, page);
  const offered = await session.evaluate<string[]>(
    `[...document.querySelectorAll('[data-step="finish"] input[name="intent"]')].map((item) => item.value)`,
  );
  if (!offered.includes("hire_end")) return `Step 9 did not offer the hire end after the car was returned (${offered.join(", ")}).`;
  if (offered.includes("storage_end")) {
    const storage = await oneClick(session, "storage_end", { occurredOn: HIRE_DAY });
    if (storage) return storage;
    await gotoPath(session, origin, page);
  }
  const hire = await oneClick(session, "hire_end", { occurredOn: HIRE_DAY });
  if (hire) return hire;
  await gotoPath(session, origin, page);
  const finish = await stepState(session, "finish");
  if (finish !== "done") {
    const text = await session.evaluate<string>(`document.querySelector('[data-step="finish"]')?.innerText || ""`);
    return `Step 9 was ${finish || "missing"} after the endings were confirmed: ${text.replace(/\s+/g, " ")}`;
  }
  const facts = readDb(dbPath, (db) => ({
    hire: db.prepare(`SELECT billing_end_at FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`).get(repairable.claimId) as
      | { billing_end_at: string | null }
      | undefined,
    agreed: db.prepare(`SELECT COALESCE(SUM(agreed_pence), 0) AS n FROM financial_lines WHERE claim_id = ? AND head_of_loss = 'repairs'`).get(repairable.claimId) as {
      n: number;
    },
  }));
  if (facts.hire?.billing_end_at !== HIRE_DAY) return `Hire end was ${facts.hire?.billing_end_at || "not set"}, not the confirmed day.`;
  if (Number(facts.agreed.n) !== 0) return "Recording the authorisation changed the agreed repair figure.";
  return null;
}

async function main() {
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
    if (child.exitCode === null && !child.killed) stopTree(child);
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
    const made: MadeClaim[] = [];

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
        made.push({ id: journey.id, reference: created.reference, claimId: String(row.id) });
        console.log(`PASS  ${journey.title}  ${created.reference}  step 1 done`);
      }
    }
    if (results.every((item) => !item.problem) && made.length === CLAIM_JOURNEYS.length) {
      const hireProblem = await runHireJourneys(browser.session, origin, databasePath, made, cookie);
      if (hireProblem) {
        results.push({ id: "repairable", problem: hireProblem });
        console.log(`FAIL  Hire  ${hireProblem}`);
      } else {
        console.log("PASS  Recovery and hire  recovery recorded with the confirmed fee, only free cars, driver jobs, licence number, rate, agreement gates, signed copy, status wording, clash, not yet, courtesy");
        const lettersProblem = await runLettersJourney(browser.session, origin, databasePath, made);
        if (lettersProblem) {
          results.push({ id: "repairable", problem: lettersProblem });
          console.log(`FAIL  Letters and engineer  ${lettersProblem}`);
        } else {
          console.log("PASS  Letters and engineer  letter marks step 4, insurer email offered, steps 5 to 7 one click each with a date, fault file on Audatex with no credit-hire items");
          const endingsProblem = await runEndingsJourney(browser.session, origin, databasePath, made);
          if (endingsProblem) {
            results.push({ id: "repairable", problem: endingsProblem });
            console.log(`FAIL  Repairs and endings  ${endingsProblem}`);
          } else {
            console.log("PASS  Repairs and endings  authorisation with a reduction, repairs started and complete, car returned, storage end and hire end confirmed by the handler");
          }
        }
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
  if (failed.length || results.filter((item) => !item.problem).length < CLAIM_JOURNEYS.length) {
    process.exitCode = 1;
    console.error(`${failed.length || CLAIM_JOURNEYS.length} journey check${failed.length === 1 ? "" : "s"} failed.`);
    return;
  }
  console.log("Journey checks passed. Email stayed on simulate. The demonstration database was not used.");
}

/** On Windows the browser and the server start child processes. Stop the whole tree so the check can finish. */
export function stopTree(child: ChildProcess) {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

// Run only when started as the script, so the awkward-case journeys can reuse these helpers.
if (/journey-check\.ts$/.test(process.argv[1] || "")) main().then(() => process.exit(process.exitCode ?? 0));

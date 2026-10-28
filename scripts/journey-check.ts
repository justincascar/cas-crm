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

function passwordFor(name: string, username: string): string {
  const notes = fs.readFileSync(path.join(process.cwd(), "docs", "AUTH-NOTES.md"), "utf8");
  const line = notes.split(/\r?\n/).find((row) => row.includes(`| ${name} |`));
  const cells = line?.split("|").map((cell) => cell.trim().replaceAll("`", "")) ?? [];
  if (cells[2] !== username || !cells[3]) {
    throw new Error(`The ${name} test sign-in is not in docs/AUTH-NOTES.md in the expected place.`);
  }
  return cells[3];
}

function sianPassword(): string {
  return passwordFor("Sian Evans", "sian");
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

async function signIn(origin: string, username = "sian", password = sianPassword()): Promise<string> {
  const response = await fetch(`${origin}/login/submit`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, next: "/" }),
  });
  const cookie = sessionCookie(response);
  if (!cookie || response.status !== 303) throw new Error(`Sign-in as ${username} did not return a session.`);
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

const HIRE_DAY = "2026-11-02";

async function gotoPath(session: BrowserSession, origin: string, path: string) {
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

async function postFields(session: BrowserSession, path: string, fields: Record<string, string>) {
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

function storedLicence(dbPath: string, claimId: string) {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT p.licence_number AS licence
         FROM claims c JOIN people p ON p.id = c.client_person_id
         WHERE c.id = ?`,
      )
      .get(claimId) as { licence: string | null } | undefined;
    return row?.licence || "";
  } finally {
    db.close();
  }
}

async function saveClientLicence(session: BrowserSession, origin: string, dbPath: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/details/client`);
  const filled = await session.evaluate<string>(`(() => {
    ${FILL}
    for (const box of document.querySelectorAll('input[type="checkbox"]')) {
      if (box instanceof HTMLInputElement && box.name.startsWith("saveAnyway_") && !box.checked) box.click();
    }
    return setControl("licenceNumber", "TEST-LIC-0001");
  })()`);
  if (filled !== "TEST-LIC-0001") return `licence field ${filled}`;
  await session.evaluate<void>(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen");
    if (!button) throw new Error("Save this screen was not on the client page.");
    button.click();
  })()`);
  const deadline = Date.now() + 20_000;
  let retried = false;
  while (Date.now() < deadline) {
    if (storedLicence(dbPath, claimId) === "TEST-LIC-0001") return null;
    const page = await session.evaluate<{ href: string; error: string; saved: boolean }>(`({
      href: location.href,
      error: document.querySelector("[data-form-error]")?.innerText || "",
      saved: document.body.innerText.includes("Saved."),
    })`);
    if (page.saved && storedLicence(dbPath, claimId) === "TEST-LIC-0001") return null;
    if (page.error && /Save anyway/.test(page.error) && !retried) {
      retried = true;
      await session.evaluate<void>(`(() => {
        for (const box of document.querySelectorAll('input[type="checkbox"]')) {
          if (box instanceof HTMLInputElement && box.name.startsWith("saveAnyway_") && !box.checked) box.click();
        }
        const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen");
        button?.click();
      })()`);
      continue;
    }
    if (page.error && !/Save anyway/.test(page.error)) return page.error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const stuck = await session.evaluate<{ href: string; text: string }>(`({
    href: location.href,
    text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 400),
  })`);
  return `The client licence was not saved. ${stuck.href} ${stuck.text}`;
}

function claimFiles(dbPath: string, claimId: string, documentType: string) {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare(`SELECT id, title FROM documents WHERE claim_id = ? AND document_type = ? ORDER BY created_at ASC, rowid ASC`)
      .all(claimId, documentType) as Array<{ id: string; title: string | null }>;
  } finally {
    db.close();
  }
}

function followed(result: { status: number; location: string }, label: string): string | null {
  const location = decodeURIComponent(result.location.replaceAll("+", " "));
  if (result.status >= 400 || result.status === 0 || location.includes("error=")) return `${label} ${result.status} ${location}`;
  return null;
}

async function saveLicenceCheck(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const saved = await session.evaluate<{ status: number; location: string; problem?: string }>(`(() => {
    const form = document.querySelector('form[action$="/prehire/save"]');
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No licence form." };
    const category = form.querySelector('[name="category"]');
    const points = form.querySelector('[name="penaltyPoints"]');
    const expiry = form.querySelector('[name="licenceExpiresOn"]');
    const ok = form.querySelector('[name="result"][value="ok"]');
    if (category instanceof HTMLInputElement) category.value = "B";
    if (points instanceof HTMLInputElement) points.value = "0";
    if (expiry instanceof HTMLInputElement) expiry.value = "2030-01-01";
    if (ok instanceof HTMLInputElement) ok.checked = true;
    const body = new FormData(form);
    if (!body.get("submitKey")) body.set("submitKey", crypto.randomUUID());
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);
    body.set("document", new File([bytes], "licence-check.pdf", { type: "application/pdf" }));
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
  if (saved.problem) return saved.problem;
  return followed(saved, "licence check");
}

async function uploadBankStatement(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const saved = await session.evaluate<{ status: number; location: string; problem?: string }>(`(() => {
    const form = document.querySelector('form[action$="/hire/bank"]');
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No bank statement form." };
    const period = form.querySelector('[name="statementPeriod"]');
    if (period instanceof HTMLInputElement) period.value = "July to September 2026";
    const body = new FormData(form);
    if (!body.get("submitKey")) body.set("submitKey", crypto.randomUUID());
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);
    body.set("document", new File([bytes], "statement.pdf", { type: "application/pdf" }));
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
  if (saved.problem) return saved.problem;
  return followed(saved, "bank statement");
}

async function saveNoBank(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const saved = await session.evaluate<{ status: number; location: string; problem?: string }>(`(() => {
    const form = document.querySelector('form[action$="/hire/no-bank"]');
    if (!(form instanceof HTMLFormElement)) return { status: 0, location: "", problem: "No bank-account form." };
    const box = form.querySelector('[name="noBank"]');
    const explanation = form.querySelector('[name="explanation"]');
    if (box instanceof HTMLInputElement) box.checked = true;
    if (explanation instanceof HTMLTextAreaElement) explanation.value = "The client has no bank account.";
    const body = new FormData(form);
    if (!body.get("submitKey")) body.set("submitKey", crypto.randomUUID());
    return fetch(form.action, { method: "POST", body, credentials: "same-origin", redirect: "follow" }).then((response) => ({
      status: response.status,
      location: response.url || "",
    }));
  })()`);
  if (saved.problem) return saved.problem;
  return followed(saved, "no bank account");
}

function countOnHire(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM fleet_vehicles WHERE status = 'on_hire'`).get() as { n: number };
    return Number(row.n);
  } finally {
    db.close();
  }
}

function hireFacts(dbPath: string, claimId: string) {
  const db = new DatabaseSync(dbPath);
  try {
    const episode = db
      .prepare(
        `SELECT he.started_at, he.fleet_vehicle_id, v.registration
         FROM hire_episodes he
         LEFT JOIN fleet_vehicles fv ON fv.id = he.fleet_vehicle_id
         LEFT JOIN vehicles v ON v.id = fv.vehicle_id
         WHERE he.claim_id = ? AND he.fleet_vehicle_id IS NOT NULL
         ORDER BY CASE WHEN he.collection_at IS NULL AND he.billing_end_at IS NULL THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(claimId) as { started_at: string | null; fleet_vehicle_id: string; registration: string | null } | undefined;
    const job = db
      .prepare(
        `SELECT id, assignee_id, planned_at, place_text FROM day_assignments
         WHERE claim_id = ? AND job_kind = 'hire_delivery' AND cancelled_at IS NULL LIMIT 1`,
      )
      .get(claimId) as { id: string; assignee_id: string; planned_at: string | null; place_text: string | null } | undefined;
    const docs = db
      .prepare(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key IN ('hire_agreement', 'hire_pack')`)
      .get(claimId) as { n: number };
    return { episode, job, documents: Number(docs.n) };
  } finally {
    db.close();
  }
}

async function chooseFirstCar(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire?date=${HIRE_DAY}`);
  const picked = await session.evaluate<{ id: string; options: string }>(`(() => {
    const select = document.querySelector('[name="fleetVehicleId"]');
    if (!(select instanceof HTMLSelectElement)) return { id: "", options: "missing" };
    const option = [...select.options].find((item) => item.value);
    if (!option) return { id: "", options: select.innerText };
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const date = document.querySelector('form[action$="/hire/choose"] [name="date"]');
    const time = document.querySelector('form[action$="/hire/choose"] [name="time"]');
    if (date instanceof HTMLInputElement) date.value = ${JSON.stringify(HIRE_DAY)};
    if (time instanceof HTMLInputElement) time.value = "09:30";
    const button = [...document.querySelectorAll('form[action$="/hire/choose"] button')].find((item) => /Reserve|Change car/.test(item.textContent || ""));
    button?.click();
    return { id: option.value, options: String(select.options.length) };
  })()`);
  if (!picked.id) return { problem: `No free car was offered. ${picked.options}` };
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const chosen = await session.evaluate<string>(`document.querySelector("[data-chosen-car]")?.getAttribute("data-chosen-car") || ""`);
    const error = await session.evaluate<string>(`document.querySelector(".text-overdue")?.innerText || ""`);
    if (chosen) return { fleetId: picked.id, registration: chosen };
    if (error) return { problem: error };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { problem: "The car was not kept after Choose a car." };
}

async function completeHandover(session: BrowserSession, origin: string, claimId: string) {
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const ready = await session.evaluate<string>(`(() => {
    const form = document.querySelector('form[action$="/hire/handover"]');
    if (!form) return "missing";
    const mileage = form.querySelector('[name="mileage"]');
    const date = form.querySelector('[name="date"]');
    const time = form.querySelector('[name="time"]');
    if (mileage instanceof HTMLInputElement) mileage.value = "1500";
    if (date instanceof HTMLInputElement) date.value = ${JSON.stringify(HIRE_DAY)};
    if (time instanceof HTMLInputElement) time.value = "09:30";
    const button = [...form.querySelectorAll("button")].find((item) => item.textContent?.includes("Complete handover"));
    button?.click();
    return "sent";
  })()`);
  if (ready !== "sent") return ready;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const onHire = await session.evaluate<boolean>(`document.getElementById("on-hire") !== null`);
    const error = await session.evaluate<string>(`document.querySelector(".text-overdue")?.innerText || ""`);
    if (onHire) return null;
    if (error) return error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "Handover did not start the hire.";
}

async function hireOutline(session: BrowserSession) {
  return session.evaluate<{
    count: number;
    statuses: string[];
    bank: boolean;
    error: string;
    still: string;
    produce: boolean;
    links: number;
  }>(`(() => {
    const steps = [...document.querySelectorAll("[data-hire-step]")];
    const error = document.querySelector("[data-form-error]");
    return {
      count: steps.length,
      statuses: steps.map((item) => item.getAttribute("data-status") || ""),
      bank: Boolean(document.querySelector("[data-bank-step]")),
      error: error?.textContent?.replace(/\\s+/g, " ").trim() || "",
      still: document.querySelector("[data-still-needed]")?.textContent?.replace(/\\s+/g, " ").trim() || "",
      produce: [...document.querySelectorAll("button")].some((item) => (item.textContent || "").includes("Produce agreement for signature")),
      links: error ? error.querySelectorAll("a").length : 0,
    };
  })()`);
}

async function runHireJourneys(session: BrowserSession, origin: string, dbPath: string, made: MadeClaim[]) {
  const repairable = made.find((item) => item.id === "repairable");
  const totalLoss = made.find((item) => item.id === "total-loss");
  const fault = made.find((item) => item.id === "fault-courtesy");
  if (!repairable || !totalLoss || !fault) return "The three files were not all created.";

  const licenceNumber = await saveClientLicence(session, origin, dbPath, repairable.claimId);
  if (licenceNumber) return `Repairable licence: ${licenceNumber}`;
  const yes = await postFields(session, `/claims/${repairable.claimId}/hire/need`, { choice: "yes", reason: "", returnHash: "#need" });
  const yesProblem = followed(yes, "Hire needed");
  if (yesProblem) return yesProblem;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const opened = await hireOutline(session);
  if (opened.count !== 5) return `Repairable showed ${opened.count} hire steps, not 5.`;
  if (opened.error) return `Repairable showed an error before Produce was pressed. ${opened.error}`;
  if (!opened.still.includes("licence check") || !opened.still.includes("bank statements")) {
    return `Repairable did not say what is still needed. ${opened.still}`;
  }
  if (!opened.bank) return "Repairable hid the bank-statement step.";

  const before = countOnHire(dbPath);
  const chosen = await chooseFirstCar(session, origin, repairable.claimId);
  if ("problem" in chosen) return `Repairable car: ${chosen.problem}`;
  const facts = hireFacts(dbPath, repairable.claimId);
  if (!facts.job) return "Repairable: no driver delivery job was saved.";
  if (facts.job.assignee_id !== "staff-driver") return "Repairable: the delivery job was not on the driver login.";
  if (!facts.job.planned_at || !facts.job.place_text) return "Repairable: the delivery job has no date or address.";
  if (facts.episode?.started_at) return "Repairable: choosing a car started the hire.";

  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const pack = await session.evaluate<{ licence: string; retype: boolean; car: string; agreement: boolean }>(`({
    licence: document.querySelector("[data-pack-licence]")?.textContent || "",
    retype: Boolean(document.querySelector('[name="licence_number"]')),
    car: document.querySelector("[data-chosen-car]")?.getAttribute("data-chosen-car") || "",
    agreement: [...document.querySelectorAll("button")].some((item) => (item.textContent || "").includes("Produce agreement for signature")),
  })`);
  if (!pack.licence.includes("TEST-LIC-0001")) return "Repairable pack did not show the licence from the client record.";
  if (pack.retype) return "Repairable pack asked for the licence number again.";
  if (!pack.car) return "Repairable pack did not show the chosen car.";
  if (!pack.agreement) return "Repairable pack did not offer Produce agreement for signature.";

  const blocked = await postFields(session, `/claims/${repairable.claimId}/hire/agreement`, { returnHash: "#pack" });
  const blockedText = decodeURIComponent(blocked.location.replaceAll("+", " "));
  if (!/licence check/i.test(blockedText) || !/bank statement/i.test(blockedText)) {
    return `Produce agreement was not blocked with a list. ${blockedText}`;
  }
  await session.send("Page.navigate", { url: blocked.location });
  const shown = Date.now() + 15_000;
  let listed = await hireOutline(session);
  while (Date.now() < shown && listed.links < 2) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    listed = await hireOutline(session);
  }
  if (listed.links < 2) return `The block did not link each missing check. ${listed.error}`;

  const licenceCheck = await saveLicenceCheck(session, origin, repairable.claimId);
  if (licenceCheck) return `Repairable licence check: ${licenceCheck}`;
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

  const produced = await postFields(session, `/claims/${repairable.claimId}/hire/agreement`, { returnHash: "#pack" });
  const producedProblem = followed(produced, "agreement");
  if (producedProblem) return producedProblem;
  if (hireFacts(dbPath, repairable.claimId).documents < 1) return "Repairable agreement was not stored.";

  const handed = await completeHandover(session, origin, repairable.claimId);
  if (handed) return `Repairable handover: ${handed}`;
  const started = hireFacts(dbPath, repairable.claimId);
  const startedAt = started.episode?.started_at || "";
  const london = startedAt ? new Date(startedAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) : "";
  if (london !== "02/11/2026") return `Repairable hire started on ${london || "nothing"}, not the handover date.`;
  await gotoPath(session, origin, `/claims/${repairable.claimId}/hire`);
  const checksDone = await session.evaluate<string>(`document.querySelector('[data-hire-step="3"]')?.getAttribute("data-status") || ""`);
  if (checksDone !== "done") return `Repairable pre-hire checks were ${checksDone || "missing"} after handover.`;
  await gotoPath(session, origin, `/claims/${repairable.claimId}`);
  const step = await session.evaluate<{ state: string; text: string }>(`({
    state: document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || "",
    text: document.querySelector('[data-step="hire"]')?.innerText || "",
  })`);
  if (step.state !== "done") return `Repairable step 3 was ${step.state || "missing"}. ${step.text}`;
  const after = countOnHire(dbPath);
  if (after !== before + 1) return `On-hire count did not rise by one (was ${before}, now ${after}).`;

  const driverCookie = await signIn(origin, "driver", passwordFor("Demo Driver", "driver"));
  const refused = await fetch(`${origin}/documents/${bankFiles[0].id}/file`, {
    headers: { cookie: driverCookie },
    redirect: "manual",
  });
  const refusedText = await refused.text();
  if (refused.status !== 403 || !refusedText.includes("You cannot open that file.")) {
    return `Driver bank statement URL returned ${refused.status}.`;
  }

  await gotoPath(session, origin, `/claims/${totalLoss.claimId}/hire?date=${HIRE_DAY}`);
  const clashOffered = await session.evaluate<boolean>(`(() => {
    const select = document.querySelector('[name="fleetVehicleId"]');
    if (!(select instanceof HTMLSelectElement)) return true;
    return [...select.options].some((item) => item.value === ${JSON.stringify(chosen.fleetId)});
  })()`);
  if (clashOffered) return "The booked car was still offered on the second file for the same dates.";
  const forced = await postFields(session, `/claims/${totalLoss.claimId}/hire/choose`, {
    fleetVehicleId: chosen.fleetId,
    method: "deliver",
    date: HIRE_DAY,
    time: "10:00",
    address: "2 Test Street, Cardiff",
    returnHash: "#car",
  });
  const forcedText = decodeURIComponent(forced.location.replaceAll("+", " "));
  if (!forcedText.includes("This car has just been booked")) {
    return `Forced booking was not rejected. ${forcedText}`;
  }

  const notYet = await postFields(session, `/claims/${totalLoss.claimId}/hire/need`, {
    choice: "not_yet",
    reason: "",
    returnHash: "#need",
  });
  if (notYet.status >= 400 || notYet.status === 0 || decodeURIComponent(notYet.location).includes("error=")) {
    return `Not yet was not saved. ${decodeURIComponent(notYet.location)}`;
  }
  await gotoPath(session, origin, `/claims/${totalLoss.claimId}`);
  const waiting = await session.evaluate<{ state: string; text: string }>(`({
    state: document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || "",
    text: document.querySelector('[data-step="hire"]')?.innerText || "",
  })`);
  if (waiting.state === "done" || waiting.state === "not_needed") return `Not yet closed step 3 (${waiting.state}).`;
  if (!waiting.text.includes("Not yet – client keeps own car")) return `Step 3 did not stay open for not yet. ${waiting.text}`;

  const laterYes = await postFields(session, `/claims/${totalLoss.claimId}/hire/need`, { choice: "yes", reason: "", returnHash: "#need" });
  if (laterYes.status >= 400 || laterYes.status === 0 || decodeURIComponent(laterYes.location).includes("error=")) {
    return `Hire needed was not saved later. ${decodeURIComponent(laterYes.location)}`;
  }
  const laterCar = await chooseFirstCar(session, origin, totalLoss.claimId);
  if ("problem" in laterCar) return `Total loss car: ${laterCar.problem}`;
  if (laterCar.fleetId === chosen.fleetId) return "Total loss was given the car already booked on the other file.";
  const noBank = await saveNoBank(session, origin, totalLoss.claimId);
  if (noBank) return `Total loss no bank account: ${noBank}`;
  if (claimFiles(dbPath, totalLoss.claimId, "bank_statements").length !== 0) {
    return "Total loss stored a bank statement when the client has none.";
  }
  const laterLicence = await saveLicenceCheck(session, origin, totalLoss.claimId);
  if (laterLicence) return `Total loss licence check: ${laterLicence}`;
  const laterHand = await completeHandover(session, origin, totalLoss.claimId);
  if (laterHand) return `Total loss handover: ${laterHand}`;

  await gotoPath(session, origin, `/claims/${fault.claimId}/hire`);
  const courtesy = await hireOutline(session);
  if (courtesy.bank) return "The courtesy file showed a bank-statement step.";
  if (courtesy.produce) return "The courtesy file offered a hire agreement.";
  const wording = await session.evaluate<string>(`document.body.innerText`);
  if (/credit hire/i.test(wording)) return "The courtesy file showed credit-hire wording.";
  if (wording.includes("Generate Hire Agreement") || wording.includes("Generate Hire Pack")) {
    return "The courtesy file offered a hire agreement.";
  }
  const faultLicence = await saveLicenceCheck(session, origin, fault.claimId);
  if (faultLicence) return `Courtesy licence check: ${faultLicence}`;
  const faultCar = await chooseFirstCar(session, origin, fault.claimId);
  if ("problem" in faultCar) return `Courtesy car: ${faultCar.problem}`;
  const faultHand = await completeHandover(session, origin, fault.claimId);
  if (faultHand) return `Courtesy handover: ${faultHand}`;
  if (hireFacts(dbPath, fault.claimId).documents !== 0) return "The courtesy file stored a hire agreement.";
  await gotoPath(session, origin, `/claims/${fault.claimId}`);
  const faultStep = await session.evaluate<string>(`document.querySelector('[data-step="hire"]')?.getAttribute("data-state") || ""`);
  if (faultStep !== "done") return `Courtesy step 3 was ${faultStep || "missing"}.`;
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
      const hireProblem = await runHireJourneys(browser.session, origin, databasePath, made);
      if (hireProblem) {
        results.push({ id: "repairable", problem: hireProblem });
        console.log(`FAIL  Hire  ${hireProblem}`);
      } else {
        console.log("PASS  Hire  free cars, driver job, pack, handover, clash, not yet, courtesy");
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

main();

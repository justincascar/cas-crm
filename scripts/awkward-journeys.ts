/**
 * J11: the awkward cases, each driven end to end in a real browser as sian, starting from a new claim.
 *
 * From CAS-CRM, after a production build (run by npm run test:journeys, after the main journeys):
 *   npx tsx scripts/awkward-journeys.ts
 *
 * Uses its own database, never the demonstration one. EMAIL_SEND_MODE is simulate.
 * Each case checks the money, the dates, the next step and the chronology it leaves behind.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ClaimJourney } from "../tests/journeys/claim-journeys.ts";
import {
  BrowserSession,
  HIRE_DAY,
  chooseFirstCar,
  completeHandover,
  createJourney,
  followed,
  freePort,
  gotoPath,
  oneClick,
  openBrowser,
  passwordFor,
  postFields,
  readDb,
  saveLicenceCheck,
  saveNoBank,
  setDailyRate,
  stepState,
  signIn,
  stopTree,
  storedJourney,
  submitForm,
  waitUntilReady,
  type Submitted,
} from "./journey-check.ts";

type Ctx = { session: BrowserSession; origin: string; dbPath: string; cookie: string };
type Case = { title: string; run: (ctx: Ctx) => Promise<string | null> };

const SET_CONTROL = `
function setControl(name, value) {
  const el = document.querySelector('[name="' + name + '"]');
  if (!el) return "missing " + name;
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    if (el.checked !== Boolean(value)) el.click();
    return el.checked ? "checked" : "unchecked";
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue("");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
}`;

let licenceSerial = 0;

/** A new non-fault file through the new-claim form, as staff would create it. */
async function newClaim(ctx: Ctx, surname: string, overrides: Partial<ClaimJourney> = {}): Promise<{ claimId: string; reference: string } | string> {
  const journey = {
    id: "repairable",
    title: `Awkward ${surname}`,
    forename: "Awkward",
    surname,
    claimType: "non_fault",
    roadworthiness: "unroadworthy",
    needsRecovery: true,
    needsReplacement: true,
    continues: "",
    ...overrides,
  } as ClaimJourney;
  const made = await createJourney(ctx.session, ctx.origin, journey);
  if (typeof made === "string") return `New claim: ${made}`;
  const row = storedJourney(ctx.dbPath, made.reference);
  if (!row) return `${made.reference} was not stored.`;
  return { claimId: String(row.id), reference: made.reference };
}

/** Hire needed, a free car, no bank account, the licence check, the daily rate, then the handover with the signed copy. */
async function startHire(ctx: Ctx, claimId: string): Promise<string | null> {
  const { session, origin } = ctx;
  await gotoPath(session, origin, `/claims/${claimId}/hire`);
  const need = followed(
    await submitForm(session, 'form[action$="/hire/need"]', { choice: "yes", reason: "The client's car cannot be driven and is needed for work." }),
    "Hire needed",
  );
  if (need) return need;
  const car = await chooseFirstCar(session, origin, claimId, "");
  if ("problem" in car) return `Car: ${car.problem}`;
  const noBank = await saveNoBank(session, origin, claimId);
  if (noBank) return noBank;
  licenceSerial += 1;
  const licence = await saveLicenceCheck(session, origin, claimId, `AWKWD850412A${String(licenceSerial).padStart(2, "0")}C`);
  if (licence) return licence;
  const rate = await setDailyRate(session, origin, claimId, "S2");
  if (rate) return rate;
  return followed(await completeHandover(session, origin, claimId, true), "Handover");
}

/** Saves a claim screen through its own form, the way the Save this screen button does. */
async function saveScreen(ctx: Ctx, claimId: string, screen: string, values: Record<string, string>): Promise<string | null> {
  await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/details/${screen}`);
  const spec = JSON.stringify(values);
  const filled = await ctx.session.evaluate<string>(`(() => {
    ${SET_CONTROL}
    const values = ${spec};
    return Object.entries(values).map(([name, value]) => setControl(name, value)).join("|");
  })()`);
  if (filled.includes("missing")) return `${screen}: ${filled}`;
  await ctx.session.evaluate<void>(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen");
    if (!button) throw new Error("Save this screen was not on the page.");
    button.click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const error = await ctx.session.evaluate<string>(`document.querySelector("[data-form-error]")?.innerText || ""`);
  return error ? `${screen}: ${error.replace(/\s+/g, " ")}` : null;
}

function claimRow<T>(ctx: Ctx, sql: string, ...params: Array<string | number>): T | undefined {
  return readDb(ctx.dbPath, (db) => db.prepare(sql).get(...params) as T | undefined);
}

function events(ctx: Ctx, claimId: string, type: string): Array<{ details: string | null; occurred_at: string }> {
  return readDb(ctx.dbPath, (db) =>
    db.prepare(`SELECT details, occurred_at FROM claim_events WHERE claim_id = ? AND event_type = ? ORDER BY recorded_at`).all(claimId, type) as Array<{
      details: string | null;
      occurred_at: string;
    }>,
  );
}

function hireEnd(ctx: Ctx, claimId: string): string | null {
  return claimRow<{ billing_end_at: string | null }>(ctx, `SELECT billing_end_at FROM hire_episodes WHERE claim_id = ? ORDER BY started_at DESC LIMIT 1`, claimId)?.billing_end_at ?? null;
}

async function pageText(ctx: Ctx, pagePath: string): Promise<string> {
  await gotoPath(ctx.session, ctx.origin, pagePath);
  return ctx.session.evaluate<string>(`document.body.innerText`);
}

function reviewText(text: string): string {
  const at = text.indexOf("Review before");
  return at < 0 ? "(no review box)" : text.slice(at, at + 300).replace(/\s+/g, " ");
}

/** The total-loss panel reports a refusal as tlError, or a possible second payment as payWarn. */
function tlFollowed(result: Submitted, label: string): string | null {
  const plain = followed(result, label);
  if (plain) return plain;
  const location = decoded(result);
  if (/[?&](tlError|payWarn)=/.test(location)) return `${label}: ${location}`;
  return null;
}

/** Everything on the page, including folded sections that are closed. */
async function pageAllText(ctx: Ctx, pagePath: string): Promise<string> {
  await gotoPath(ctx.session, ctx.origin, pagePath);
  return ctx.session.evaluate<string>(`(() => { for (const fold of document.querySelectorAll("details")) fold.open = true; return document.body.innerText; })()`);
}

function decoded(result: Submitted): string {
  return decodeURIComponent(result.location.replaceAll("+", " "));
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** Steps 5 to 7 on the claim page: Engineer route, engineer instructed, report received, report sent to the insurer. */
async function engineerToInsurer(ctx: Ctx, claimId: string): Promise<string | null> {
  const page = `/claims/${claimId}`;
  await gotoPath(ctx.session, ctx.origin, page);
  const route = await oneClick(ctx.session, "route", { route: "engineer", occurredOn: HIRE_DAY });
  if (route) return `Route: ${route}`;
  await gotoPath(ctx.session, ctx.origin, page);
  const instructed = await oneClick(ctx.session, "engineer_instructed");
  if (instructed) return instructed;
  await gotoPath(ctx.session, ctx.origin, page);
  const report = followed(await submitForm(ctx.session, 'form[action$="/steps/report"]', {}), "Report received");
  if (report) return report;
  await gotoPath(ctx.session, ctx.origin, page);
  return oneClick(ctx.session, "report_sent");
}

/** Moves the hire start and the signed agreement back, to stand in for days passing. Nothing else is changed. */
function hireStartedDaysAgo(ctx: Ctx, claimId: string, daysAgo: number) {
  const day = addDays(HIRE_DAY, -daysAgo);
  readDb(ctx.dbPath, (db) => {
    const episode = db.prepare(`SELECT id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL`).get(claimId) as { id: string };
    db.prepare(`UPDATE hire_episodes SET started_at = ? WHERE id = ?`).run(`${day}T09:00:00.000Z`, episode.id);
    db.prepare(`UPDATE agreements SET start_on = ? WHERE hire_episode_id = ? AND sequence = 1`).run(day, episode.id);
  });
}

/** Files an incoming email on the Messages tab, the way staff do, and waits for it to be on the file. */
async function fileIncomingEmail(ctx: Ctx, claimId: string, subject: string, body: string): Promise<string | null> {
  await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/messages`);
  const before = events(ctx, claimId, "incoming_email").length;
  const spec = JSON.stringify({ subject, body });
  const problem = await ctx.session.evaluate<string>(`(() => {
    const spec = ${spec};
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "File incoming email");
    const form = button?.closest("form");
    if (!form) return "no incoming email form";
    for (const fold of document.querySelectorAll("details")) fold.open = true;
    const set = (name, value) => {
      const el = form.querySelector('[name="' + name + '"]');
      if (!el) return;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("from", "claims@insurer.example.test");
    set("subject", spec.subject);
    set("body", spec.body);
    button.click();
    return "";
  })()`);
  if (problem) return problem;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (events(ctx, claimId, "incoming_email").length > before) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return `The email "${subject}" was not filed.`;
}

function repairChase(ctx: Ctx, claimId: string) {
  return claimRow<{ status: string; paused: number }>(ctx, `SELECT status, paused FROM automations WHERE claim_id = ? AND rule_key = 'repair_authorisation_chase'`, claimId);
}

/** Types a value into a screen field and presses Save this screen, in the given browser. */
async function typeAndSave(session: BrowserSession, name: string, value: string, press: boolean): Promise<string> {
  const spec = JSON.stringify({ name, value, press });
  return session.evaluate<string>(`(() => {
    ${SET_CONTROL}
    const spec = ${spec};
    const typed = setControl(spec.name, spec.value);
    if (typed.startsWith("missing")) return typed;
    if (spec.press) {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Save this screen");
      if (!button) return "no Save this screen";
      button.click();
    }
    return "";
  })()`);
}

function screenValue(ctx: Ctx, claimId: string, screen: string, field: string): string {
  const row = claimRow<{ data_json: string }>(ctx, `SELECT data_json FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`, claimId, screen);
  try {
    return String((JSON.parse(String(row?.data_json || "{}")) as Record<string, unknown>)[field] || "");
  } catch {
    return "";
  }
}

/** Records the recovery on the Recovery page, with the car at the yard from a few days ago. */
async function recordRecovery(ctx: Ctx, claimId: string, daysAgo: number): Promise<string | null> {
  await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/money/recovery`);
  return followed(
    await submitForm(ctx.session, 'form[action$="/recovery/record"]', {
      recoveryLocation: "A48, Port Talbot",
      carCondition: "Front end damaged.",
      notDriveable: "unsafe",
      arrivedDate: addDays(HIRE_DAY, -daysAgo),
      arrivedTime: "10:00",
      recoveryTick_standard: "yes",
      recoveryAmount_standard: "395",
    }),
    "Record recovery",
  );
}

/** A new file with the recovery recorded five days ago and the storage charge recorded to today. */
async function recoveryAndStorageClaim(ctx: Ctx, surname: string): Promise<{ claimId: string } | string> {
  const made = await newClaim(ctx, surname, { needsReplacement: false });
  if (typeof made === "string") return made;
  const recovery = await recordRecovery(ctx, made.claimId, 5);
  if (recovery) return recovery;
  await gotoPath(ctx.session, ctx.origin, `/claims/${made.claimId}/money/storage`);
  const storage = followed(await postFields(ctx.session, `/claims/${made.claimId}/record-charge`, { head: "storage" }), "Record storage charge");
  if (storage) return storage;
  return { claimId: made.claimId };
}

function moneyLines(ctx: Ctx, claimId: string) {
  return readDb(ctx.dbPath, (db) =>
    db.prepare(`SELECT head_of_loss AS head, claimed_pence AS claimed, agreed_pence AS agreed, received_pence AS received FROM financial_lines WHERE claim_id = ? ORDER BY head_of_loss`).all(claimId) as Array<{
      head: string;
      claimed: number;
      agreed: number;
      received: number;
    }>,
  );
}

/** A total-loss file with a car on hire, the figures saved and the suggested settlement agreed. */
async function totalLossOnHire(ctx: Ctx, surname: string, figures: Record<string, string>): Promise<{ claimId: string } | string> {
  const made = await newClaim(ctx, surname);
  if (typeof made === "string") return made;
  const { claimId } = made;
  const hire = await startHire(ctx, claimId);
  if (hire) return hire;
  const marked = await saveScreen(ctx, claimId, "assessed-damage", { totalLoss: "yes" });
  if (marked) return marked;
  if (Number(claimRow<{ total_loss: number }>(ctx, `SELECT total_loss FROM claims WHERE id = ?`, claimId)?.total_loss) !== 1) {
    return "Saving Assessed damage as a total loss did not mark the file.";
  }
  await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/details/assessed-damage`);
  const saved = tlFollowed(await submitForm(ctx.session, 'form[action$="/total-loss"]:has(input[name="pav"])', figures), "Total-loss figures");
  if (saved) return saved;
  const agreed = tlFollowed(
    await postFields(ctx.session, `/claims/${claimId}/total-loss`, {
      intent: "confirm_suggestion",
      agreedOn: HIRE_DAY,
      returnTo: `/claims/${claimId}/details/assessed-damage`,
    }),
    "Use the suggestion as agreed",
  );
  if (agreed) return agreed;
  return { claimId };
}

async function recordTotalLossPayment(ctx: Ctx, claimId: string, pounds: string): Promise<string | null> {
  return tlFollowed(
    await postFields(ctx.session, `/claims/${claimId}/total-loss`, {
      intent: "record_payment",
      received: pounds,
      returnTo: `/claims/${claimId}/details/assessed-damage`,
    }),
    `Payment of £${pounds}`,
  );
}

const CASES: Case[] = [
  {
    title: "1. Partial total-loss payment",
    async run(ctx) {
      const made = await totalLossOnHire(ctx, "PartialTL", { pav: "5000", salvage: "800", interest: "no_interest" });
      if (typeof made === "string") return made;
      const { claimId } = made;
      const paid = await recordTotalLossPayment(ctx, claimId, "3000");
      if (paid) return paid;
      if (hireEnd(ctx, claimId)) return "A part-payment ended the hire.";
      const text = await pageText(ctx, `/claims/${claimId}/details/assessed-damage`);
      if (!text.includes("Review before setting an off-hire date.")) return "The part-payment was not flagged for review.";
      if (!text.includes("The amount received does not match the agreed settlement.")) return `The review did not say the payment falls short. ${reviewText(text)}`;
      if (!/Agreed vehicle damage: £4,200\.00\. Paid: £3,000\.00/.test(text)) return "The agreed and paid figures were not shown.";
      if (/Suggested hire end/.test(text)) return "A hire end was suggested after a part-payment.";
      if (!text.includes("The shortfall of £1,200.00 is chased separately")) return "The shortfall was not chased.";
      const ledger = await pageText(ctx, `/claims/${claimId}/money/vehicle`);
      if (!/Outstanding\s+£1,200\.00/.test(ledger)) return "The shortfall of £1,200.00 was not shown on the vehicle damage ledger.";
      const rest = await recordTotalLossPayment(ctx, claimId, "1200");
      if (rest) return rest;
      const after = await pageText(ctx, `/claims/${claimId}/details/assessed-damage`);
      const suggested = addDays(HIRE_DAY, 7).split("-").reverse().join("/");
      if (!after.includes(`Suggested hire end: ${suggested}`)) return `Paid in full did not suggest the hire end ${suggested}.`;
      if (hireEnd(ctx, claimId)) return "The hire ended before a handler confirmed the suggestion.";
      const confirmed = tlFollowed(
        await submitForm(ctx.session, 'form[action$="/total-loss"]:has(input[name="choice"][value="suggested"])', {}),
        "Use this as the hire end date",
      );
      if (confirmed) return confirmed;
      const end = hireEnd(ctx, claimId);
      if (!end || end.slice(0, 10) !== addDays(HIRE_DAY, 7)) return `The confirmed hire end was ${end || "not set"}, not payment day + 7.`;
      if (events(ctx, claimId, "total_loss_payment_received").length !== 2) return "Both payments were not in the chronology.";
      return null;
    },
  },
  {
    title: "2. Disputed salvage",
    async run(ctx) {
      const made = await totalLossOnHire(ctx, "SalvageDispute", {
        pav: "5000",
        salvage: "800",
        interest: "no_interest",
        disputedShortfall: "300",
        disputedShortfallNote: "Insurer deducted £1,100 salvage; the engineer valued it at £800",
      });
      if (typeof made === "string") return made;
      const { claimId } = made;
      const paid = await recordTotalLossPayment(ctx, claimId, "3900");
      if (paid) return paid;
      if (hireEnd(ctx, claimId)) return "The disputed salvage payment ended the hire.";
      const storage = claimRow<{ storage_billing_end_on: string | null }>(ctx, `SELECT storage_billing_end_on FROM claims WHERE id = ?`, claimId);
      if (storage?.storage_billing_end_on) return "The storage end was set automatically.";
      const text = await pageText(ctx, `/claims/${claimId}/details/assessed-damage`);
      if (!text.includes("A shortfall is disputed: Insurer deducted £1,100 salvage")) return "The salvage dispute was not shown in the off-hire review.";
      if (/Suggested hire end/.test(text)) return "A hire end was suggested while the salvage is disputed.";
      if (!text.includes("The shortfall of £300.00 is chased separately; £300.00 is disputed: Insurer deducted £1,100 salvage")) {
        return "The disputed shortfall was not chased separately.";
      }
      const recorded = readDb(ctx.dbPath, (db) =>
        db.prepare(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND details LIKE '%disputed%'`).get(claimId) as { n: number },
      );
      if (Number(recorded.n) < 1) return "The dispute was not recorded in the chronology.";
      return null;
    },
  },
  {
    title: "3. Repairable changed to total loss",
    async run(ctx) {
      const made = await newClaim(ctx, "RepairToTL");
      if (typeof made === "string") return made;
      const { claimId } = made;
      const hire = await startHire(ctx, claimId);
      if (hire) return hire;
      const steps = await engineerToInsurer(ctx, claimId);
      if (steps) return steps;
      if (events(ctx, claimId, "repair_authorisation_requested").length !== 1) return "Sending the report did not start the repair chase.";
      const marked = await saveScreen(ctx, claimId, "assessed-damage", { totalLoss: "yes" });
      if (marked) return marked;
      for (const kept of ["engineer_instructed", "engineer_report_received", "engineer_report_sent_to_insurer", "repair_authorisation_requested"]) {
        if (events(ctx, claimId, kept).length !== 1) return `The history lost ${kept} when the file became a total loss.`;
      }
      const closed = events(ctx, claimId, "repair_steps_closed_total_loss");
      if (closed.length !== 1) return "The repair steps were not closed with a reason.";
      if (!/kept in the history and closed/.test(String(closed[0].details)) || !/repair authorisation chase stopped/.test(String(closed[0].details))) {
        return `The closing reason was not complete: ${closed[0].details}`;
      }
      const chase = claimRow<{ status: string }>(ctx, `SELECT a.status FROM automations a WHERE a.claim_id = ? AND a.rule_key LIKE '%repair_auth%'`, claimId);
      if (chase?.status !== "cancelled") return `The repair authorisation chase was ${chase?.status || "not found"}, not stopped.`;
      await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}`);
      const finish = await ctx.session.evaluate<string>(`document.querySelector('[data-step="finish"]')?.innerText || ""`);
      if (!finish.includes("Payment received and salvage collected")) return `Step 9 did not switch to the total-loss rules: ${finish.replace(/\s+/g, " ").slice(0, 200)}`;
      const offered = await ctx.session.evaluate<string[]>(`[...document.querySelectorAll('[data-step="finish"] input[name="intent"]')].map((item) => item.value)`);
      if (offered.includes("hire_end") || offered.includes("car_returned")) return `Step 9 still offered repair endings: ${offered.join(", ")}`;
      const figures = await pageText(ctx, `/claims/${claimId}/details/assessed-damage`);
      if (!figures.includes("Pre-accident value")) return "The total-loss figures did not open.";
      if (hireEnd(ctx, claimId)) return "The hire was ended when the file became a total loss.";
      return null;
    },
  },
  {
    title: "4. Vehicle swap mid-hire",
    async run(ctx) {
      const made = await newClaim(ctx, "Swap");
      if (typeof made === "string") return made;
      const { claimId } = made;
      const hire = await startHire(ctx, claimId);
      if (hire) return hire;
      type Episode = { id: string; started_at: string; fleet_vehicle_id: string };
      const before = claimRow<Episode>(ctx, `SELECT id, started_at, fleet_vehicle_id FROM hire_episodes WHERE claim_id = ? AND started_at IS NOT NULL`, claimId);
      if (!before) return "The hire did not start.";
      const agreementsBefore = claimRow<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`, claimId)?.n;
      // A car already out on another file is refused, even when posted directly.
      const busy = claimRow<{ fleet_vehicle_id: string }>(
        ctx,
        `SELECT fleet_vehicle_id FROM hire_episodes WHERE claim_id != ? AND started_at IS NOT NULL AND billing_end_at IS NULL AND collection_at IS NULL AND fleet_vehicle_id IS NOT NULL LIMIT 1`,
        claimId,
      );
      if (!busy) return "No car on hire elsewhere to test the clash check.";
      await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/hire?date=${HIRE_DAY}`);
      const clash = decoded(
        await postFields(ctx.session, `/claims/${claimId}/hire/choose`, {
          fleetVehicleId: busy.fleet_vehicle_id,
          method: "collect",
          date: HIRE_DAY,
          time: "12:00",
          address: "",
        }),
      );
      if (!/This car has just been booked|not available/.test(clash)) return `Swapping to a car on hire elsewhere was not refused: ${clash}`;
      const options = await ctx.session.evaluate<string[]>(
        `[...document.querySelectorAll('form[action$="/hire/choose"] [name="fleetVehicleId"] option')].map((o) => o.value).filter(Boolean)`,
      );
      const next = options.find((id) => id !== before.fleet_vehicle_id);
      if (!next) return "No other free car was offered for the swap.";
      const swapped = followed(
        await submitForm(ctx.session, 'form[action$="/hire/choose"]', { fleetVehicleId: next, method: "collect", date: HIRE_DAY, time: "12:00" }),
        "Swap the car",
      );
      if (swapped) return swapped;
      const episodes = readDb(ctx.dbPath, (db) => db.prepare(`SELECT id, started_at, fleet_vehicle_id FROM hire_episodes WHERE claim_id = ?`).all(claimId) as Episode[]);
      if (episodes.length !== 1) return `The swap made ${episodes.length} hires, not one continuous hire.`;
      if (episodes[0].id !== before.id || episodes[0].started_at !== before.started_at) return "The swap changed the hire or its start date, so the day count would change.";
      if (episodes[0].fleet_vehicle_id !== next) return "The new car was not put on the hire.";
      const cars = readDb(ctx.dbPath, (db) =>
        Object.fromEntries((db.prepare(`SELECT id, status FROM fleet_vehicles WHERE id IN (?, ?)`).all(before.fleet_vehicle_id, next) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status])),
      );
      if (cars[before.fleet_vehicle_id] !== "available") return `The old car was left ${cars[before.fleet_vehicle_id]}, not freed.`;
      if (cars[next] !== "on_hire") return `The new car is ${cars[next]}, not on hire.`;
      const changed = events(ctx, claimId, "hire_vehicle_changed");
      if (changed.length !== 1 || !/start date was not changed/.test(String(changed[0].details)) || !/Hire Vehicle as including any vehicle/.test(String(changed[0].details))) {
        return `The swap was not recorded with its reason: ${changed[0]?.details || "nothing recorded"}`;
      }
      const agreementsAfter = claimRow<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM documents WHERE claim_id = ? AND template_key = 'hire_agreement'`, claimId)?.n;
      if (agreementsAfter !== agreementsBefore) return "A new agreement was produced with invented wording for the swap.";
      return null;
    },
  },
  {
    title: "5. Agreement renewal at day 80 to 88",
    async run(ctx) {
      const made = await newClaim(ctx, "Renewal");
      if (typeof made === "string") return made;
      const { claimId } = made;
      const hire = await startHire(ctx, claimId);
      if (hire) return hire;
      const episodeBefore = claimRow<{ id: string }>(ctx, `SELECT id FROM hire_episodes WHERE claim_id = ?`, claimId)?.id;
      hireStartedDaysAgo(ctx, claimId, 78);
      let hireTab = await pageText(ctx, `/claims/${claimId}/hire`);
      if (/Renewal alert|Overdue/.test(hireTab)) return "The renewal alert showed before day 80.";
      hireStartedDaysAgo(ctx, claimId, 79);
      hireTab = await pageText(ctx, `/claims/${claimId}/hire`);
      if (!hireTab.includes("Renewal alert. Day 80.")) return "The renewal alert did not show on day 80.";
      let messages = await pageAllText(ctx, `/claims/${claimId}/messages`);
      if (!messages.includes("Hire agreement renewal due")) return `The renewal chase was not due on day 80. ${messages.split(String.fromCharCode(10)).filter((l) => /renewal/i.test(l)).slice(0, 6).join(" / ")}`;
      hireStartedDaysAgo(ctx, claimId, 87);
      hireTab = await pageText(ctx, `/claims/${claimId}/hire`);
      if (!hireTab.includes("Overdue. Day 88.")) return "The renewal was not overdue on day 88.";
      messages = await pageAllText(ctx, `/claims/${claimId}/messages`);
      if (!messages.includes("Hire agreement renewal overdue")) return "The renewal chase was not overdue on day 88.";
      // Log the renewal from the chase panel, as the handler would.
      const logged = await ctx.session.evaluate<string>(`(() => {
        const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Log agreement renewed");
        if (!button) return "no Log agreement renewed button";
        const form = button.closest("form");
        const date = form?.querySelector('input[name="occurredAt"]');
        if (date instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(date, ${JSON.stringify(HIRE_DAY)});
          date.dispatchEvent(new Event("input", { bubbles: true }));
        }
        button.click();
        return "";
      })()`);
      if (logged) return logged;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && events(ctx, claimId, "hire_agreement_renewed").length === 0) await new Promise((r) => setTimeout(r, 250));
      const agreements = readDb(ctx.dbPath, (db) =>
        db.prepare(`SELECT a.sequence, a.signed, a.signed_at FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = ? ORDER BY a.sequence`).all(claimId) as Array<{
          sequence: number;
          signed: number;
          signed_at: string | null;
        }>,
      );
      if (agreements.length !== 2) return `Logging the renewal left ${agreements.length} agreements.`;
      if (agreements[1].signed !== 0 || agreements[1].signed_at) return "The logged renewal was marked signed without a signature.";
      hireTab = await pageText(ctx, `/claims/${claimId}/hire`);
      if (!hireTab.includes("Renewal 2 is logged but not signed")) return "The Hire tab did not ask for the signed renewal.";
      if (!hireTab.includes("Day 88")) return "The day count restarted when the renewal was logged.";
      const uploaded = followed(await submitForm(ctx.session, 'form[action$="/hire/renewal-signed"]', {}, ["signedRenewal"]), "Upload signed renewal");
      if (uploaded) return uploaded;
      const signed = claimRow<{ signed: number; signed_at: string }>(
        ctx,
        `SELECT a.signed, a.signed_at FROM agreements a JOIN hire_episodes he ON he.id = a.hire_episode_id WHERE he.claim_id = ? AND a.sequence = 2`,
        claimId,
      );
      if (signed?.signed !== 1 || !signed.signed_at || signed.signed_at.slice(0, 10) < HIRE_DAY) return "The signed renewal was not recorded, or was backdated.";
      messages = await pageAllText(ctx, `/claims/${claimId}/messages`);
      if (/Hire agreement renewal (due|overdue)/.test(messages)) return "The renewal alert stayed after the signed renewal was filed.";
      const episodes = readDb(ctx.dbPath, (db) => db.prepare(`SELECT id FROM hire_episodes WHERE claim_id = ?`).all(claimId) as Array<{ id: string }>);
      if (episodes.length !== 1 || episodes[0].id !== episodeBefore) return "Renewing did not keep one continuous hire.";
      hireTab = await pageText(ctx, `/claims/${claimId}/hire`);
      if (!hireTab.includes("Day 88")) return "The day count restarted after the renewal was signed.";
      return null;
    },
  },
  {
    title: "6. Insurer reply just before a chaser is due",
    async run(ctx) {
      const made = await newClaim(ctx, "Reply", { needsReplacement: false });
      if (typeof made === "string") return made;
      const { claimId } = made;
      const steps = await engineerToInsurer(ctx, claimId);
      if (steps) return steps;
      // Two of the three days have passed: the chaser is due tomorrow.
      readDb(ctx.dbPath, (db) => {
        const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
        db.prepare(`UPDATE claim_events SET occurred_at = ? WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`).run(at, claimId);
      });
      if (repairChase(ctx, claimId)?.status !== "tracking") return `The repair chase was ${repairChase(ctx, claimId)?.status || "not started"} before any reply.`;
      const ooo = await fileIncomingEmail(ctx, claimId, "Automatic reply: TEST claim", "I am out of the office until Monday. Your email about the dispute will be read then.");
      if (ooo) return ooo;
      if (repairChase(ctx, claimId)?.status !== "tracking") return "An out-of-office reply paused the chase.";
      const ack = await fileIncomingEmail(ctx, claimId, "Re: your email", "Thank you for your email. We have received your email and will respond.");
      if (ack) return ack;
      if (repairChase(ctx, claimId)?.status !== "tracking") return "An acknowledgement paused the chase.";
      if (events(ctx, claimId, "chase_reply_uncertain").length || events(ctx, claimId, "chase_reply_substantive").length) return "An acknowledgement was treated as a reply to review.";
      const unclear = await fileIncomingEmail(ctx, claimId, "Re: TEST claim", "Please call me about this one.");
      if (unclear) return unclear;
      if (repairChase(ctx, claimId)?.status !== "tracking") return "An uncertain reply paused the chase.";
      if (events(ctx, claimId, "chase_reply_uncertain").length !== 1) return "An uncertain reply was not sent for review.";
      const task = claimRow<{ title: string }>(ctx, `SELECT title FROM tasks WHERE claim_id = ? AND title = 'Read the insurer''s reply'`, claimId);
      if (!task) return "No task asked the handler to read the uncertain reply.";
      const decision = await fileIncomingEmail(ctx, claimId, "Re: TEST claim repairs", "We have reviewed the estimate and authorise the repairs as quoted.");
      if (decision) return decision;
      const chase = repairChase(ctx, claimId);
      if (chase?.status !== "paused") return `A substantive reply left the chase ${chase?.status}.`;
      if (events(ctx, claimId, "chase_reply_substantive").length !== 1) return "The substantive reply was not recorded.";
      // The day the chaser would have been due: it is not due and none was prepared.
      readDb(ctx.dbPath, (db) => {
        const at = new Date(Date.now() - 4 * 86_400_000).toISOString();
        db.prepare(`UPDATE claim_events SET occurred_at = ? WHERE claim_id = ? AND event_type = 'repair_authorisation_requested'`).run(at, claimId);
      });
      const messages = await pageAllText(ctx, `/claims/${claimId}/messages`);
      if (/Chase due/.test(messages) && !/Paused/.test(messages)) return "The paused chase showed as due.";
      const prepared = claimRow<{ n: number }>(ctx, `SELECT COUNT(*) AS n FROM correspondence WHERE claim_id = ? AND direction = 'outgoing' AND template_key LIKE '%repair%'`, claimId);
      if (Number(prepared?.n) !== 0) return "A repair chaser was prepared after the substantive reply.";
      return null;
    },
  },
  {
    title: "7. Two staff edit the same claim at once",
    async run(ctx) {
      const made = await newClaim(ctx, "Clash", { needsReplacement: false });
      if (typeof made === "string") return made;
      const { claimId } = made;
      const page = `/claims/${claimId}/details/general`;
      // Sian opens the screen and starts typing.
      await gotoPath(ctx.session, ctx.origin, page);
      const sianTyped = await typeAndSave(ctx.session, "ourPolicy", "Sian: client's own policy", false);
      if (sianTyped) return `Sian: ${sianTyped}`;
      // Tom opens the same screen in his own browser and saves first.
      const tomCookie = await signIn(ctx.origin, "tom", passwordFor("Tom Hughes", "tom"));
      const tom = await openBrowser();
      try {
        const [name, ...rest] = tomCookie.split("=");
        await tom.session.send("Network.setCookie", { name, value: rest.join("="), url: ctx.origin });
        await gotoPath(tom.session, ctx.origin, page);
        const tomSaved = await typeAndSave(tom.session, "ourPolicy", "Tom: broker policy", true);
        if (tomSaved) return `Tom: ${tomSaved}`;
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && screenValue(ctx, claimId, "general", "ourPolicy").toLowerCase() !== "tom: broker policy") await new Promise((r) => setTimeout(r, 250));
        if (screenValue(ctx, claimId, "general", "ourPolicy").toLowerCase() !== "tom: broker policy") return "Tom's save did not go through.";
      } finally {
        tom.stop();
      }
      // Sian presses Save on the screen she opened before Tom saved.
      const sianSaved = await typeAndSave(ctx.session, "ourPolicy", "Sian: client's own policy", true);
      if (sianSaved) return `Sian save: ${sianSaved}`;
      let notice = "";
      for (let i = 0; i < 40 && !/after you opened it/.test(notice); i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        notice = await ctx.session.evaluate<string>(`[...document.querySelectorAll('[role="alert"], [data-form-error]')].map((el) => el.innerText).join(" | ")`);
      }
      if (!/Tom Hughes changed this on .* after you opened it\. Your changes have not been saved\./.test(notice)) { const where = await ctx.session.evaluate<string>(`location.href + " | " + (document.querySelector("[data-form-error]")?.innerText || "")`); return `Sian did not get the clash message: ${notice || "nothing shown"} | ${where} | saved=${screenValue(ctx, claimId, "general", "ourPolicy")}`; }
      if (!notice.toLowerCase().includes("sian: client's own policy")) return "Sian's typed value was not kept on the page, so it would be lost.";
      if (screenValue(ctx, claimId, "general", "ourPolicy").toLowerCase() !== "tom: broker policy") return "Sian's stale save overwrote Tom's.";
      return null;
    },
  },
  {
    title: "8. A payment covering several heads",
    async run(ctx) {
      const made = await recoveryAndStorageClaim(ctx, "SplitPay");
      if (typeof made === "string") return made;
      const { claimId } = made;
      const money = `/claims/${claimId}/money`;
      await gotoPath(ctx.session, ctx.origin, money);
      const wrongSum = decoded(await submitForm(ctx.session, "form[data-split-payment]", { total: "600", split_recovery: "474", split_storage: "100" }));
      if (!/adds up to £574.00, not the payment of £600.00. Nothing was recorded/.test(wrongSum)) return `A split that does not add up was not refused: ${wrongSum}`;
      await gotoPath(ctx.session, ctx.origin, money);
      const tooMuch = decoded(await submitForm(ctx.session, "form[data-split-payment]", { total: "600", split_recovery: "500", split_storage: "100" }));
      if (!/more than the £474.00 outstanding there. Nothing was recorded/.test(tooMuch)) return `A part above its head's balance was not refused: ${tooMuch}`;
      if (moneyLines(ctx, claimId).some((line) => line.received > 0)) return "A refused split still marked money as received.";
      await gotoPath(ctx.session, ctx.origin, money);
      const split = followed(await submitForm(ctx.session, "form[data-split-payment]", { total: "600", split_recovery: "474", split_storage: "126" }), "Split payment");
      if (split) return split;
      const lines = Object.fromEntries(moneyLines(ctx, claimId).map((line) => [line.head, line]));
      if (lines.recovery?.received !== 47400 || lines.storage?.received !== 12600) return `The split was not put on each head: ${JSON.stringify(lines)}`;
      if (lines.recovery.received + lines.storage.received !== 60000) return "The split counted money twice.";
      if (events(ctx, claimId, "payment_split_by_head").length !== 1) return "The split was not in the chronology.";
      if (events(ctx, claimId, "head_payment_logged").length !== 2) return "Each head did not get its own payment entry.";
      const storagePage = await pageText(ctx, `/claims/${claimId}/money/storage`);
      if (!/Outstanding\s+£154.80/.test(storagePage)) return "Storage did not show the £154.80 still outstanding.";
      return null;
    },
  },
  {
    title: "9. Overpayment",
    async run(ctx) {
      const made = await recoveryAndStorageClaim(ctx, "Overpay");
      if (typeof made === "string") return made;
      const { claimId } = made;
      await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/money/recovery`);
      const typed = await ctx.session.evaluate<string>(`(() => {
        for (const fold of document.querySelectorAll("details")) fold.open = true;
        const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Record payment received");
        const form = button?.closest("form");
        const amount = form?.querySelector('input[name="amount"]');
        if (!(amount instanceof HTMLInputElement)) return "no payment form";
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(amount, "500");
        amount.dispatchEvent(new Event("input", { bubbles: true }));
        button.click();
        return "";
      })()`);
      if (typed) return typed;
      let warning = "";
      for (let i = 0; i < 40 && !warning; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        warning = await ctx.session.evaluate<string>(`[...document.querySelectorAll('[role="alert"]')].map((el) => el.innerText).find((text) => text.includes("overpayment")) || ""`);
      }
      if (!warning.includes("£500.00 is £26.00 more than the £474.00 outstanding on Recovery")) return `No overpayment warning was shown: ${warning || "nothing"}`;
      if (moneyLines(ctx, claimId).some((line) => line.received > 0)) return "The overpayment was recorded before it was confirmed.";
      await ctx.session.evaluate<void>(`[...document.querySelectorAll('[role="alert"] button')].find((b) => b.textContent?.trim() === "Yes")?.click()`);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && events(ctx, claimId, "payment_overpaid").length === 0) await new Promise((r) => setTimeout(r, 250));
      const lines = Object.fromEntries(moneyLines(ctx, claimId).map((line) => [line.head, line]));
      if (lines.recovery?.received !== 50000) return `Recovery received was ${lines.recovery?.received}, not the £500.00 that arrived.`;
      if (lines.storage?.received !== 0) return "The overpayment was set against storage.";
      const overpaid = events(ctx, claimId, "payment_overpaid");
      if (overpaid.length !== 1 || !/£26.00 more than was outstanding/.test(String(overpaid[0].details))) return `The overpayment was not recorded: ${overpaid[0]?.details}`;
      const claimPage = await pageText(ctx, `/claims/${claimId}`);
      if (!/£26.00/.test(claimPage)) return "The overpayment was not shown separately on the claim.";
      const storagePage = await pageText(ctx, `/claims/${claimId}/money/storage`);
      if (!/Outstanding\s+£280.80/.test(storagePage)) return "Storage's outstanding figure was reduced by the overpayment.";
      return null;
    },
  },
  {
    title: "10. A fault claim through to the own-insurer invoice",
    async run(ctx) {
      const made = await newClaim(ctx, "FaultClaim", { claimType: "fault", roadworthiness: "roadworthy", needsRecovery: false, needsReplacement: false });
      if (typeof made === "string") return made;
      const { claimId } = made;
      const page = "/claims/" + claimId;
      const offered = async () => {
        await gotoPath(ctx.session, ctx.origin, page);
        return ctx.session.evaluate<string[]>("[...document.querySelectorAll('input[name=\"intent\"]')].map((item) => item.value)");
      };
      const step = async (intent: string, extra: Record<string, string>) => {
        const available = await offered();
        if (!available.includes(intent)) return "The claim page did not offer " + intent + " (offered: " + available.join(", ") + ").";
        return oneClick(ctx.session, intent, { occurredOn: HIRE_DAY, ...extra });
      };
      const own = await step("own_insurer", { claimNumber: "OWN-778812", note: "" });
      if (own) return own;
      const sent = await step("audatex_sent", { reference: "AX-55120", estimate: "2400" });
      if (sent) return sent;
      const auth = await step("audatex_auth", {
        reference: "AX-55120",
        estimate: "2400",
        authorised: "2100",
        hourly: "120",
        hourlyNote: "Labour rate reduced to the insurer's approved rate",
        partsReduction: "180",
        partsNote: "Pattern parts instead of genuine",
      });
      if (auth) return auth;
      const authorised = claimRow<{ authorised_total_pence: number }>(
        ctx,
        "SELECT authorised_total_pence FROM audatex_estimates WHERE claim_id = ? AND authorised_total_pence IS NOT NULL ORDER BY recorded_at DESC LIMIT 1",
        claimId,
      );
      if (authorised?.authorised_total_pence !== 210000) return "The authorisation with reductions was not recorded at £2,100.00.";
      // The car cannot go back before the excess is paid.
      const available = await offered();
      if (available.includes("return")) {
        const blocked = await oneClick(ctx.session, "return", { occurredOn: HIRE_DAY, reason: "" });
        if (!blocked || !/excess has to be recorded as paid/.test(blocked)) return "Releasing the car with the excess unpaid was not blocked: " + (blocked || "it was allowed");
      }
      if (events(ctx, claimId, "vehicle_returned").length) return "The car was released with the excess unpaid.";
      for (const milestone of ["repairs_started", "repairs_complete"]) {
        await gotoPath(ctx.session, ctx.origin, `/claims/${claimId}/documents?section=repair`);
        const recorded = followed(
          await submitForm(ctx.session, `form[action$="/repair/step"]:has(input[name="step"][value="${milestone}"])`, { occurredOn: HIRE_DAY, note: "Bodyshop update" }),
          milestone,
        );
        if (recorded) return recorded;
      }
      const excess = await step("excess", { amount: "250", method: "Card" });
      if (excess) return excess;
      const released = await step("return", { reason: "" });
      if (released) return released;
      if (events(ctx, claimId, "vehicle_returned").length !== 1) return "The car was not released after the excess was paid.";
      const invoiced = await step("invoice", {});
      if (invoiced) return invoiced;
      const invoice = events(ctx, claimId, "fault_invoice_sent");
      if (invoice.length !== 1 || !/Amount pence: 185000./.test(String(invoice[0].details))) {
        return "The own-insurer invoice was not the authorised £2,100.00 less the £250.00 excess: " + (invoice[0]?.details || "none");
      }
      return null;
    },
  },
];

/** Extra fictional fleet cars, so every case can put a car on hire. */
function addFleetCars(dbPath: string, count: number) {
  readDb(dbPath, (db) => {
    const vehicleColumns = (db.prepare(`PRAGMA table_info(vehicles)`).all() as Array<{ name: string }>).map((c) => c.name).filter((n) => n !== "id" && n !== "registration");
    const fleetColumns = (db.prepare(`PRAGMA table_info(fleet_vehicles)`).all() as Array<{ name: string }>)
      .map((c) => c.name)
      .filter((n) => !["id", "vehicle_id", "status", "location"].includes(n));
    for (let i = 1; i <= count; i += 1) {
      const vehicleId = `v-fleet-aw${i}`;
      db.prepare(
        `INSERT OR IGNORE INTO vehicles(id, registration, ${vehicleColumns.join(", ")}) SELECT ?, ?, ${vehicleColumns.join(", ")} FROM vehicles WHERE id = 'v-fleet-4'`,
      ).run(vehicleId, `CAS AW${i}`);
      db.prepare(
        `INSERT OR IGNORE INTO fleet_vehicles(id, vehicle_id, status, location, ${fleetColumns.join(", ")})
         SELECT ?, ?, 'available', 'CAS yard, Bridgend', ${fleetColumns.join(", ")} FROM fleet_vehicles WHERE id = 'fv-4'`,
      ).run(`fv-aw${i}`, vehicleId);
    }
  });
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    console.error("There is no production build. Run npm run build first.");
    process.exitCode = 1;
    return;
  }
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-awkward-db-"));
  const databasePath = path.join(databaseDir, "cas-crm.sqlite");
  const port = await freePort(3300);
  const origin = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: databasePath, EMAIL_SEND_MODE: "simulate" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  const keep = (chunk: Buffer) => {
    serverLog = (serverLog + chunk.toString("utf8")).slice(-3000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let stopBrowser: () => void = () => undefined;
  const only = process.argv.slice(2);
  let failed = 0;
  try {
    await waitUntilReady(origin, child);
    const cookie = await signIn(origin);
    addFleetCars(databasePath, 12);
    const browser = await openBrowser();
    stopBrowser = browser.stop;
    const [cookieName, ...cookieRest] = cookie.split("=");
    await browser.session.send("Network.setCookie", { name: cookieName, value: cookieRest.join("="), url: origin });
    const ctx: Ctx = { session: browser.session, origin, dbPath: databasePath, cookie };
    for (const item of CASES) {
      if (only.length && !only.some((n) => item.title.startsWith(`${n}.`))) continue;
      let problem: string | null;
      try {
        problem = await item.run(ctx);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (problem) {
        failed += 1;
        console.log(`FAIL  ${item.title}  ${problem}`);
      } else {
        console.log(`PASS  ${item.title}`);
      }
    }
  } catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : "The awkward-case check failed.");
    if (serverLog.trim()) console.error(serverLog.trim());
  } finally {
    stopBrowser();
    if (child.exitCode === null && !child.killed) stopTree(child);
    try {
      fs.rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      /* The database file can still be open for a moment. */
    }
  }
  if (failed) {
    process.exitCode = 1;
    console.error(`${failed} awkward case${failed === 1 ? "" : "s"} failed.`);
    return;
  }
  console.log("Awkward cases passed. Email stayed on simulate. The demonstration database was not used.");
}

main().then(() => process.exit(process.exitCode ?? 0));

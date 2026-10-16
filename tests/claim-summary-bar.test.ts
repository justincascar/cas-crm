import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { describe, it } from "node:test";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { claimOutstandingSummary, getClaim } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { dueWording } from "../src/lib/domain/due-wording.ts";
import { buildClaimSummaryModel, runningDailyLabel } from "../src/lib/claims/claim-summary.ts";
import { claimRunningDaily } from "../src/lib/db/desk-work.ts";
import { confirmedOutstandingPence, outstandingColumnText, PROVISIONAL_NOT_FINAL } from "../src/lib/claims/summary-money.ts";
import { formatGbp } from "../src/lib/money.ts";
import { formatVehicleRegistration } from "../src/lib/text.ts";
import type { ClaimSummaryModel } from "../src/lib/claims/claim-summary.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function warmup() {
  const row = get<{ id: string }>(`SELECT id FROM claims WHERE id = 'c8'`);
  assert.equal(row?.id, "c8");
}

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/claims/c8" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Node = window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {
  window.document.documentElement.dataset.scrolled = "summary";
};

let observerCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
class MockObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observerCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = MockObserver as unknown as typeof IntersectionObserver;

const sample: ClaimSummaryModel = {
  reference: "TEST-0008",
  client: "Haf Davies",
  registration: "CF63 HDA",
  handler: "Megan Price",
  insurerLine: "AXA · AX-CL-1002",
  statusLine: "Non-fault · Unroadworthy · Insurer Admitted",
  steps: ["Open", "Repairs"],
  stage: "Repairs",
  runningText: "£79.00/day running",
  runningDaily: "£79.00/day",
  charges: [
    {
      head: "hire",
      label: "Hire",
      details: ["Hire until repaired vehicle returned"],
      claimed: "£1,896.00",
      agreed: "—",
      received: "£0.00",
      outstanding: `${PROVISIONAL_NOT_FINAL} £1,896.00`,
      overpaid: "—",
      reviewNote: null,
    },
  ],
  outstandingTotal: "£0.00",
  nextAction: "Arrange customer collection of repaired vehicle",
  dueText: "Overdue by 25 days",
  dueClass: "font-semibold text-overdue",
  flags: [
    { id: "task:t7", href: "/claims/c8#tasks", label: "Task due today: Customer return of repaired vehicle" },
    { id: "chase:hire", href: "/claims/c8/work/comms", label: "Hire payment chase due" },
  ],
  conflict: null,
};

let summaryRoot: { render: (node: unknown) => void } | null = null;

async function renderSummary(model: ClaimSummaryModel) {
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ClaimSummaryView } = await import("../src/components/claims/ClaimSummaryView.tsx");
  if (!summaryRoot) summaryRoot = createRoot(document.getElementById("root")!) as { render: (node: unknown) => void };
  await act(async () => {
    summaryRoot?.render(createElement(ClaimSummaryView, { model }));
  });
}

describe("claim summary bar", () => {
  it("keeps the full summary in the page flow and pins only the slim bar after it scrolls away", async () => {
    const source = read("src/components/claims/ClaimSummaryView.tsx");
    const summaryTag = source.slice(source.indexOf("<section"), source.indexOf(">", source.indexOf("data-claim-summary")) + 1);
    assert.match(summaryTag, /data-claim-summary/);
    assert.doesNotMatch(summaryTag, /sticky|fixed/);
    const slimTag = source.slice(source.indexOf("<button"), source.indexOf(">", source.indexOf("data-claim-slim-bar")) + 1);
    assert.match(slimTag, /data-claim-slim-bar/);
    assert.match(slimTag, /fixed/);
    for (const field of ["reference", "client", "registration", "running", "outstanding", "next", "due"]) {
      assert.match(source, new RegExp(`data-slim="${field}"`));
    }

    await renderSummary(sample);
    const summary = document.querySelector("[data-claim-summary]");
    assert.ok(summary);
    assert.equal(String(summary.className).includes("sticky"), false);
    assert.equal(String(summary.className).includes("fixed"), false);
    assert.equal(document.querySelector("[data-claim-slim-bar]"), null);
    assert.match(summary.textContent || "", /TEST-0008/);
    assert.match(summary.textContent || "", /Haf Davies/);

    assert.ok(observerCallback);
    const { act } = await import("react");
    await act(async () => {
      observerCallback?.([{ isIntersecting: false }]);
    });
    const bar = document.querySelector("[data-claim-slim-bar]");
    assert.ok(bar);
    assert.match(String(bar.className), /fixed/);
    assert.equal(bar.querySelector('[data-slim="reference"]')?.textContent, "TEST-0008");
    assert.equal(bar.querySelector('[data-slim="client"]')?.textContent, "Haf Davies");
    assert.equal(bar.querySelector('[data-slim="registration"]')?.textContent, "CF63 HDA");
    assert.equal(bar.querySelector('[data-slim="running"]')?.textContent, "£79.00/day");
    assert.equal(bar.querySelector('[data-slim="outstanding"]')?.textContent, "£0.00");
    assert.equal(bar.querySelector('[data-slim="next"]')?.textContent, "Arrange customer collection of repaired vehicle");
    assert.equal(bar.querySelector('[data-slim="due"]')?.textContent, "Overdue by 25 days");
    assert.match(bar.className, /max-h-10/);

    await act(async () => {
      (bar as HTMLButtonElement).click();
    });
    assert.equal(document.documentElement.dataset.scrolled, "summary");

    await act(async () => {
      observerCallback?.([{ isIntersecting: true }]);
    });
    assert.equal(document.querySelector("[data-claim-slim-bar]"), null);
  });

  it("opens and closes the flag list", async () => {
    await renderSummary(sample);
    assert.equal(document.querySelector("[data-claim-summary] ul"), null);
    const show = [...document.querySelectorAll("button")].find((button) => button.textContent === "Show");
    assert.ok(show);
    assert.match(document.querySelector("[data-claim-summary]")?.textContent || "", /2 open flags/);
    const { act } = await import("react");
    await act(async () => {
      show.click();
    });
    const list = document.querySelector("[data-claim-summary] ul");
    assert.ok(list);
    const links = [...list.querySelectorAll("a")];
    assert.equal(links.length, 2);
    assert.equal(links[0]?.textContent, "Task due today: Customer return of repaired vehicle");
    assert.equal(links[0]?.getAttribute("href"), "/claims/c8#tasks");
    assert.equal(links[1]?.getAttribute("href"), "/claims/c8/work/comms");
    assert.equal(links.every((link) => link.classList.contains("no-underline")), true);
    const hide = [...document.querySelectorAll("button")].find((button) => button.textContent === "Hide");
    assert.ok(hide);
    await act(async () => {
      hide.click();
    });
    assert.equal(document.querySelector("[data-claim-summary] ul"), null);
  });

  it("uses one claim navigation row and does not repeat the claim heading under the tabs", () => {
    const frame = read("src/components/claim-file/ClaimSectionFrame.tsx");
    const page = read("src/app/claims/[id]/page.tsx");
    const layout = read("src/app/claims/[id]/layout.tsx");
    assert.equal((frame.match(/<nav /g) || []).length, 1);
    for (const label of [
      "Overview",
      "Email / WhatsApp / Calls",
      "File screens",
      "Handover",
      "Documents",
      "Vehicles",
      "Repair evidence",
      "Hire Pack",
      "Pre-hire checks",
      "Financial circumstances",
      "Recovery",
      "Storage",
      "Hire",
      "Vehicle damage",
    ]) {
      assert.match(frame, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(frame, /aria-current=\{tab\.active \? "page" : undefined\}/);
    assert.match(frame, /flex-wrap/);
    assert.doesNotMatch(frame, /overflow-x-auto/);
    assert.match(layout, /← All claims/);
    assert.match(layout, /href="\/claims"/);
    assert.doesNotMatch(page, /PageHeader/);
    assert.doesNotMatch(page, /Heads of loss/);
    assert.doesNotMatch(page, /<OutstandingSummary/);
    assert.doesNotMatch(page, /Open communications/);
    assert.doesNotMatch(page, /<h1/);
  });

  it("labels a provisional outstanding figure, and says none only when the final figure is nothing", () => {
    const provisional = outstandingColumnText({ outstandingPence: null, provisionalClaimedPence: 189600 });
    assert.match(provisional, new RegExp(PROVISIONAL_NOT_FINAL));
    assert.match(provisional, /£1,896\.00/);
    assert.equal(provisional.includes("none"), false);
    assert.equal(outstandingColumnText({ outstandingPence: 0, provisionalClaimedPence: 0 }), "none");
    assert.equal(outstandingColumnText({ outstandingPence: null, provisionalClaimedPence: 0 }), "none");
    const owed = outstandingColumnText({ outstandingPence: 240000, provisionalClaimedPence: 0 });
    assert.equal(owed, "£2,400.00");
    assert.equal(owed.includes("none"), false);
    const mixed = outstandingColumnText({ outstandingPence: 0, provisionalClaimedPence: 5000 });
    assert.match(mixed, new RegExp(PROVISIONAL_NOT_FINAL));
    assert.equal(mixed.includes("none"), false);
    assert.equal(confirmedOutstandingPence(null), 0);
    assert.equal(confirmedOutstandingPence(-50), 0);
    assert.equal(confirmedOutstandingPence(1200), 1200);
  });

  it("shows TEST-0008's confirmed outstanding, next action and every charge on the slim bar", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        warmup();
        const claimRow = get<{
          file_reference: string;
          next_action: string | null;
          next_action_due: string | null;
          registration: string | null;
          claimed_pence: number | null;
        }>(
          `SELECT c.file_reference, c.next_action, c.next_action_due, v.registration,
                  (SELECT fl.claimed_pence FROM financial_lines fl WHERE fl.claim_id = c.id AND fl.head_of_loss = 'hire' LIMIT 1) AS claimed_pence
           FROM claims c
           LEFT JOIN vehicles v ON v.id = c.client_vehicle_id
           WHERE c.id = 'c8'`,
        );
        assert.equal(claimRow?.file_reference, "TEST-0008");
        const claimedBefore = Number(claimRow?.claimed_pence);
        const stored = getClaim("c8");
        assert.equal(String(stored?.claim.client_name), "Haf Davies");
        const money = claimOutstandingSummary("c8");
        const model = buildClaimSummaryModel("c8");
        assert.ok(model);
        assert.equal(model.reference, "TEST-0008");
        assert.equal(model.client, "Haf Davies");
        assert.equal(model.registration, formatVehicleRegistration(String(claimRow?.registration || "")));
        assert.equal(model.runningDaily, runningDailyLabel(claimRunningDaily("c8")));
        assert.equal(model.outstandingTotal, formatGbp(confirmedOutstandingPence(money.confirmed.outstandingPence)));
        if (money.confirmed.overpaidPence > 0) {
          assert.notEqual(
            model.outstandingTotal,
            formatGbp(confirmedOutstandingPence(money.confirmed.outstandingPence) - money.confirmed.overpaidPence),
          );
        }
        assert.equal(model.nextAction, String(claimRow?.next_action || "None set"));
        assert.equal(model.dueText, claimRow?.next_action_due ? dueWording(String(claimRow.next_action_due)).text : "No due date");
        assert.equal(model.charges.length, money.heads.length);
        for (const head of money.heads) {
          const charge: (typeof model.charges)[number] | undefined = model.charges.find((row) => row.head === head.head);
          assert.ok(charge);
          assert.equal(charge.outstanding, outstandingColumnText(head));
          if (head.provisionalClaimedPence > 0 && (head.outstandingPence === null || head.outstandingPence === 0)) {
            assert.match(charge.outstanding, new RegExp(PROVISIONAL_NOT_FINAL));
            assert.match(charge.outstanding, new RegExp(formatGbp(head.provisionalClaimedPence).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            assert.equal(charge.outstanding.includes("none"), false);
          }
          if ((head.outstandingPence === 0 || head.outstandingPence === null) && head.provisionalClaimedPence === 0) {
            assert.equal(charge.outstanding, "none");
          }
        }
        const claimedAfter = get<{ claimed_pence: number }>(
          `SELECT claimed_pence FROM financial_lines WHERE claim_id = 'c8' AND head_of_loss = 'hire' LIMIT 1`,
        );
        assert.equal(Number(claimedAfter?.claimed_pence), claimedBefore);
        const storageEnd = get<{ storage_billing_end_on: string | null }>(
          `SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`,
        );
        assert.equal(String(storageEnd?.storage_billing_end_on || ""), "");
      });
    } finally {
      db.close();
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { getDashboard, listClaims, listTasks } from "../src/lib/db/queries.ts";
import { listFinishedRepairGapClaims, listRepairGapClaims } from "../src/lib/db/repair-progress.ts";
import { seed } from "../src/lib/db/seed.ts";
import { defaultDashboardScope, resolveDashboardScope } from "../src/lib/domain/dashboard-scope.ts";
import { dueWording } from "../src/lib/domain/due-wording.ts";
import { claimedFigureIsConfirmed, lineOutstanding, summariseHeads } from "../src/lib/domain/head-outstanding.ts";
import { nothingDueLine, todaysWorkRows, type DeskWorkItem } from "../src/lib/domain/todays-work.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function money(db: DatabaseSync, claimId: string, head: string) {
  const row = db
    .prepare(
      `SELECT claimed_pence, offered_pence, agreed_pence, received_pence FROM financial_lines WHERE claim_id = ? AND head_of_loss = ?`,
    )
    .get(claimId, head) as
    | { claimed_pence: number; offered_pence: number; agreed_pence: number; received_pence: number }
    | undefined;
  assert.ok(row);
  return {
    claimed: Number(row.claimed_pence),
    offered: Number(row.offered_pence),
    agreed: Number(row.agreed_pence),
    received: Number(row.received_pence),
  };
}

function item(partial: Partial<DeskWorkItem> & Pick<DeskWorkItem, "id" | "claimId" | "fileReference" | "sortDays">): DeskWorkItem {
  return {
    clientName: "Client",
    handlerName: "Handler",
    item: partial.item || partial.id,
    wording: partial.wording || "",
    tone: partial.tone || "today",
    ...partial,
  };
}

describe("dashboard desk", () => {
  it("says overdue by real days, due today, and does not call a future date overdue", () => {
    const today = "2026-10-15";
    assert.equal(dueWording("2026-10-08", today).text, "Overdue by 7 days");
    assert.equal(dueWording("2026-10-14", today).text, "Overdue by 1 day");
    assert.equal(dueWording("2026-10-15", today).text, "Due today");
    const future = dueWording("2026-10-20", today);
    assert.equal(future.tone, "future");
    assert.equal(future.text.includes("Overdue"), false);
    assert.equal(future.text.includes("Due"), false);
  });

  it("collapses empty section names into one line", () => {
    assert.equal(nothingDueLine([]), null);
    assert.equal(
      nothingDueLine(["Liability response chases due", "Repair invoice payments"]),
      "Nothing due: Liability response chases due, Repair invoice payments",
    );
  });

  it("shows one row per claim, most overdue first, with the rest behind the lead", () => {
    const rows = todaysWorkRows([
      item({ id: "today", claimId: "c2", fileReference: "TEST-0002", sortDays: 0, tone: "today", wording: "Due today", item: "Book repair" }),
      item({ id: "soon", claimId: "c3", fileReference: "TEST-0003", sortDays: -4, tone: "future", wording: "20/10/2026", item: "Later" }),
      item({ id: "old", claimId: "c1", fileReference: "TEST-0001", sortDays: 2, tone: "overdue", wording: "Overdue by 2 days", item: "Chase" }),
      item({ id: "older", claimId: "c1", fileReference: "TEST-0001", sortDays: 26, tone: "overdue", wording: "Overdue by 26 days", item: "Report" }),
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.fileReference, "TEST-0001");
    assert.equal(rows[0]?.lead.item, "Report");
    assert.equal(rows[0]?.lead.wording, "Overdue by 26 days");
    assert.equal(rows[0]?.rest.length, 1);
    assert.equal(rows[0]?.rest[0]?.item, "Chase");
    assert.equal(rows[1]?.fileReference, "TEST-0002");
    assert.equal(rows[1]?.rest.length, 0);
    assert.equal(rows[1]?.lead.wording, "Due today");
    assert.equal(rows[2]?.fileReference, "TEST-0003");
    assert.equal(rows[2]?.lead.tone, "future");
  });

  it("adds outstanding per claim and keeps confirmed and provisional apart", () => {
    const agreed = lineOutstanding({
      claimId: "a",
      fileReference: "TEST-A",
      head: "hire",
      claimedPence: 20_000,
      offeredPence: 0,
      agreedPence: 10_000,
      receivedPence: 4_000,
      claimedConfirmed: true,
    });
    assert.equal(agreed.basis, "agreed");
    assert.equal(agreed.outstandingPence, 6_000);
    const claimed = lineOutstanding({
      claimId: "b",
      fileReference: "TEST-B",
      head: "hire",
      claimedPence: 8_000,
      offeredPence: 0,
      agreedPence: 0,
      receivedPence: 1_000,
      claimedConfirmed: true,
    });
    assert.equal(claimed.basis, "confirmed_claimed");
    assert.equal(claimed.outstandingPence, 7_000);
    const provisional = lineOutstanding({
      claimId: "c",
      fileReference: "TEST-C",
      head: "hire",
      claimedPence: 50_000,
      offeredPence: 1_000,
      agreedPence: 0,
      receivedPence: 0,
      claimedConfirmed: false,
    });
    assert.equal(provisional.basis, "none");
    assert.equal(provisional.outstandingPence, null);
    const summary = summariseHeads([
      {
        claimId: "a",
        fileReference: "TEST-A",
        head: "hire",
        claimedPence: 20_000,
        offeredPence: 0,
        agreedPence: 10_000,
        receivedPence: 4_000,
        claimedConfirmed: true,
      },
      {
        claimId: "b",
        fileReference: "TEST-B",
        head: "hire",
        claimedPence: 8_000,
        offeredPence: 0,
        agreedPence: 0,
        receivedPence: 1_000,
        claimedConfirmed: true,
      },
      {
        claimId: "c",
        fileReference: "TEST-C",
        head: "hire",
        claimedPence: 50_000,
        offeredPence: 1_000,
        agreedPence: 0,
        receivedPence: 0,
        claimedConfirmed: false,
      },
    ]);
    const hire = summary.heads[0];
    assert.ok(hire);
    assert.equal(hire.outstandingPence, 13_000);
    assert.equal(hire.outstandingPence === hire.agreedPence - hire.receivedPence, false);
    assert.equal(hire.confirmedClaimedPence, 28_000);
    assert.equal(hire.provisionalClaimedPence, 50_000);
    assert.equal(summary.confirmed.claimedPence, 28_000);
    assert.equal(summary.provisional.claimedPence, 50_000);
    assert.equal(summary.confirmed.outstandingPence, 13_000);
    assert.equal(claimedFigureIsConfirmed({ head: "storage", claimedPence: 100, storageStartMissing: true }), false);
    assert.equal(claimedFigureIsConfirmed({ head: "hire", claimedPence: 100, description: "Hire, provisional to today" }), false);
    assert.equal(claimedFigureIsConfirmed({ head: "hire", claimedPence: 0, hireUnconfirmed: false }), false);
    assert.equal(claimedFigureIsConfirmed({ head: "recovery", claimedPence: 100 }), true);
  });

  it("labels an overpayment instead of clamping it", () => {
    const summary = summariseHeads([
      {
        claimId: "c6",
        fileReference: "TEST-0006",
        head: "repairs",
        claimedPence: 20_000,
        offeredPence: 0,
        agreedPence: 10_000,
        receivedPence: 15_000,
        claimedConfirmed: true,
      },
    ]);
    const row = summary.heads[0];
    assert.ok(row);
    assert.equal(row.outstandingPence, -5_000);
    assert.equal(summary.overpayments.length, 1);
    assert.equal(summary.overpayments[0]?.fileReference, "TEST-0006");
    assert.equal(summary.overpayments[0]?.head, "repairs");
    assert.equal(summary.overpayments[0]?.overpaidPence, 5_000);
    assert.equal(summary.overpayments[0]?.agreedPence, 10_000);
    assert.equal(summary.overpayments[0]?.receivedPence, 15_000);
  });

  it("filters the desk to one handler, and Justin's default is every claim", () => {
    assert.equal(defaultDashboardScope({ id: "staff-justin", username: "justin" }), "all");
    assert.equal(defaultDashboardScope({ id: "staff-sian", username: "sian" }), "mine");
    assert.equal(resolveDashboardScope({ id: "staff-sian", username: "sian" }, null, "staff-justin:all"), "mine");
    assert.equal(resolveDashboardScope({ id: "staff-justin", username: "justin" }, null, "staff-justin:mine"), "mine");
    assert.equal(resolveDashboardScope({ id: "staff-sian", username: "sian" }, null, "staff-sian:all"), "all");
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const all = getDashboard();
        const sian = getDashboard({ handlerId: "staff-sian" });
        assert.ok(sian.claims.length > 0);
        assert.ok(sian.claims.length < all.claims.length);
        for (const row of sian.claims) assert.equal(row.handler_name, "Sian Evans");
        const sianIds = new Set(sian.claims.map((row) => row.id));
        for (const row of sian.todaysWork) assert.equal(sianIds.has(row.claimId), true);
        for (const row of sian.chasesDue) assert.equal(sianIds.has(row.claimId), true);
        for (const row of sian.repairProgressGaps) assert.equal(sianIds.has(row.claimId), true);
        assert.equal(sian.cards.find((card) => card.key === "active_hire")?.count, listClaims({ queue: "active_hire", handlerId: "staff-sian" }).length);
        const refs = all.todaysWork.map((row) => row.fileReference);
        assert.equal(new Set(refs).size, refs.length);
        for (let index = 1; index < all.todaysWork.length; index += 1) {
          assert.ok(all.todaysWork[index - 1]!.lead.sortDays >= all.todaysWork[index]!.lead.sortDays);
        }
      });
    } finally {
      db.close();
    }
  });

  it("keeps finished repair gaps off the dashboard list", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listRepairGapClaims();
        const before = listRepairGapClaims().filter((row) => row.fileReference === "TEST-0008");
        assert.ok(before.length > 0);
        assert.equal(listFinishedRepairGapClaims().some((row) => row.fileReference === "TEST-0008"), false);
        db.prepare(`UPDATE claims SET repaired_vehicle_returned = 1 WHERE id = 'c8'`).run();
        const open = listRepairGapClaims().filter((row) => row.fileReference === "TEST-0008");
        const finished = listFinishedRepairGapClaims().filter((row) => row.fileReference === "TEST-0008");
        assert.equal(open.length, 0);
        assert.ok(finished.length > 0);
        assert.equal(finished[0]?.wording, before.find((row) => row.wording === finished[0]?.wording)?.wording);
      });
    } finally {
      db.close();
    }
  });

  it("opens every tile on its filtered list and explains active hire against the fleet", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        listClaims();
        const dashboard = getDashboard();
        const claimQueues = new Set([
          "new_enquiries",
          "active_hire",
          "storage",
          "storage_chargeable",
          "liability",
          "engineer",
          "repair_auth",
          "repairs_progress",
          "ready_return",
          "tl_payment",
          "off_hire",
          "salvage",
          "renewals",
          "unread",
          "offers",
          "litigation",
        ]);
        for (const card of dashboard.cards) {
          assert.equal(typeof card.href, "string");
          assert.ok(card.href.startsWith("/"));
          if (card.key === "fleet_available") {
            assert.equal(card.href, "/hire?status=available");
            continue;
          }
          if (card.key === "tasks_today") {
            assert.equal(card.href, "/tasks?when=today");
            assert.equal(card.count, listTasks("today").length);
            continue;
          }
          if (card.key === "tasks_overdue") {
            assert.equal(card.href, "/tasks?when=overdue");
            assert.equal(card.count, listTasks("overdue").length);
            continue;
          }
          assert.equal(claimQueues.has(card.key), true);
          assert.equal(card.href, `/claims?queue=${card.key}`);
          assert.equal(card.count, listClaims({ queue: card.key }).length);
        }
        const active = dashboard.cards.find((card) => card.key === "active_hire");
        assert.equal(active?.count, 7);
        assert.equal(dashboard.fleetMap.on_hire, 6);
        assert.match(String(active?.note), /TEST-0010/);
        assert.match(String(active?.note), /maintenance/);
        const hire = dashboard.moneyHeads.find((row) => row.head === "hire");
        assert.ok(hire);
        assert.equal(hire.confirmedClaimedPence + hire.provisionalClaimedPence, dashboard.byHead.hire?.claimed);
      });
    } finally {
      db.close();
    }
  });

  it("does not change TEST-0006, TEST-0007 or TEST-0009 money, or confirm TEST-0005 storage", () => {
    const db = seeded();
    try {
      withDatabase(db, () => {
        const before = {
          c6: money(db, "c6", "repairs"),
          c7: money(db, "c7", "hire"),
          c9: money(db, "c9", "vehicle_damage"),
        };
        getDashboard();
        assert.equal(money(db, "c6", "repairs").claimed, before.c6.claimed);
        assert.equal(money(db, "c6", "repairs").agreed, before.c6.agreed);
        assert.equal(money(db, "c6", "repairs").received, before.c6.received);
        assert.equal(money(db, "c7", "hire").claimed, before.c7.claimed);
        assert.equal(money(db, "c7", "hire").agreed, before.c7.agreed);
        assert.equal(money(db, "c7", "hire").received, before.c7.received);
        assert.equal(money(db, "c9", "vehicle_damage").claimed, before.c9.claimed);
        assert.equal(money(db, "c9", "vehicle_damage").offered, before.c9.offered);
        assert.equal(money(db, "c9", "vehicle_damage").agreed, before.c9.agreed);
        assert.equal(money(db, "c9", "vehicle_damage").received, before.c9.received);
        const storage = db.prepare(`SELECT storage_billing_end_on FROM claims WHERE id = 'c5'`).get() as {
          storage_billing_end_on: string | null;
        };
        assert.equal(storage.storage_billing_end_on, null);
      });
    } finally {
      db.close();
    }
  });

  it("does not render an empty chase as its own section", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.match(page, /nothingDueLine/);
    assert.equal(page.includes("None due."), false);
    assert.match(page, /Gaps to explain before any dispute/);
  });
});

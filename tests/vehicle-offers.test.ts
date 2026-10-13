import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { loadHeadSection } from "../src/lib/db/head-screen.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { recordAgreedRepairInvoice } from "../src/lib/db/payment-ledger.ts";
import { seed } from "../src/lib/db/seed.ts";
import { confirmTypedVehicleDamageAgreed } from "../src/lib/db/total-loss.ts";
import {
  agreedOnFor,
  listVehicleOffers,
  markVehicleOffer,
  recordVehicleOffer,
  undatedOfferPence,
  vehicleOfferHead,
} from "../src/lib/db/vehicle-offers.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function money(db: DatabaseSync, claimId: string, head: string) {
  return db
    .prepare(
      `SELECT claimed_pence, offered_pence, agreed_pence, received_pence, agreed_on
       FROM financial_lines WHERE claim_id = ? AND head_of_loss = ?`,
    )
    .get(claimId, head) as {
    claimed_pence: number;
    offered_pence: number;
    agreed_pence: number;
    received_pence: number;
    agreed_on: string | null;
  };
}

describe("vehicle damage offers", () => {
  it("records an offer, keeps it after another is added, and leaves outstanding against claimed", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = loadHeadSection("c6", "repairs");
      assert.equal(before.claimedPence, 240000);
      assert.equal(before.outstandingPence, 240000);
      assert.equal(listVehicleOffers("c6", "repairs").length, 0);

      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 800000,
        offeredOn: "2026-03-01",
        note: "Subject to the engineer's report",
      });
      const first = listVehicleOffers("c6", "repairs");
      assert.equal(first.length, 1);
      assert.equal(first[0].amountPence, 800000);
      assert.equal(first[0].offeredOn, "2026-03-01");
      assert.equal(first[0].note, "Subject to the engineer's report");
      assert.equal(first[0].status, "open");
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 240000);
      assert.equal(money(db, "c6", "repairs").received_pence, 0);
      assert.equal(money(db, "c6", "repairs").agreed_pence, 0);
      assert.equal(money(db, "c6", "repairs").offered_pence, 800000);

      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 920000,
        offeredOn: "2026-04-02",
        note: "",
      });
      const both = listVehicleOffers("c6", "repairs");
      assert.deepEqual(
        both.map((offer) => [offer.amountPence, offer.offeredOn, offer.status]),
        [
          [920000, "2026-04-02", "open"],
          [800000, "2026-03-01", "open"],
        ],
      );
      assert.equal(money(db, "c6", "repairs").offered_pence, 920000);
      assert.equal(money(db, "c6", "repairs").claimed_pence, 240000);
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 240000);
    });
    db.close();
  });

  it("accepts an offer into the agreed figure at a date staff choose, and a later edit replaces it", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 800000,
        offeredOn: "2026-03-01",
        note: "",
      });
      recordAgreedRepairInvoice({
        claimId: "c6",
        actorId: "staff-justin",
        agreedPence: 800000,
        agreedOn: "2026-03-12",
      });
      assert.equal(money(db, "c6", "repairs").agreed_pence, 800000);
      assert.equal(money(db, "c6", "repairs").agreed_on, "2026-03-12");
      assert.equal(money(db, "c6", "repairs").received_pence, 0);
      assert.equal(agreedOnFor("c6", "repairs"), "2026-03-12");
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 800000);
      assert.equal(listVehicleOffers("c6", "repairs").length, 1);

      recordAgreedRepairInvoice({
        claimId: "c6",
        actorId: "staff-justin",
        agreedPence: 920000,
        agreedOn: "2026-04-10",
      });
      assert.equal(money(db, "c6", "repairs").agreed_pence, 920000);
      assert.equal(money(db, "c6", "repairs").agreed_on, "2026-04-10");
      assert.equal(money(db, "c6", "repairs").received_pence, 0);
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 920000);
      assert.equal(listVehicleOffers("c6", "repairs")[0].amountPence, 800000);
    });
    db.close();
  });

  it("records an agreed figure and its date when no offer has been entered", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(listVehicleOffers("c6", "repairs").length, 0);
      recordAgreedRepairInvoice({
        claimId: "c6",
        actorId: "staff-justin",
        agreedPence: 700000,
        agreedOn: "2026-05-01",
      });
      assert.equal(listVehicleOffers("c6", "repairs").length, 0);
      assert.equal(money(db, "c6", "repairs").agreed_pence, 700000);
      assert.equal(money(db, "c6", "repairs").agreed_on, "2026-05-01");
      assert.equal(money(db, "c6", "repairs").offered_pence, 0);
      assert.equal(money(db, "c6", "repairs").received_pence, 0);
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 700000);
    });
    db.close();
  });

  it("keeps a withdrawn offer on the list and measures the current offer from what is still open", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 800000,
        offeredOn: "2026-03-01",
        note: "",
      });
      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 920000,
        offeredOn: "2026-04-02",
        note: "",
      });
      const later = listVehicleOffers("c6", "repairs")[0];
      markVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        offerId: later.id,
        status: "withdrawn",
      });
      const offers = listVehicleOffers("c6", "repairs");
      assert.equal(offers.length, 2);
      assert.equal(offers[0].status, "withdrawn");
      assert.equal(offers[0].amountPence, 920000);
      assert.equal(offers[1].status, "open");
      assert.equal(offers[1].amountPence, 800000);
      assert.equal(money(db, "c6", "repairs").offered_pence, 800000);
      assert.equal(money(db, "c6", "repairs").agreed_pence, 0);
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 240000);
    });
    db.close();
  });

  it("records a total-loss agreed figure and date without turning the undated offer into history", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(undatedOfferPence("c9", "vehicle_damage"), 1200000);
      confirmTypedVehicleDamageAgreed({
        claimId: "c9",
        actorId: "staff-justin",
        agreedPence: 1100000,
        agreedOn: "2026-06-04",
      });
      assert.equal(listVehicleOffers("c9", "vehicle_damage").length, 0);
      assert.equal(money(db, "c9", "vehicle_damage").agreed_pence, 1100000);
      assert.equal(money(db, "c9", "vehicle_damage").agreed_on, "2026-06-04");
      assert.equal(money(db, "c9", "vehicle_damage").offered_pence, 1200000);
      assert.equal(money(db, "c9", "vehicle_damage").received_pence, 0);
      assert.equal(money(db, "c9", "vehicle_damage").claimed_pence, 1450000);
      assert.equal(loadHeadSection("c9", "vehicle_damage").outstandingPence, 1100000);
      assert.equal(undatedOfferPence("c9", "vehicle_damage"), 1200000);
    });
    db.close();
  });

  it("loads an existing total-loss file that has an undated offer and no offer history", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(vehicleOfferHead("c9"), "vehicle_damage");
      assert.equal(listVehicleOffers("c9", "vehicle_damage").length, 0);
      assert.equal(undatedOfferPence("c9", "vehicle_damage"), 1200000);
      const section = loadHeadSection("c9", "vehicle_damage");
      assert.equal(section.claimedPence, 1450000);
      assert.equal(section.agreedPence, null);
      assert.equal(section.receivedPence, 0);
      assert.equal(section.outstandingPence, 1450000);
      const hire = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/heads/hire/page.tsx"), "utf8");
      const recovery = fs.readFileSync(
        path.join(process.cwd(), "src/app/claims/[id]/heads/recovery-storage/page.tsx"),
        "utf8",
      );
      assert.doesNotMatch(hire, /VehicleOffers/);
      assert.doesNotMatch(recovery, /VehicleOffers/);
      const screen = fs.readFileSync(path.join(process.cwd(), "src/components/claims/VehicleOffers.tsx"), "utf8");
      assert.match(screen, /scrollIntoView/);
      assert.match(screen, /Reject/);
      assert.match(screen, /recordingGuard/);
      const openActions = screen.slice(screen.indexOf('offer.status === "open"'));
      assert.match(openActions, /Use this figure/);
      assert.equal(screen.slice(0, screen.indexOf('offer.status === "open"')).includes("Use this figure"), false);
    });
    db.close();
  });

  it("records one row when the same offer is submitted twice in a row", () => {
    const db = seeded();
    withDatabase(db, () => {
      const first = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 1300000,
        offeredOn: "2026-10-12",
        note: "",
      });
      const second = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 1300000,
        offeredOn: "2026-10-12",
        note: "",
      });
      assert.equal(second, first);
      assert.equal(listVehicleOffers("c6", "repairs").length, 1);
      assert.equal(money(db, "c6", "repairs").offered_pence, 1300000);
      db.prepare(`UPDATE insurer_offers SET recorded_at = ? WHERE id = ?`).run("2026-10-12T17:00:00.000Z", first);
      const later = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 1300000,
        offeredOn: "2026-10-12",
        note: "",
      });
      assert.notEqual(later, first);
      assert.equal(listVehicleOffers("c6", "repairs").length, 2);
    });
    db.close();
  });

  it("keeps a rejected offer on the list, with its note, and stops treating it as the current offer", () => {
    const db = seeded();
    withDatabase(db, () => {
      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 800000,
        offeredOn: "2026-03-01",
        note: "First offer",
      });
      const later = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 1300000,
        offeredOn: "2026-10-12",
        note: "",
      });
      markVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        offerId: later,
        status: "rejected",
        note: "Below the repair invoice",
      });
      const offers = listVehicleOffers("c6", "repairs");
      assert.equal(offers.length, 2);
      assert.equal(offers[0].id, later);
      assert.equal(offers[0].status, "rejected");
      assert.equal(offers[0].closedNote, "Below the repair invoice");
      assert.ok(offers[0].closedAt);
      assert.equal(offers[0].amountPence, 1300000);
      assert.equal(offers[1].status, "open");
      assert.equal(money(db, "c6", "repairs").offered_pence, 800000);
      assert.equal(money(db, "c6", "repairs").agreed_pence, 0);
      assert.equal(loadHeadSection("c6", "repairs").outstandingPence, 240000);
    });
    db.close();
  });

  it("keeps a lapsed offer on the list and does not treat it as the current offer", () => {
    const db = seeded();
    withDatabase(db, () => {
      listVehicleOffers("c6", "repairs");
      recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 800000,
        offeredOn: "2026-03-01",
        note: "",
      });
      const later = recordVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        amountPence: 920000,
        offeredOn: "2026-04-02",
        note: "Open until it expires",
      });
      const before = money(db, "c6", "repairs");
      markVehicleOffer({
        claimId: "c6",
        actorId: "staff-justin",
        head: "repairs",
        offerId: later,
        status: "lapsed",
      });
      const offers = listVehicleOffers("c6", "repairs");
      const after = money(db, "c6", "repairs");
      assert.equal(offers.length, 2);
      assert.equal(offers[0].id, later);
      assert.equal(offers[0].status, "lapsed");
      assert.equal(offers[0].amountPence, 920000);
      assert.equal(offers[1].status, "open");
      assert.equal(offers[1].amountPence, 800000);
      assert.equal(after.offered_pence, 800000);
      assert.notEqual(after.offered_pence, offers[0].amountPence);
      assert.equal(after.claimed_pence, before.claimed_pence);
      assert.equal(after.agreed_pence, before.agreed_pence);
      assert.equal(after.received_pence, before.received_pence);
      assert.equal(after.claimed_pence, 240000);
      assert.equal(after.agreed_pence, 0);
      assert.equal(after.received_pence, 0);
    });
    db.close();
  });
});

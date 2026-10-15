import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { addNote } from "../src/lib/db/queries.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { saveInsurerPaymentDetails } from "../src/lib/db/payment-details.ts";
import { recordAgreedHeadFigure, recordHeadPayment } from "../src/lib/db/payment-ledger.ts";
import {
  applyJobScreenFields,
  conflictSentence,
  jobActorId,
  screenVersion,
  sectionVersion,
  storeStorageEndProposal,
  VersionConflictError,
  withSectionSave,
} from "../src/lib/db/record-version.ts";
import { saveScreenData } from "../src/lib/db/screens.ts";
import { restartChaseClock, syncOutstandingPaymentChases } from "../src/lib/db/chase.ts";
import { seed } from "../src/lib/db/seed.ts";
import { formatUkDateTime } from "../src/lib/dates.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  migrate(db);
  return db;
}

function screenJson(db: DatabaseSync, claimId: string, screenKey: string) {
  const row = db
    .prepare(`SELECT data_json, updated_at, updated_by FROM claim_screen_data WHERE claim_id = ? AND screen_key = ?`)
    .get(claimId, screenKey) as { data_json: string; updated_at: string; updated_by: string | null } | undefined;
  return row;
}

function claimColumn(db: DatabaseSync, claimId: string, column: string) {
  const row = db.prepare(`SELECT ${column} AS value FROM claims WHERE id = ?`).get(claimId) as { value: string | null };
  return row.value;
}

describe("optimistic concurrency", () => {
  it("refuses a second save of the same screen and keeps the first person's fields", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const opened = screenVersion("c5", "client");
      const loaded = { forename: "Before", surname: "Before" };
      saveScreenData("c5", "client", { forename: "Pat", surname: "Before" }, "staff-justin", opened, loaded);
      const afterJustin = screenJson(db, "c5", "client");
      assert.ok(afterJustin);
      assert.equal(afterJustin.updated_by, "staff-justin");
      const saved = JSON.parse(afterJustin.data_json) as { forename?: string };
      assert.equal(saved.forename, "Pat");
      assert.throws(
        () =>
          saveScreenData(
            "c5",
            "client",
            { forename: "Pat", surname: "Evans" },
            "staff-sian",
            opened,
            { forename: "Before", surname: "Before" },
          ),
        (error: unknown) => {
          assert.ok(error instanceof VersionConflictError);
          assert.equal(error.actorName, "Justin Roberts");
          assert.equal(error.message, conflictSentence("Justin Roberts", error.changedAt));
          assert.match(error.message, /Justin Roberts changed this on \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} after you opened it\. Your changes have not been saved\./);
          assert.equal(formatUkDateTime(error.changedAt), error.message.slice("Justin Roberts changed this on ".length, error.message.indexOf(" after you opened it")));
          const forename = error.changedFields.find((field) => field.name === "forename");
          assert.ok(forename);
          assert.equal(forename.label, "Forename");
          assert.equal(forename.saved, "Pat");
          const surname = error.unsaved.find((field) => field.name === "surname");
          assert.ok(surname);
          assert.equal(surname.yours, "Evans");
          return true;
        },
      );
      const kept = screenJson(db, "c5", "client");
      assert.ok(kept);
      assert.equal((JSON.parse(kept.data_json) as { forename?: string }).forename, "Pat");
      assert.equal(kept.updated_at, afterJustin.updated_at);
    });
    db.close();
  });

  it("lets two people save different screens on the same claim", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const clientVersion = screenVersion("c5", "client");
      const storageVersion = screenVersion("c5", "storage");
      saveScreenData("c5", "client", { forename: "Pat" }, "staff-justin", clientVersion);
      saveScreenData("c5", "storage", { name: "Yard A" }, "staff-sian", storageVersion);
      const client = screenJson(db, "c5", "client");
      const storage = screenJson(db, "c5", "storage");
      assert.equal((JSON.parse(String(client?.data_json)) as { forename?: string }).forename, "Pat");
      assert.equal((JSON.parse(String(storage?.data_json)) as { name?: string }).name, "Yard A");
    });
    db.close();
  });

  it("saves two history notes added at the same time", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const before = db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE claim_id = 'c5'`).get() as { n: number };
      addNote("c5", "staff-justin", "Justin note");
      addNote("c5", "staff-sian", "Sian note");
      const rows = db.prepare(`SELECT body FROM notes WHERE claim_id = 'c5' AND body IN ('Justin note', 'Sian note')`).all() as Array<{
        body: string;
      }>;
      assert.equal(rows.length, 2);
      assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE claim_id = 'c5'`).get() as { n: number }).n), Number(before.n) + 2);
    });
    db.close();
  });

  it("does not let a chase overwrite staff fields, and names the chase when the same field moved", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c5'`).get();
      const storageEnd = claimColumn(db, "c5", "storage_billing_end_on");
      const opened = screenVersion("c5", "client");
      saveScreenData("c5", "client", { forename: "Pat", email: "pat@example.test" }, "staff-justin", opened);
      const savedJson = screenJson(db, "c5", "client")?.data_json;
      syncOutstandingPaymentChases(["c5"]);
      restartChaseClock("repair_payment", "c5", "2026-10-01T09:00:00.000Z");
      assert.equal(screenJson(db, "c5", "client")?.data_json, savedJson);
      assert.equal(claimColumn(db, "c5", "storage_billing_end_on"), storageEnd);
      const current = screenVersion("c5", "client");
      applyJobScreenFields({
        claimId: "c5",
        screenKey: "client",
        actorId: jobActorId("payment-chase"),
        fields: { email: "chase@example.test" },
      });
      assert.equal((JSON.parse(String(screenJson(db, "c5", "client")?.data_json)) as { forename?: string }).forename, "Pat");
      assert.throws(
        () => saveScreenData("c5", "client", { forename: "Other", email: "pat@example.test" }, "staff-sian", current),
        (error: unknown) => {
          assert.ok(error instanceof VersionConflictError);
          assert.equal(error.actorName, "Payment chase");
          assert.match(error.message, /Payment chase changed this on \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
          return true;
        },
      );
      assert.equal((JSON.parse(String(screenJson(db, "c5", "client")?.data_json)) as { forename?: string }).forename, "Pat");
      storeStorageEndProposal({ claimId: "c5", proposedOn: "2026-10-20", basis: "test" });
      assert.equal(claimColumn(db, "c5", "storage_billing_end_on"), storageEnd);
    });
    db.close();
  });

  it("records a double-clicked payment only once and keeps a second genuine payment", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c3'`).get();
      const before = db.prepare(`SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).get() as {
        received_pence: number;
      };
      const first = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-justin",
        head: "hire",
        amountPence: 1000,
        correction: false,
        submitKey: "pay-once",
      });
      const replay = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-sian",
        head: "hire",
        amountPence: 1000,
        correction: false,
        submitKey: "pay-once",
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.receivedPence, first.receivedPence);
      const afterOnce = db.prepare(`SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).get() as {
        received_pence: number;
      };
      assert.equal(Number(afterOnce.received_pence), Number(before.received_pence) + 1000);
      const second = recordHeadPayment({
        claimId: "c3",
        actorId: "staff-sian",
        head: "hire",
        amountPence: 1000,
        correction: false,
        submitKey: "pay-second",
        confirmSeparate: true,
      });
      assert.equal(second.allocated, true);
      const afterTwo = db.prepare(`SELECT received_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'hire'`).get() as {
        received_pence: number;
      };
      assert.equal(Number(afterTwo.received_pence), Number(before.received_pence) + 2000);
    });
    db.close();
  });

  it("refuses a missing or forged version on the server, and allows a save when nothing changed", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c4'`).get();
      const opened = screenVersion("c4", "client");
      saveScreenData("c4", "client", { forename: "Same" }, "staff-justin", opened);
      const current = screenVersion("c4", "client");
      saveScreenData("c4", "client", { forename: "Same" }, "staff-sian", current);
      assert.equal((JSON.parse(String(screenJson(db, "c4", "client")?.data_json)) as { forename?: string }).forename, "Same");
      assert.throws(
        () => saveScreenData("c4", "client", { forename: "Forged" }, "staff-sian", ""),
        /have not been saved/,
      );
      assert.throws(
        () => saveScreenData("c4", "client", { forename: "Forged" }, "staff-sian", "forged-version"),
        /have not been saved/,
      );
      assert.equal((JSON.parse(String(screenJson(db, "c4", "client")?.data_json)) as { forename?: string }).forename, "Same");
    });
    db.close();
  });

  it("refuses a stale bank-details version and still refuses someone without manageBankDetails", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT key FROM settings LIMIT 1`).get();
      const opened = sectionVersion("bank-details", "office");
      const fictional = { accountName: "Fictional", sortCode: "000000", accountNumber: "00000000" };
      withSectionSave({
        scope: "bank-details",
        recordKey: "office",
        expected: opened,
        actorId: "staff-justin",
        submitted: fictional,
        fields: { accountName: "Fictional", sortCode: "000000", accountNumber: "00000000" },
        write: () => saveInsurerPaymentDetails(fictional, { staffId: "staff-justin", role: "administrator" }),
      });
      const stored = db.prepare(`SELECT value FROM settings WHERE key = 'insurer_payment_account_name'`).get() as { value: string };
      assert.equal(stored.value, "Fictional");
      assert.throws(
        () =>
          withSectionSave({
            scope: "bank-details",
            recordKey: "office",
            expected: opened,
            actorId: "staff-justin",
            submitted: { accountName: "Other", sortCode: "000000", accountNumber: "00000000" },
            fields: { accountName: "Other", sortCode: "000000", accountNumber: "00000000" },
            write: () =>
              saveInsurerPaymentDetails(
                { accountName: "Other", sortCode: "000000", accountNumber: "00000000" },
                { staffId: "staff-justin", role: "administrator" },
              ),
          }),
        (error: unknown) => {
          assert.ok(error instanceof VersionConflictError);
          assert.equal(error.actorName, "Justin Roberts");
          return true;
        },
      );
      const still = db.prepare(`SELECT value FROM settings WHERE key = 'insurer_payment_account_name'`).get() as { value: string };
      assert.equal(still.value, "Fictional");
      const current = sectionVersion("bank-details", "office");
      assert.throws(
        () =>
          withSectionSave({
            scope: "bank-details",
            recordKey: "office",
            expected: current,
            actorId: "staff-sian",
            submitted: fictional,
            fields: fictional,
            write: () => saveInsurerPaymentDetails(fictional, { staffId: "staff-sian", role: "staff" }),
          }),
        /cannot change the bank details/,
      );
    });
    db.close();
  });

  it("records one agreed figure for a repeated key and another when the key is new", () => {
    const db = seeded();
    withDatabase(db, () => {
      db.prepare(`SELECT id FROM claims WHERE id = 'c3'`).get();
      recordAgreedHeadFigure({
        submitKey: "agreed-once",
        claimId: "c3",
        actorId: "staff-justin",
        head: "storage",
        agreedPence: 23400,
        expectedVersion: "",
      });
      const version = sectionVersion("money", "c3:storage");
      recordAgreedHeadFigure({
        submitKey: "agreed-once",
        claimId: "c3",
        actorId: "staff-sian",
        head: "storage",
        agreedPence: 23400,
        expectedVersion: version,
      });
      const once = db
        .prepare(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c3' AND event_type = 'head_agreed_recorded' AND details LIKE '%head=storage%'`)
        .get() as { n: number };
      assert.equal(Number(once.n), 1);
      recordAgreedHeadFigure({
        submitKey: "agreed-again",
        claimId: "c3",
        actorId: "staff-sian",
        head: "storage",
        agreedPence: 23400,
        expectedVersion: version,
      });
      const twice = db
        .prepare(`SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = 'c3' AND event_type = 'head_agreed_recorded' AND details LIKE '%head=storage%'`)
        .get() as { n: number };
      assert.equal(Number(twice.n), 2);
      const line = db.prepare(`SELECT agreed_pence FROM financial_lines WHERE claim_id = 'c3' AND head_of_loss = 'storage'`).get() as {
        agreed_pence: number;
      };
      assert.equal(Number(line.agreed_pence), 23400);
    });
    db.close();
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { listAgedDebt } from "../src/lib/db/aged-debt.ts";
import { pauseChase, startChase } from "../src/lib/db/chase.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { produceDraftInvoice } from "../src/lib/db/draft-invoice.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { chaseSendRefusal, setSendingHours } from "../src/lib/db/sending-hours.ts";
import { isoDateFromNow, isoDaysFromNow, londonTodayIso } from "../src/lib/dates.ts";
import { agedDebtBand } from "../src/lib/domain/aged-debt.ts";
import { chaseClockDecision, chaseDefinition } from "../src/lib/domain/chase.ts";
import { DEFAULT_SENDING_HOURS, insideSendingHours, parseSendingHours } from "../src/lib/domain/sending-hours.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

describe("chaser sending hours and the check before each send (J6)", () => {
  it("sends only inside the sending hours, in UK time", () => {
    const hours = DEFAULT_SENDING_HOURS;
    assert.equal(insideSendingHours(new Date("2026-10-26T10:00:00Z"), hours), true); // Monday 10:00 GMT
    assert.equal(insideSendingHours(new Date("2026-10-26T08:59:00Z"), hours), false);
    assert.equal(insideSendingHours(new Date("2026-10-26T17:00:00Z"), hours), false);
    assert.equal(insideSendingHours(new Date("2026-10-24T11:00:00Z"), hours), false); // Saturday
    assert.equal(insideSendingHours(new Date("2026-07-06T16:30:00Z"), hours), false); // Monday 17:30 BST
    assert.deepEqual(parseSendingHours("nonsense"), DEFAULT_SENDING_HOURS);
    assert.deepEqual(parseSendingHours("1,3 08:00-12:00"), { days: [1, 3], start: "08:00", end: "12:00" });
  });

  it("refuses a real chase send outside the hours, and any chase that is paused, whatever the mode", () => {
    const db = prepared();
    withDatabase(db, () => {
      const template = chaseDefinition("liability_response").templateKey;
      const sent = isoDaysFromNow(-10, 9, 0);
      run(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES ('t-c2-letter', 'c2', 'initial_letter_tp_insurer', 'Letter', 'Marked as sent by Sian Evans.', ?, ?, 'staff-sian', 'staff')`,
        [sent, sent],
      );
      startChase("liability_response", "c2", sent);
      setSendingHours(["1", "2", "3", "4", "5"], "09:00", "17:00");
      assert.match(String(chaseSendRefusal({ claimId: "c2", templateKey: template, live: true, at: new Date("2026-10-24T11:00:00Z") })), /Nothing was sent/);
      assert.equal(chaseSendRefusal({ claimId: "c2", templateKey: template, live: false, at: new Date("2026-10-24T11:00:00Z") }), null);
      assert.equal(chaseSendRefusal({ claimId: "c2", templateKey: template, live: true, at: new Date("2026-10-26T10:00:00Z") }), null);
      pauseChase("liability_response", "c2", "Waiting for the client");
      assert.match(String(chaseSendRefusal({ claimId: "c2", templateKey: template, live: false })), /paused/i);
      assert.equal(chaseSendRefusal({ claimId: "c2", templateKey: "client_welcome", live: true, at: new Date("2026-10-24T11:00:00Z") }), null);
    });
    db.close();
  });

  it("owes one chase however long it has been due, so an outage leaves no backlog", () => {
    const base = {
      startedAt: "2026-08-01T09:00:00.000Z",
      outcomeAt: null,
      outcomeClearedAt: null,
      handlerState: "tracking" as const,
      intervalDays: 3,
      dueLabel: "Chase due",
      notStartedReason: "Not started",
      outcomeOnFileReason: "Reply on file",
    };
    const longOverdue = chaseClockDecision({ ...base, lastChaseSentAt: null, asAt: "2026-10-28T10:00:00.000Z" });
    assert.equal(longOverdue.due, true);
    assert.equal(longOverdue.dueAt, "2026-08-04T09:00:00.000Z");
    const afterOneSend = chaseClockDecision({ ...base, lastChaseSentAt: "2026-10-28T10:00:00.000Z", asAt: "2026-10-28T10:05:00.000Z" });
    assert.equal(afterOneSend.due, false);
  });
});

describe("aged debt and draft invoices (J6)", () => {
  it("bands money still owed by days since the payment request, and does not count an offer", () => {
    assert.equal(agedDebtBand(null), "Not requested yet");
    assert.equal(agedDebtBand(30), "0–30 days");
    assert.equal(agedDebtBand(31), "31–60 days");
    assert.equal(agedDebtBand(91), "Over 90 days");
    const db = prepared();
    withDatabase(db, () => {
      run(`UPDATE financial_lines SET agreed_pence = 1000000, received_pence = 200000, offered_pence = 900000 WHERE id = 'f-c9-vd'`);
      const at = isoDaysFromNow(-45, 10, 0);
      run(
        `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, actor_id, source)
         VALUES ('t-c9-req', 'c9', 'settlement_payment_request_sent', 'Request', 'For the test.', ?, ?, 'staff-sian', 'staff')`,
        [at, at],
      );
      const { rows, totals } = listAgedDebt(londonTodayIso());
      const row = rows.find((item) => item.claimId === "c9" && item.head === "vehicle_damage");
      assert.ok(row, "TEST-0009 vehicle damage should be owed");
      assert.equal(row.outstandingPence, 800000);
      assert.equal(row.band, "31–60 days");
      assert.ok(totals["31–60 days"] >= 800000);
    });
    db.close();
  });

  it("builds a draft invoice from the head's figures with quantity, net, VAT and gross, filed and not sent", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const form = new FormData();
      form.set("client_forename", "Iwan");
      form.set("client_surname", "Invoice");
      form.set("client_mobile", "07700900321");
      form.set("handlerId", "staff-sian");
      form.set("accidentDate", isoDateFromNow(-2));
      form.set("accidentTime", "08:00");
      form.set("claimType", "non_fault");
      form.set("roadworthiness", "unroadworthy");
      form.set("needsRecovery", "yes");
      form.set("recoveryFormVersion", "fees");
      form.set("recoveryLocation", "A470, Pontypridd");
      form.set("recoveryTick_standard", "yes");
      form.set("recoveryAmount_standard", "395");
      form.set("recoveryDate", isoDateFromNow(-2));
      form.set("recoveryTime", "10:00");
      const claim = await createClaimFromIntake(intakeFromFormData(form));
      assert.throws(() => produceDraftInvoice({ claimId: claim.id, head: "hire", actorId: "staff-sian" }), /no hire charge/);
      const made = produceDraftInvoice({ claimId: claim.id, head: "recovery", actorId: "staff-sian" });
      assert.equal(made.grossPence, 47400);
      const doc = get<{ body_html: string; title: string }>(`SELECT body_html, title FROM documents WHERE id = ?`, [made.documentId]);
      assert.equal(doc?.title, "Draft invoice — Recovery");
      assert.match(String(doc?.body_html), /£395\.00/);
      assert.match(String(doc?.body_html), /£79\.00/);
      assert.match(String(doc?.body_html), /£474\.00/);
      assert.match(String(doc?.body_html), /Not sent/);
      assert.equal(get(`SELECT id FROM correspondence WHERE claim_id = ?`, [claim.id]), undefined);
    });
    db.close();
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { londonTodayIso } from "../src/lib/dates.ts";
import { getClaimDraft, draftPayload } from "../src/lib/db/claim-drafts.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { eraseWebsiteEnquiry, searchPersonEnquiries } from "../src/lib/db/person-data.ts";
import { approveDeletionBatch, computeDueList, listDeletionLog } from "../src/lib/db/retention.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  checkEnquiry,
  closeEnquiry,
  enquiryCounts,
  enquiryForDraft,
  getEnquiry,
  isAllowedWebsiteOrigin,
  listOpenEnquiries,
  PER_ADDRESS_PER_HOUR,
  receiveWebsiteEnquiry,
  reopenEnquiry,
  saveWebsiteOrigins,
  savedWebsiteOrigins,
  startClaimFromEnquiry,
} from "../src/lib/db/website-enquiries.ts";
import { POST, OPTIONS } from "../src/app/website/enquiry/route.ts";

process.env.EMAIL_SEND_MODE = "simulate";
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function daysAgo(days: number): string {
  const date = new Date(`${londonTodayIso()}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const good = () => ({
  name: "Bethan Price",
  mobile: "07700 900456",
  registration: "cf21 xyz",
  accidentDate: daysAgo(2),
  fault: "theirs",
  driveable: "no",
  whatHappened: "Hit from behind at the lights on Cowbridge Road.",
  privacyConsent: "yes",
});

function counts(db: DatabaseSync) {
  const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
  return {
    claims: n(`SELECT COUNT(*) AS n FROM claims`),
    events: n(`SELECT COUNT(*) AS n FROM claim_events`),
    messages: n(`SELECT COUNT(*) AS n FROM correspondence`),
    drafts: n(`SELECT COUNT(*) AS n FROM claim_drafts`),
    people: n(`SELECT COUNT(*) AS n FROM people`),
  };
}

function setNodeEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

describe("J16 website enquiries", () => {
  it("accepts a good enquiry and tidies what was typed", () => {
    const result = checkEnquiry(good());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.mobile, "07700 900456");
    assert.equal(result.value.registration, "CF21 XYZ");
    assert.equal(result.value.fault, "theirs");
    const plus = checkEnquiry({ ...good(), mobile: "+44 7700 900456", registration: "abc1234" });
    assert.equal(plus.ok && plus.value.mobile, "07700 900456");
    assert.equal(plus.ok && plus.value.registration, "ABC1234");
  });

  it("refuses wrong, missing, oversized and non-text values, one message per box", () => {
    const today = londonTodayIso();
    const tomorrow = new Date(`${today}T12:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const bad = checkEnquiry({
      name: "<script>alert(1)</script>",
      mobile: "0161 496 0000",
      registration: "!!",
      accidentDate: tomorrow.toISOString().slice(0, 10),
      fault: "someone",
      driveable: "maybe",
      whatHappened: "x".repeat(1001),
      privacyConsent: "",
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.deepEqual(Object.keys(bad.errors).sort(), ["accidentDate", "driveable", "fault", "mobile", "name", "privacyConsent", "registration", "whatHappened"]);
    assert.match(bad.errors.accidentDate, /future/);
    const old = checkEnquiry({ ...good(), accidentDate: "2015-01-01" });
    assert.match(!old.ok ? old.errors.accidentDate : "", /six years/);
    const notADate = checkEnquiry({ ...good(), accidentDate: "2026-02-30" });
    assert.match(!notADate.ok ? notADate.errors.accidentDate : "", /real date/);
    const notText = checkEnquiry({ ...good(), name: ["Bethan"] as unknown as string });
    assert.equal(notText.ok, false);
    const empty = checkEnquiry({});
    assert.equal(!empty.ok && Object.keys(empty.errors).length >= 7, true);
  });

  it("stores an enquiry without creating a claim, a person, a message, a history entry or a draft", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        // The first use of a database runs its one-off repairs, which may add history entries of their own.
        enquiryCounts();
        const before = counts(db);
        const result = receiveWebsiteEnquiry({ raw: good(), address: "203.0.113.10", origin: "http://localhost:4000" });
        assert.equal(result.outcome, "stored");
        assert.deepEqual(counts(db), before);
        const stored = result.outcome === "stored" ? getEnquiry(result.id)! : undefined;
        assert.equal(stored?.reference, "WEB-0001");
        assert.equal(stored?.statusLabel, "Needs a call");
        assert.equal(stored?.urgent, true);
        assert.match(String(stored?.consent_at), /^\d{4}-\d{2}-\d{2}T/);
        assert.match(String(stored?.consent_notice), /awaiting approved wording/);
        assert.deepEqual(enquiryCounts(), { needsCall: 1, urgent: 1 });
        // The internet address itself is never stored.
        assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM website_enquiry_hits WHERE address_hash LIKE '%203.0.113%'`)?.n), 0);
      });
    } finally {
      db.close();
    }
  });

  it("keeps nothing when the hidden spam trap is filled in", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        const result = receiveWebsiteEnquiry({ raw: { ...good(), website: "http://spam.example" }, address: "203.0.113.11", origin: null });
        assert.equal(result.outcome, "spam");
        assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM website_enquiries`)?.n), 0);
      });
    } finally {
      db.close();
    }
  });

  it("limits posts from one address, counting refused ones too, without blocking anyone else", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        for (let i = 0; i < PER_ADDRESS_PER_HOUR; i += 1) {
          const raw = i % 2 ? { ...good(), mobile: "nope" } : good();
          assert.notEqual(receiveWebsiteEnquiry({ raw, address: "198.51.100.7", origin: null }).outcome, "limited");
        }
        assert.equal(receiveWebsiteEnquiry({ raw: good(), address: "198.51.100.7", origin: null }).outcome, "limited");
        assert.equal(receiveWebsiteEnquiry({ raw: good(), address: "198.51.100.8", origin: null }).outcome, "stored");
        // An hour later the address may post again.
        const later = new Date(Date.now() + 61 * 60_000).toISOString();
        assert.equal(receiveWebsiteEnquiry({ raw: good(), address: "198.51.100.7", origin: null, nowIso: later }).outcome, "stored");
      });
    } finally {
      db.close();
    }
  });

  it("converts to a claim only when staff save the pre-filled form, and records the privacy tick on the history", async () => {
    const db = prepared();
    try {
      await withDatabaseAsync(db, async () => {
        const received = receiveWebsiteEnquiry({ raw: good(), address: "203.0.113.20", origin: "http://localhost:4000" });
        assert.equal(received.outcome, "stored");
        const enquiryId = received.outcome === "stored" ? received.id : "";
        const claimsBefore = counts(db).claims;
        assert.throws(() => startClaimFromEnquiry({ enquiryId, actorId: "staff-driver", actorRole: "driver" }), /office staff/);
        const draftId = startClaimFromEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff" });
        assert.equal(startClaimFromEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff" }), draftId, "a second click reopens the same draft");
        assert.equal(counts(db).claims, claimsBefore, "converting opens a form; it does not make a claim");
        assert.equal(getEnquiry(enquiryId)?.statusLabel, "Claim being set up");
        assert.equal(enquiryForDraft(draftId)?.id, enquiryId);

        const fields = draftPayload(getClaimDraft(draftId));
        assert.equal(fields.client_forename, "Bethan");
        assert.equal(fields.client_surname, "Price");
        assert.equal(fields.client_mobile, "07700 900456");
        assert.equal(fields.veh_registration, "CF21 XYZ");
        assert.equal(fields.accidentDate, daysAgo(2));
        assert.equal(fields.claimType, "non_fault");
        assert.equal(fields.roadworthiness, "unroadworthy");
        assert.equal(fields.circumstances, "Hit from behind at the lights on Cowbridge Road.");

        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        form.set("handlerId", "staff-sian");
        form.set("accidentTime", "09:15");
        form.set("draftId", draftId);
        const created = await createClaimFromIntake(intakeFromFormData(form));
        const after = getEnquiry(enquiryId)!;
        assert.equal(after.status, "converted");
        assert.equal(after.claim_id, created.id);
        assert.equal(listOpenEnquiries().length, 0);
        const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = ? AND details LIKE 'Opened from website enquiry%'`, [created.id]);
        assert.match(String(event?.details), /WEB-0001.*privacy notice box/);
        assert.throws(() => closeEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff", reason: "late" }), /already closed/);
      });
    } finally {
      db.close();
    }
  });

  it("closes as not proceeding only with a reason, puts away its half-made claim, and can be reopened", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        const received = receiveWebsiteEnquiry({ raw: { ...good(), driveable: "yes" }, address: "203.0.113.30", origin: null });
        const enquiryId = received.outcome === "stored" ? received.id : "";
        const draftId = startClaimFromEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff" });
        assert.throws(() => closeEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff", reason: "  " }), /reason/);
        closeEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff", reason: "Already claiming through own insurer" });
        assert.equal(getEnquiry(enquiryId)?.statusLabel, "Not proceeding");
        assert.ok(getClaimDraft(draftId)?.discarded_at, "the draft from the enquiry is put away");
        reopenEnquiry({ enquiryId, actorId: "staff-sian", actorRole: "staff" });
        assert.equal(getEnquiry(enquiryId)?.statusLabel, "Needs a call");
      });
    } finally {
      db.close();
    }
  });

  it("lists enquiries that never became claims for deletion after 12 months, and deletes them only on approval", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        const old = receiveWebsiteEnquiry({ raw: good(), address: "203.0.113.40", origin: null });
        const recent = receiveWebsiteEnquiry({ raw: good(), address: "203.0.113.41", origin: null });
        const oldId = old.outcome === "stored" ? old.id : "";
        const recentId = recent.outcome === "stored" ? recent.id : "";
        run(`UPDATE website_enquiries SET received_at = ? WHERE id = ?`, [`${daysAgo(400)}T10:00:00.000Z`, oldId]);
        const due = computeDueList().filter((item) => item.kind === "website_enquiry");
        assert.deepEqual(due.map((item) => item.targetId), [oldId]);
        assert.ok(getEnquiry(oldId), "nothing is deleted until approved");
        approveDeletionBatch({ actorId: "staff-justin", itemIds: due.map((item) => item.id), reason: "Past its retention period" });
        assert.equal(getEnquiry(oldId), undefined);
        assert.ok(getEnquiry(recentId));
        assert.ok(listDeletionLog().some((entry) => entry.kind === "website_enquiry" && /WEB-0001/.test(String(entry.file_reference))));
      });
    } finally {
      db.close();
    }
  });

  it("finds an enquiry on the person's data screen and erases it there", () => {
    const db = prepared();
    try {
      withDatabase(db, () => {
        const received = receiveWebsiteEnquiry({ raw: good(), address: "203.0.113.50", origin: null });
        const enquiryId = received.outcome === "stored" ? received.id : "";
        assert.equal(searchPersonEnquiries({ actorId: "staff-justin", query: "07700900456" })[0]?.id, enquiryId);
        assert.equal(searchPersonEnquiries({ actorId: "staff-justin", query: "cf21xyz" })[0]?.id, enquiryId);
        assert.throws(() => searchPersonEnquiries({ actorId: "staff-sian", query: "Bethan" }), /Only Justin/);
        eraseWebsiteEnquiry({ actorId: "staff-justin", enquiryId, reason: "Asked us to delete it" });
        assert.equal(getEnquiry(enquiryId), undefined);
      });
    } finally {
      db.close();
    }
  });

  it("accepts posts only from the local website in development, and only from the saved address when live", () => {
    const db = prepared();
    const was = process.env.NODE_ENV;
    try {
      withDatabase(db, () => {
        setNodeEnv("development");
        assert.equal(isAllowedWebsiteOrigin("http://localhost:4000"), true);
        assert.equal(isAllowedWebsiteOrigin("https://evil.example"), false);
        assert.equal(isAllowedWebsiteOrigin(null), false);
        assert.throws(() => saveWebsiteOrigins({ actorRole: "staff", value: "https://www.example.co.uk" }), /administrator/);
        assert.throws(() => saveWebsiteOrigins({ actorRole: "administrator", value: "http://www.example.co.uk" }), /https/);
        saveWebsiteOrigins({ actorRole: "administrator", value: "https://www.example.co.uk/start-your-claim" });
        assert.deepEqual(savedWebsiteOrigins(), ["https://www.example.co.uk"]);
        assert.equal(isAllowedWebsiteOrigin("https://www.example.co.uk"), false, "in development only the local website");
        setNodeEnv("production");
        assert.equal(isAllowedWebsiteOrigin("https://www.example.co.uk"), true);
        assert.equal(isAllowedWebsiteOrigin("http://localhost:4000"), false);
      });
    } finally {
      setNodeEnv(was);
      db.close();
    }
  });

  it("answers the website: JSON for a script, a redirect for a plain form, 403 for another site, no files", async () => {
    const db = prepared();
    const was = process.env.NODE_ENV;
    try {
      setNodeEnv("development");
      await withDatabaseAsync(db, async () => {
        const url = "http://localhost:3000/website/enquiry";
        const post = (headers: Record<string, string>, body: string) => POST(new Request(url, { method: "POST", headers, body }));

        const preflight = await OPTIONS(new Request(url, { method: "OPTIONS", headers: { origin: "http://localhost:4000" } }));
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:4000");
        assert.equal((await OPTIONS(new Request(url, { method: "OPTIONS", headers: { origin: "https://evil.example" } }))).status, 403);

        const stored = await post({ origin: "http://localhost:4000", "content-type": "application/json", "x-forwarded-for": "192.0.2.1" }, JSON.stringify(good()));
        assert.equal(stored.status, 201);
        assert.deepEqual(await stored.json(), { ok: true, reference: "WEB-0001" });
        assert.equal(stored.headers.get("access-control-allow-origin"), "http://localhost:4000");

        const invalid = await post({ origin: "http://localhost:4000", "content-type": "application/json", "x-forwarded-for": "192.0.2.1" }, JSON.stringify({ ...good(), mobile: "123" }));
        assert.equal(invalid.status, 400);
        assert.match(String(((await invalid.json()) as { errors: Record<string, string> }).errors.mobile), /UK mobile/);

        const plain = await post(
          { origin: "http://localhost:4000", "content-type": "application/x-www-form-urlencoded", "sec-fetch-mode": "navigate", "x-forwarded-for": "192.0.2.2" },
          new URLSearchParams(good()).toString(),
        );
        assert.equal(plain.status, 303);
        assert.equal(plain.headers.get("location"), "http://localhost:4000/thank-you.html?ref=WEB-0002");

        const elsewhere = await post({ origin: "https://evil.example", "content-type": "application/json" }, JSON.stringify(good()));
        assert.equal(elsewhere.status, 403);
        assert.equal(elsewhere.headers.get("access-control-allow-origin"), null);
        const noOrigin = await post({ "content-type": "application/json" }, JSON.stringify(good()));
        assert.equal(noOrigin.status, 403);

        const file = await post({ origin: "http://localhost:4000", "content-type": "multipart/form-data; boundary=x" }, "--x--");
        assert.equal(file.status, 415);
        const huge = await post({ origin: "http://localhost:4000", "content-type": "application/json" }, JSON.stringify({ ...good(), whatHappened: "x".repeat(9000) }));
        assert.equal(huge.status, 400);
        assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM website_enquiries`)?.n), 2);
      });
    } finally {
      setNodeEnv(was);
      db.close();
    }
  });
});

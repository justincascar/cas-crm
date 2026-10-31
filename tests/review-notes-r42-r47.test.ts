import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { generateNonFaultTpInsurerLetter } from "../src/lib/documents/notification-letters.ts";
import { CAS_TEMPLATE_NOTICE, emptyCorrespondenceFields } from "../src/lib/documents/correspondence.ts";
import { forSending, withDraftInvoiceHeading, withoutScreenNotices, withoutScreenNoticesText } from "../src/lib/documents/screen-notices.ts";
import { removeScreenNoticesFromStoredLetters } from "../src/lib/db/screen-notice-repair.ts";
import { agreementDocumentState, agreementStateLabel } from "../src/lib/db/agreement-state.ts";
import { documentKindLabel } from "../src/lib/documents/kind-label.ts";
import { paymentText, type ClaimPaymentLineInput } from "../src/lib/domain/claim-steps.ts";
import { chaserWordingPreviews } from "../src/lib/db/auto-chasers.ts";
import { completeChallenge, readChallenge, startChallenge, twoStepEnabled } from "../src/lib/auth/login-security.ts";
import { totpCode } from "../src/lib/auth/totp.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-r42-"));
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const oldNoticeHtml = `<div class="letter"><p>Dear Sirs</p>\n<p>Yours faithfully,</p>\n<p class="text-xs">${CAS_TEMPLATE_NOTICE.replace(/'/g, "&#39;")}</p></div>`;

function claimId(db: DatabaseSync, ref: string): string {
  return String((db.prepare(`SELECT id FROM claims WHERE file_reference = ?`).get(ref) as { id: string }).id);
}

describe("R42: the prototype line never prints or goes out", () => {
  it("is not in a new letter or its text", () => {
    const letter = generateNonFaultTpInsurerLetter({
      ...emptyCorrespondenceFields(),
      fileReference: "TEST-0040",
      clientName: "Mr Gethin Prawf",
      handlerName: "Sian Evans",
      accidentAt: "2026-10-30T09:00:00.000Z",
      accidentLocation: "Ammanford",
      circumstances: "Hit in the rear.",
      registration: "TE57 ABC",
      make: "Ford",
      model: "Focus",
      tpInsurer: "Example Insurance",
      tpPolicyOrClaimRef: "EX-1",
      ownInsurer: "",
      ownPolicyRef: "",
      dates: {},
      letterDate: "2026-10-31T09:00:00.000Z",
    });
    assert.doesNotMatch(letter.html, /not a signed original|Live sending is not connected/);
    assert.doesNotMatch(letter.text, /not a signed original|Live sending is not connected/);
  });

  it("is taken out of a letter stored before R42 when shown, sent or printed", () => {
    assert.doesNotMatch(withoutScreenNotices(oldNoticeHtml), /not a signed original/);
    assert.match(withoutScreenNotices(oldNoticeHtml), /Yours faithfully/);
    assert.equal(withoutScreenNoticesText(`Yours faithfully,\n\nSian\n\n${CAS_TEMPLATE_NOTICE}`), "Yours faithfully,\n\nSian");
    const withNote = `<div class="letter"><p class="internal-note">Draft invoice. Not sent.</p><h2>Draft invoice — Recovery</h2></div>`;
    assert.doesNotMatch(forSending(withNote), /internal-note|Not sent/);
    assert.match(forSending(withNote), /Draft invoice — Recovery/);
    // An invoice made before R42 had its draft wording only in the note for staff: it still prints as a draft.
    assert.equal(withDraftInvoiceHeading("<h2>Invoice — Recovery</h2>", "draft_invoice_recovery"), "<h2>Draft invoice — Recovery</h2>");
    assert.equal(forSending('<p class="internal-note">Draft.</p><h2>Invoice — Storage</h2>', "draft_invoice_storage"), "<h2>Draft invoice — Storage</h2>");
    assert.equal(withDraftInvoiceHeading("<h2>Invoice — Recovery</h2>", "initial_tp_insurer"), "<h2>Invoice — Recovery</h2>");
  });

  it("is removed from unsigned stored letters and prepared emails, never from a signed document", () => {
    const db = prepared();
    withDatabase(db, () => {
      const id = claimId(db, "TEST-0001");
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, created_at) VALUES ('doc_r42_a', ?, 'Letter', 'letter', 1, 0, 1, ?, ?)`).run(id, oldNoticeHtml, now);
      db.prepare(`INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, created_at) VALUES ('doc_r42_b', ?, 'Signed', 'letter', 1, 1, 1, ?, ?)`).run(id, oldNoticeHtml, now);
      db.prepare(
        `INSERT INTO correspondence(id, claim_id, direction, channel, subject, preview, body, to_address, from_address, unread, sent_status, created_at)
         VALUES ('corr_r42', ?, 'outgoing', 'email', 'Chase', '', ?, 'insurer@example.com', 'claims@example.com', 0, 'prepared_not_sent', ?)`,
      ).run(id, `Dear Sirs\n\nYours faithfully,\nSian\n\n${CAS_TEMPLATE_NOTICE}`, now);
      removeScreenNoticesFromStoredLetters(db);
      assert.doesNotMatch(String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = 'doc_r42_a'`)?.body_html), /not a signed original/);
      assert.match(String(get<{ body_html: string }>(`SELECT body_html FROM documents WHERE id = 'doc_r42_b'`)?.body_html), /not a signed original/);
      assert.doesNotMatch(String(get<{ body: string }>(`SELECT body FROM correspondence WHERE id = 'corr_r42'`)?.body), /not a signed original/);
    });
  });
});

describe("R43: produced agreements show as signed or replaced", () => {
  it("calls an earlier agreement replaced and one with a signed copy signed", () => {
    const db = prepared();
    withDatabase(db, () => {
      const id = claimId(db, "TEST-0001");
      const insert = (docId: string, at: string, key: string | null, type: string | null) =>
        db
          .prepare(`INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, body_html, template_key, created_at) VALUES (?, ?, 'Agreement', 'agreement', ?, 1, 0, 0, '<p>x</p>', ?, ?)`)
          .run(docId, id, type, key, at);
      insert("doc_r43_v1", "2026-10-31T09:00:00.000Z", "hire_agreement", null);
      insert("doc_r43_v2", "2026-10-31T10:00:00.000Z", "hire_agreement", null);
      const state = (docId: string, at: string) => agreementDocumentState({ id: docId, claim_id: id, template_key: "hire_agreement", created_at: at });
      assert.equal(state("doc_r43_v1", "2026-10-31T09:00:00.000Z"), "replaced");
      assert.equal(state("doc_r43_v2", "2026-10-31T10:00:00.000Z"), null);
      insert("doc_r43_signed", "2026-10-31T11:00:00.000Z", null, "signed_hire_agreement");
      assert.equal(state("doc_r43_v2", "2026-10-31T10:00:00.000Z"), "signed");
      assert.equal(state("doc_r43_v1", "2026-10-31T09:00:00.000Z"), "replaced");
      assert.equal(agreementStateLabel("signed"), "Signed – see signed copy");
      assert.equal(agreementStateLabel("replaced"), "Replaced");
    });
  });
});

describe("R44: step 10 matches the money", () => {
  const base: ClaimPaymentLineInput = {
    key: "recovery",
    label: "Recovery",
    endConfirmed: null,
    chargeRecorded: true,
    requestSent: false,
    intervalDays: null,
    receivedPence: 0,
    paidInFull: false,
    partPaid: false,
  };
  it("says paid in full with the date once the money received meets the figure", () => {
    assert.equal(paymentText({ ...base, receivedPence: 47400, duePence: 47400, lastPaymentDay: "2026-10-31T10:49:34.245Z" }), "Paid in full 31/10/2026");
    assert.equal(paymentText({ ...base }), "Figure final. No payment request recorded.");
  });
  it("shows the claimed repair estimate awaiting authorisation", () => {
    assert.equal(paymentText({ ...base, key: "repairs", label: "Repairs", claimedPence: 150000 }), "Claimed £1,500.00 · awaiting authorisation");
    assert.equal(paymentText({ ...base, key: "repairs", label: "Repairs", claimedPence: 150000, repairsAuthorised: true }), "Claimed £1,500.00 · authorised, awaiting payment");
  });
  it("says a running charge includes VAT", () => {
    const text = paymentText({ ...base, key: "hire", label: "Hire", endConfirmed: false, running: { sinceDay: "2026-10-31", soFarPence: 9360, invoiced: false } });
    assert.equal(text, "Running since 31/10/2026 · £93.60 so far, including VAT · not yet invoiced");
  });
});

describe("R45: plain words for document kinds", () => {
  it("never shows a stored code", () => {
    assert.equal(documentKindLabel({ kind: "agreement", template_key: "hire_agreement", document_type: "hire_agreement" }), "Hire agreement");
    assert.equal(documentKindLabel({ kind: "letter", template_key: "initial_tp_insurer" }), "Letter");
    assert.equal(documentKindLabel({ kind: "file", template_key: "draft_invoice_recovery" }), "Invoice (draft)");
    assert.equal(documentKindLabel({ kind: "engineer_report" }), "Engineer's report");
  });
});

describe("R46: Justin can read each chaser's wording", () => {
  it("shows the exact wording on a TEST file without filing or sending anything", () => {
    const db = prepared();
    withDatabase(db, () => {
      const count = () => Number((db.prepare(`SELECT COUNT(*) AS n FROM correspondence`).get() as { n: number }).n);
      const events = () => Number((db.prepare(`SELECT COUNT(*) AS n FROM claim_events`).get() as { n: number }).n);
      chaserWordingPreviews(); // the first use of the database runs its one-off start-up tidy of the demonstration data
      const before = [count(), events()];
      const { previews } = chaserWordingPreviews();
      assert.deepEqual([count(), events()], before);
      assert.ok(previews.length >= 8);
      // Every chaser has wording to read: an example on a TEST file, or (payment chasers) a labelled illustration.
      assert.deepEqual(previews.filter((preview) => !preview.body).map((preview) => preview.kind), [], "every chaser has wording to read");
      assert.ok(previews.some((preview) => preview.fileReference), "at least one chaser has an example on a TEST file");
      for (const preview of previews) {
        if (preview.fileReference) assert.match(preview.fileReference, /^TEST-/);
        else assert.match(String(preview.note), /^Illustration with example figures/);
        assert.doesNotMatch(String(preview.body), /not a signed original/);
      }
    });
  });
});

describe("R47: authenticator set-up", () => {
  it("makes a new key each time set-up starts and never accepts a code from an old key", () => {
    const db = prepared();
    withDatabase(db, () => {
      const justin = String((db.prepare(`SELECT id FROM staff WHERE username = 'justin'`).get() as { id: string }).id);
      db.prepare(`UPDATE staff SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?`).run(justin);
      const first = startChallenge({ staffId: justin, kind: "setup", nextPath: "/" });
      const oldKey = readChallenge(first)?.pendingSecret;
      assert.ok(oldKey);
      const second = startChallenge({ staffId: justin, kind: "setup", nextPath: "/" });
      const newKey = readChallenge(second)?.pendingSecret;
      assert.ok(newKey);
      assert.notEqual(newKey, oldKey);
      assert.equal(readChallenge(first), null, "the unfinished set-up is gone");
      assert.throws(() => completeChallenge(second, totpCode(oldKey!)), /not right/);
      assert.equal(twoStepEnabled(justin), false);
      completeChallenge(second, totpCode(newKey!));
      assert.equal(twoStepEnabled(justin), true);
    });
  });
});

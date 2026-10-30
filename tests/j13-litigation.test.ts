import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { get, withDatabase } from "../src/lib/db/connection.ts";
import {
  addCourtDate,
  addLegalDocument,
  addLitigationParty,
  approveLegalDocument,
  bundleIndex,
  evidenceChecklist,
  litigationChronology,
  litigationView,
  markLegalDocumentSentOrFiled,
  nextCourtDate,
  scheduleOfLoss,
  startLitigation,
  verifyCourtDate,
} from "../src/lib/db/litigation.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-j13-"));
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const base = { claimId: "c2", actorId: "staff-sian" };
const party = { representativeName: "", representativeFirm: "", representativeRef: "", contact: "" };
const pdf = { buffer: Buffer.from("%PDF-1.4 fictional claim form"), filename: "claim-form.pdf", mimeType: "application/pdf" };

describe("J13 — litigation and disputes, the basics", () => {
  it("opens a litigation file without assuming any party or court", () => {
    const db = prepared();
    withDatabase(db, () => {
      startLitigation(base);
      const view = litigationView("c2");
      assert.equal(view.open, true);
      assert.deepEqual(view.parties, []);
      assert.equal(view.courtReference, "");
    });
    db.close();
  });

  it("records parties with the capacity staff choose, and never a default", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.throws(() => addLitigationParty({ ...base, ...party, name: "Awkward Client", capacity: "" }), /does not assume who is claimant or defendant/);
      addLitigationParty({ ...base, ...party, name: "Fictional Insurer Ltd", capacity: "insurer_not_party", representativeFirm: "Example Solicitors LLP", representativeRef: "EX/123" });
      addLitigationParty({ ...base, ...party, name: "The client", capacity: "claimant" });
      const parties = litigationView("c2").parties;
      assert.deepEqual(parties.map((p) => p.capacity), ["Insurer (not a party)", "Claimant"]);
      assert.match(parties[0].representative, /Example Solicitors LLP, ref EX\/123/);
    });
    db.close();
  });

  it("keeps each court date with its source and how it was worked out, needing verification by a second person", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.throws(() => addCourtDate({ ...base, kind: "deadline", title: "Defence due", dueOn: "2026-12-01", source: "", calculation: "14 days" }), /where the date comes from/);
      assert.throws(() => addCourtDate({ ...base, kind: "deadline", title: "Defence due", dueOn: "2026-12-01", source: "Order of 01/11/2026, paragraph 2", calculation: "" }), /does not calculate court deadlines/);
      addCourtDate({ ...base, kind: "deadline", title: "Defence due", dueOn: "2026-12-01", source: "Order of 01/11/2026, paragraph 2", calculation: "14 days after service on 17/11/2026, as the order says" });
      addCourtDate({ ...base, kind: "hearing", title: "Small claims hearing", dueOn: "2027-02-10", source: "Notice of hearing dated 05/11/2026", calculation: "" });
      const [deadline] = litigationView("c2").dates;
      assert.equal(deadline.verifiedAt, null, "needs verification");
      assert.equal(nextCourtDate("c2")?.verified, false);
      assert.throws(() => verifyCourtDate({ ...base, dateId: deadline.id }), /Someone other than the person who entered it/);
      verifyCourtDate({ claimId: "c2", actorId: "staff-tom", dateId: deadline.id });
      assert.equal(litigationView("c2").dates[0].verifiedBy, "Tom Hughes");
    });
    db.close();
  });

  it("will not record a legal document as sent or filed until Justin approves it", () => {
    const db = prepared();
    withDatabase(db, () => {
      addLegalDocument({ ...base, kind: "claim_form", title: "Claim form (draft from solicitor)", file: pdf });
      const [doc] = litigationView("c2").documents;
      assert.throws(() => markLegalDocumentSentOrFiled({ ...base, legalDocumentId: doc.id, how: "Filed online" }), /needs Justin's approval/);
      assert.throws(() => approveLegalDocument({ ...base, legalDocumentId: doc.id }), /Only Justin can approve/);
      approveLegalDocument({ claimId: "c2", actorId: "staff-justin", legalDocumentId: doc.id });
      markLegalDocumentSentOrFiled({ ...base, legalDocumentId: doc.id, how: "Filed online by the solicitor" });
      const after = litigationView("c2").documents[0];
      assert.equal(after.approvedBy, "Justin Roberts");
      assert.equal(after.sentOrFiledHow, "Filed online by the solicitor");
    });
    db.close();
  });

  it("builds a schedule of loss with claimed, offered, agreed and paid kept apart, plus an evidence checklist, bundle index and chronology", () => {
    const db = prepared();
    withDatabase(db, () => {
      const schedule = scheduleOfLoss("c3");
      assert.ok(schedule.length > 0);
      for (const row of schedule) assert.deepEqual(Object.keys(row), ["head", "claimedPence", "offeredPence", "agreedPence", "paidPence"]);
      const claimed = Number(get<{ n: number }>(`SELECT SUM(claimed_pence) AS n FROM financial_lines WHERE claim_id = 'c3'`)?.n);
      assert.equal(schedule.reduce((t, r) => t + r.claimedPence, 0), claimed);
      const evidence = evidenceChecklist("c3");
      assert.ok(evidence.some((item) => item.label === "Engineer's report"));
      assert.ok(evidence.some((item) => item.label === "Basic hire rate evidence" && !item.held));
      const bundle = bundleIndex("c3");
      assert.deepEqual(bundle.map((entry) => entry.tab), bundle.map((_, i) => i + 1), "tabs are numbered in order");
      assert.ok(litigationChronology("c3").length > 0);
    });
    db.close();
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/litigation/page.tsx"), "utf8");
    assert.match(page, /needs qualified legal review|LEGAL_REVIEW_NOTE/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { STAFF_ROLE } from "../src/lib/auth/roles.ts";
import { all, get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import {
  applyClientProposals,
  clientFormView,
  clientReview,
  createClientLink,
  decideClientUpload,
  revokeClientLink,
  saveClientForm,
  sendClientLink,
  uploadClientFile,
} from "../src/lib/db/client-form.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-j14-"));
const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

const staff = { actorId: "staff-sian" };
const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), filename: "damage.jpg", mimeType: "image/jpeg" };
const answers = {
  mobile: "07700 900123",
  email: "fictional.client@example.com",
  address: "1 Fictional Street",
  postcode: "CF10 1AA",
  accidentWhere: "Fictional Road roundabout",
  accidentWhat: "Hit from behind while stopped.",
  otherDriver: "Pat Example",
  otherRegistration: "XX11 XXX",
  otherInsurer: "",
};

describe("J14 — the client's secure form", () => {
  it("opens only with the right link, and only its fingerprint is stored", () => {
    const db = prepared();
    withDatabase(db, () => {
      const { token } = createClientLink({ claimId: "c2", ...staff });
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM client_form_links WHERE token_sha256 = ?`, [token])?.n, 0, "the link itself is not stored");
      assert.equal(clientFormView(token).status, "not_started");
      assert.throws(() => clientFormView("not-a-real-link"), /not recognised/);
      run(`UPDATE client_form_links SET expires_at = '2000-01-01T00:00:00.000Z'`);
      assert.throws(() => clientFormView(token), /expired/);
    });
    db.close();
  });

  it("shows the client only their own answers and uploads, never the claim or another client's", () => {
    const db = prepared();
    withDatabase(db, () => {
      const mine = createClientLink({ claimId: "c2", ...staff }).token;
      const theirs = createClientLink({ claimId: "c3", ...staff }).token;
      uploadClientFile({ token: theirs, kind: "photo", file: photo });
      saveClientForm({ token: theirs, values: { mobile: "07700 900999" }, send: false });
      const view = clientFormView(mine);
      assert.deepEqual(Object.keys(view).sort(), ["fileReference", "firstName", "savedAt", "status", "stillNeeded", "submittedAt", "uploads", "values"]);
      assert.deepEqual(view.uploads, []);
      assert.equal(view.values.mobile, undefined);
      assert.ok(!JSON.stringify(view).includes("Fictional Insurer"), "no insurer, handler or money from the claim");
    });
    db.close();
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/c/[token]/page.tsx"), "utf8");
    assert.doesNotMatch(page, /getClaim|claimSummary|financial/);
  });

  it("saves and comes back, then sends; nothing on the claim changes and the handler gets a review task", () => {
    const db = prepared();
    withDatabase(db, () => {
      const before = get<{ mobile_tel: string | null }>(`SELECT p.mobile_tel FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c2'`);
      const { token } = createClientLink({ claimId: "c2", ...staff });
      saveClientForm({ token, values: { ...answers, sneaky: "ignored" }, send: false });
      const back = clientFormView(token);
      assert.equal(back.status, "draft");
      assert.equal(back.values.mobile, answers.mobile);
      assert.equal(back.values.sneaky, undefined, "only the listed questions are kept");
      assert.ok(back.stillNeeded.includes("Driving licence"));
      assert.ok(!back.stillNeeded.includes("Mobile number"));
      saveClientForm({ token, values: answers, send: true });
      assert.equal(clientFormView(token).status, "submitted");
      const after = get<{ mobile_tel: string | null }>(`SELECT p.mobile_tel FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c2'`);
      assert.equal(after?.mobile_tel, before?.mobile_tel, "the claim is untouched until staff apply it");
      assert.ok(get(`SELECT id FROM claim_events WHERE claim_id = 'c2' AND event_type = 'client_form_sent'`));
      assert.ok(get(`SELECT id FROM tasks WHERE claim_id = 'c2' AND title = 'Review the client''s form' AND status = 'open'`));
    });
    db.close();
  });

  it("holds uploads apart from the claim's documents and refuses files that are not photos or PDFs", () => {
    const db = prepared();
    withDatabase(db, () => {
      const { token } = createClientLink({ claimId: "c2", ...staff });
      const documentsBefore = get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c2'`)?.n;
      uploadClientFile({ token, kind: "driving_licence", file: { ...photo, filename: "licence.jpg" } });
      assert.equal(get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = 'c2'`)?.n, documentsBefore);
      assert.throws(() => uploadClientFile({ token, kind: "photo", file: { buffer: Buffer.from("MZ"), filename: "run.exe", mimeType: "application/octet-stream" } }), /photo .* or a PDF/);
      assert.throws(() => uploadClientFile({ token, kind: "", file: photo }), /Choose what the file is/);
      assert.deepEqual(clientFormView(token).uploads.map((u) => u.filename), ["licence.jpg"]);
    });
    db.close();
  });

  it("lets staff apply only the ticked answers, through the versioned screen save, with old and new values recorded", () => {
    const db = prepared();
    withDatabase(db, () => {
      const { token } = createClientLink({ claimId: "c2", ...staff });
      saveClientForm({ token, values: answers, send: true });
      const review = clientReview("c2");
      assert.ok(review.latest);
      const mobile = review.proposals.find((row) => row.name === "mobile");
      assert.equal(mobile?.proposed, answers.mobile);
      assert.throws(() => applyClientProposals({ claimId: "c2", ...staff, linkId: review.latest!.linkId, fields: [] }), /Tick at least one/);
      applyClientProposals({ claimId: "c2", ...staff, linkId: review.latest!.linkId, fields: ["mobile", "otherDriver"] });
      const person = get<{ mobile_tel: string; email: string | null }>(`SELECT p.mobile_tel, p.email FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c2'`);
      assert.equal(person?.mobile_tel, answers.mobile);
      assert.notEqual(person?.email, answers.email, "an unticked answer is not applied");
      const screen = JSON.parse(String(get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = 'c2' AND screen_key = 'client'`)?.data_json));
      assert.equal(screen.telMobile, answers.mobile, "the Client screen shows it too");
      assert.ok(get(`SELECT id FROM audit_log WHERE action = 'save' AND entity = 'screen:client' AND entity_id = 'c2' AND details LIKE '%07700 900123%'`));
      const event = get<{ details: string }>(`SELECT details FROM claim_events WHERE claim_id = 'c2' AND event_type = 'client_form_reviewed'`);
      assert.match(String(event?.details), /Mobile number: .* → 07700 900123/);
      assert.match(String(event?.details), /The other driver's name: Pat Example/);
      assert.equal(get(`SELECT id FROM tasks WHERE claim_id = 'c2' AND title = 'Review the client''s form' AND status = 'open'`), undefined, "the review task closes");
      assert.equal(clientReview("c2").proposals.find((row) => row.name === "mobile")?.same, true);
    });
    db.close();
  });

  it("adds an accepted upload to the claim as the chosen document type, and leaves a rejected one off", () => {
    const db = prepared();
    withDatabase(db, () => {
      const { token } = createClientLink({ claimId: "c2", ...staff });
      uploadClientFile({ token, kind: "driving_licence", file: { ...photo, filename: "licence.jpg" } });
      uploadClientFile({ token, kind: "photo", file: { ...photo, filename: "blurry.jpg" } });
      const [licence, blurry] = clientReview("c2").uploads;
      decideClientUpload({ claimId: "c2", ...staff, actorRole: STAFF_ROLE, uploadId: licence.id, accept: true, documentType: "driving_licence" });
      decideClientUpload({ claimId: "c2", ...staff, actorRole: STAFF_ROLE, uploadId: blurry.id, accept: false, documentType: "" });
      const docs = all<{ document_type: string; title: string }>(`SELECT document_type, title FROM documents WHERE claim_id = 'c2' AND title LIKE 'From the client:%'`);
      assert.deepEqual(docs.map((doc) => ({ ...doc })), [{ document_type: "driving_licence", title: "From the client: licence.jpg" }]);
      assert.deepEqual(clientReview("c2").uploads.map((u) => u.decision), ["accepted", "rejected"]);
    });
    db.close();
  });

  it("keeps one working link: a new one switches the old one off and keeps what the client entered", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const first = createClientLink({ claimId: "c2", ...staff }).token;
      saveClientForm({ token: first, values: answers, send: false });
      uploadClientFile({ token: first, kind: "photo", file: photo });
      const sent = await sendClientLink({ claimId: "c2", ...staff, to: "fictional.client@example.com", origin: "http://localhost:3000" });
      assert.equal(sent.simulated, true, "email stays simulated in the prototype");
      assert.throws(() => clientFormView(first), /switched off/);
      const body = String(get<{ body: string }>(`SELECT body FROM correspondence WHERE id = ?`, [sent.correspondenceId])?.body);
      const token = /\/c\/([A-Za-z0-9_-]+)/.exec(body)?.[1] || "";
      const view = clientFormView(token);
      assert.equal(view.values.mobile, answers.mobile);
      assert.equal(view.uploads.length, 1);
      const live = clientReview("c2").links.find((link) => !link.revoked)!;
      revokeClientLink({ claimId: "c2", ...staff, linkId: live.id });
      assert.throws(() => clientFormView(token), /switched off/);
    });
    db.close();
  });

  it("lets the client page through without a CAS login, and hides the staff menu on it", () => {
    const proxy = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
    assert.ok(proxy.includes("/^\\/c\\/[A-Za-z0-9_-]+(\\/save)?$/"));
    const shell = fs.readFileSync(path.join(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    assert.match(shell, /path\.startsWith\("\/c\/"\)/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabaseAsync } from "../src/lib/db/connection.ts";
import { sendClaimEmail } from "../src/lib/db/chronology.ts";
import { currentCasInsuranceDocument, listCasInsuranceDocuments, storeCasInsuranceCertificate } from "../src/lib/db/company-insurance.ts";
import { loadClaimEmailAttachments } from "../src/lib/db/email-attachments.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAILBOX_ATTACHMENT_LIMIT_BYTES,
  attachmentChoices,
  attachmentsExceedMailboxLimit,
  selectedAttachmentBytes,
} from "../src/lib/email/attachments.ts";
import {
  M365_CLIENT_ID_ENV,
  M365_CLIENT_SECRET_ENV,
  M365_TENANT_ID_ENV,
  setMailboxFetchForTests,
} from "../src/lib/email/microsoft-graph.ts";
import {
  CAS_INSURANCE_DOCUMENT_TYPE,
  PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
  PAYMENT_REQUEST_PACK_MISSING,
  paymentRequestPack,
  type PackDocument,
} from "../src/lib/email/payment-request-pack.ts";

const ENV_KEYS = [M365_TENANT_ID_ENV, M365_CLIENT_ID_ENV, M365_CLIENT_SECRET_ENV, "CAS_FILES_DIR"] as const;
const ALL_MISSING = [
  PAYMENT_REQUEST_PACK_MISSING.letter,
  PAYMENT_REQUEST_PACK_MISSING.signedHireAgreement,
  PAYMENT_REQUEST_PACK_MISSING.clientV5c,
  PAYMENT_REQUEST_PACK_MISSING.drivingLicence,
  PAYMENT_REQUEST_PACK_MISSING.clientInsurance,
  PAYMENT_REQUEST_PACK_MISSING.hireVehicleV5c,
  PAYMENT_REQUEST_PACK_MISSING.casInsurance,
];

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

function rememberEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setMailboxFetchForTests(null);
}

function useTestCredentials() {
  process.env[M365_TENANT_ID_ENV] = "11111111-1111-1111-1111-111111111111";
  process.env[M365_CLIENT_ID_ENV] = "22222222-2222-2222-2222-222222222222";
  process.env[M365_CLIENT_SECRET_ENV] = "secret-test-value";
}

function fileDoc(id: string, documentType: string, extra: Partial<PackDocument> = {}): PackDocument {
  return {
    id,
    document_type: documentType,
    version: 1,
    created_at: "2026-09-01T09:00:00.000Z",
    stored_relpath: `claims/c1/${id}.pdf`,
    byte_size: 120,
    title: documentType,
    ...extra,
  };
}

describe("payment request pack ticks", () => {
  it("pre-ticks only the current stored pack, and does not tick older or unrelated documents", () => {
    const claimDocuments: PackDocument[] = [
      {
        id: "letter-old",
        template_key: "hire_pack_cover",
        title: "Hire pack cover letter",
        version: 1,
        created_at: "2026-08-01T09:00:00.000Z",
        body_html: "<p>Earlier letter</p>",
      },
      {
        id: "letter-current",
        template_key: "hire_pack_cover",
        title: "Hire pack cover letter",
        version: 2,
        created_at: "2026-09-01T09:00:00.000Z",
        body_html: "<p>Current letter</p>",
      },
      fileDoc("hire-old", "signed_hire_agreement", { version: 1, signed: 1, created_at: "2026-07-01T09:00:00.000Z" }),
      fileDoc("hire-current", "signed_hire_agreement", {
        version: 2,
        signed: 1,
        replaces_document_id: "hire-old",
        created_at: "2026-08-15T09:00:00.000Z",
      }),
      {
        id: "hire-unsigned",
        document_type: "hire_agreement",
        template_key: "hire_agreement",
        title: "Hire Agreement TEST-HA-000099",
        version: 3,
        signed: 0,
        created_at: "2026-09-02T09:00:00.000Z",
        body_html: "<p>Unsigned</p>",
      },
      fileDoc("v5c-client-old", "v5c_client", { version: 1, created_at: "2026-06-01T09:00:00.000Z" }),
      fileDoc("v5c-client", "v5c_client", { version: 2, replaces_document_id: "v5c-client-old", created_at: "2026-07-02T09:00:00.000Z" }),
      fileDoc("licence", "driving_licence"),
      fileDoc("client-insurance", "insurance_certificate"),
      fileDoc("v5c-cas", "v5c_cas"),
      fileDoc("engineer", "engineer_report"),
      {
        id: "rebuttal",
        template_key: "rebuttal_rate",
        title: "Rebuttal — hire rate",
        version: 1,
        created_at: "2026-09-03T09:00:00.000Z",
        body_html: "<p>Not the payment request</p>",
      },
    ];
    const companyDocuments: PackDocument[] = [
      fileDoc("cas-old", CAS_INSURANCE_DOCUMENT_TYPE, { version: 1, created_at: "2026-01-01T09:00:00.000Z" }),
      fileDoc("cas-current", CAS_INSURANCE_DOCUMENT_TYPE, {
        version: 2,
        replaces_document_id: "cas-old",
        created_at: "2026-05-01T09:00:00.000Z",
      }),
    ];
    const pack = paymentRequestPack({
      templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
      claimDocuments,
      companyDocuments,
    });
    assert.equal(pack.applies, true);
    assert.deepEqual(pack.selectedIds, ["letter-current", "hire-current", "v5c-client", "licence", "client-insurance", "v5c-cas", "cas-current"]);
    assert.deepEqual(pack.missing, []);
    const listed = attachmentChoices([...companyDocuments, ...claimDocuments]).map((item) => item.id);
    assert.ok(listed.includes("hire-old"));
    assert.ok(listed.includes("hire-unsigned"));
    assert.ok(listed.includes("letter-old"));
    assert.equal(listed.includes("hire-current"), true);
    const chase2 = paymentRequestPack({ templateKey: "payment_chase_2", claimDocuments, companyDocuments });
    assert.equal(chase2.applies, true);
    assert.deepEqual(chase2.selectedIds, pack.selectedIds);
    assert.deepEqual(chase2.missing, pack.missing);
    const other = paymentRequestPack({ templateKey: "client_welcome", claimDocuments, companyDocuments });
    assert.equal(other.applies, false);
    assert.deepEqual(other.selectedIds, []);
    assert.deepEqual(other.missing, []);
  });

  it("pre-ticks the same current pack for Payment chase 2, and leaves nothing missing", () => {
    const claimDocuments: PackDocument[] = [
      {
        id: "letter-current",
        template_key: "hire_pack_cover",
        title: "Hire pack cover letter",
        version: 1,
        created_at: "2026-09-01T09:00:00.000Z",
        body_html: "<p>Current letter</p>",
      },
      fileDoc("hire-current", "signed_hire_agreement", { signed: 1 }),
      fileDoc("v5c-client", "v5c_client"),
      fileDoc("licence", "driving_licence"),
      fileDoc("client-insurance", "insurance_certificate"),
      fileDoc("v5c-cas", "v5c_cas"),
      fileDoc("handover", "handover_photo"),
      {
        id: "hire-unsigned",
        document_type: "hire_agreement",
        template_key: "hire_agreement",
        title: "Hire Agreement TEST-HA-000099",
        version: 1,
        signed: 0,
        created_at: "2026-09-02T09:00:00.000Z",
        body_html: "<p>Unsigned</p>",
      },
    ];
    const companyDocuments = [fileDoc("cas-current", CAS_INSURANCE_DOCUMENT_TYPE)];
    const chase1 = paymentRequestPack({
      templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
      claimDocuments,
      companyDocuments,
    });
    const chase2 = paymentRequestPack({ templateKey: "payment_chase_2", claimDocuments, companyDocuments });
    assert.equal(chase1.applies, true);
    assert.equal(chase2.applies, true);
    assert.deepEqual(chase2.selectedIds, ["letter-current", "hire-current", "v5c-client", "licence", "client-insurance", "v5c-cas", "cas-current"]);
    assert.deepEqual(chase2.missing, []);
    assert.deepEqual(chase2.selectedIds, chase1.selectedIds);
    assert.deepEqual(chase2.missing, chase1.missing);
    assert.equal(chase2.selectedIds.includes("handover"), false);
    assert.equal(chase2.selectedIds.includes("hire-unsigned"), false);
  });

  it("names all seven gaps for Payment chase 2 when nothing is stored, and ticks nothing", () => {
    const chase1 = paymentRequestPack({
      templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
      claimDocuments: [],
      companyDocuments: [],
    });
    const chase2 = paymentRequestPack({ templateKey: "payment_chase_2", claimDocuments: [], companyDocuments: [] });
    assert.equal(chase2.applies, true);
    assert.deepEqual(chase2.selectedIds, []);
    assert.deepEqual(chase2.missing, ALL_MISSING);
    assert.equal(chase2.missing.length, 7);
    assert.deepEqual(chase2.selectedIds, chase1.selectedIds);
    assert.deepEqual(chase2.missing, chase1.missing);
  });

  it("names every missing pack document and does not substitute another file", () => {
    const empty = paymentRequestPack({ templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY, claimDocuments: [], companyDocuments: [] });
    assert.deepEqual(empty.selectedIds, []);
    assert.deepEqual(empty.missing, ALL_MISSING);
    const licenceOnly = paymentRequestPack({
      templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
      claimDocuments: [fileDoc("licence", "driving_licence"), fileDoc("engineer", "engineer_report")],
      companyDocuments: [fileDoc("cas-current", CAS_INSURANCE_DOCUMENT_TYPE)],
    });
    assert.deepEqual(licenceOnly.selectedIds, ["licence", "cas-current"]);
    assert.deepEqual(licenceOnly.missing, [
      PAYMENT_REQUEST_PACK_MISSING.letter,
      PAYMENT_REQUEST_PACK_MISSING.signedHireAgreement,
      PAYMENT_REQUEST_PACK_MISSING.clientV5c,
      PAYMENT_REQUEST_PACK_MISSING.clientInsurance,
      PAYMENT_REQUEST_PACK_MISSING.hireVehicleV5c,
    ]);
    assert.equal(licenceOnly.missing.some((line) => /engineer/i.test(line)), false);
    assert.equal(licenceOnly.missing.includes(PAYMENT_REQUEST_PACK_MISSING.drivingLicence), false);
    assert.equal(licenceOnly.missing.includes(PAYMENT_REQUEST_PACK_MISSING.casInsurance), false);
    assert.equal(licenceOnly.missing.includes(PAYMENT_REQUEST_PACK_MISSING.clientInsurance), true);
  });

  it("pre-ticks only the current signed hire agreement when several versions are stored", () => {
    const claimDocuments: PackDocument[] = [
      {
        id: "v1",
        document_type: "hire_agreement",
        template_key: "hire_agreement",
        title: "Hire Agreement TEST-HA-000010",
        version: 1,
        signed: 1,
        created_at: "2026-01-01T09:00:00.000Z",
        body_html: "<p>Signed version 1</p>",
      },
      {
        id: "v2",
        document_type: "hire_agreement",
        template_key: "hire_agreement",
        title: "Hire Agreement TEST-HA-000010",
        version: 2,
        signed: 1,
        created_at: "2026-02-01T09:00:00.000Z",
        body_html: "<p>Signed version 2</p>",
      },
      {
        id: "v3",
        document_type: "hire_agreement",
        template_key: "hire_agreement",
        title: "Hire Agreement TEST-HA-000010",
        version: 3,
        signed: 0,
        created_at: "2026-03-01T09:00:00.000Z",
        body_html: "<p>Unsigned version 3</p>",
      },
    ];
    const pack = paymentRequestPack({ templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY, claimDocuments, companyDocuments: [] });
    assert.equal(pack.selectedIds.includes("v2"), true);
    assert.equal(pack.selectedIds.includes("v1"), false);
    assert.equal(pack.selectedIds.includes("v3"), false);
    assert.equal(pack.missing.includes(PAYMENT_REQUEST_PACK_MISSING.signedHireAgreement), false);
    const choices = attachmentChoices(claimDocuments).map((item) => item.id);
    assert.deepEqual(choices.sort(), ["v1", "v2", "v3"]);
  });

  it("refuses an auto-selected pack over 35 MB with the existing limit, and selecting it does not send", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const html = "x".repeat(MAILBOX_ATTACHMENT_LIMIT_BYTES + 1);
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, created_at)
           VALUES ('letter-old', 'c1', 'Hire pack cover letter', 'letter', 1, 0, 1, '<p>Earlier</p>', 'hire_pack_cover', '2026-08-01T09:00:00.000Z')`,
        ).run();
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, created_at)
           VALUES ('letter-current', 'c1', 'Hire pack cover letter', 'letter', 2, 0, 1, ?, 'hire_pack_cover', '2026-09-01T09:00:00.000Z')`,
        ).run(html);
        const beforeCorrespondence = db.prepare(`SELECT COUNT(*) AS n FROM correspondence`).get() as { n: number };
        const beforeDocuments = db.prepare(`SELECT COUNT(*) AS n FROM documents`).get() as { n: number };
        const rows = db.prepare(`SELECT * FROM documents WHERE claim_id = ?`).all("c1") as PackDocument[];
        const pack = paymentRequestPack({
          templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
          claimDocuments: rows,
          companyDocuments: [],
        });
        const afterCorrespondence = db.prepare(`SELECT COUNT(*) AS n FROM correspondence`).get() as { n: number };
        const afterDocuments = db.prepare(`SELECT COUNT(*) AS n FROM documents`).get() as { n: number };
        assert.equal(afterCorrespondence.n, beforeCorrespondence.n);
        assert.equal(afterDocuments.n, beforeDocuments.n);
        assert.equal(calls, 0);
        assert.deepEqual(pack.selectedIds, ["letter-current"]);
        assert.equal(pack.missing.includes(PAYMENT_REQUEST_PACK_MISSING.letter), false);
        const choices = attachmentChoices(rows);
        assert.equal(attachmentsExceedMailboxLimit(selectedAttachmentBytes(choices, pack.selectedIds)), true);
        const result = await sendClaimEmail({
          claimId: "c1",
          actorId: "staff-justin",
          to: "insurer@example.test",
          subject: "Payment request pack too large",
          body: "This must not leave.",
          templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
          attachmentIds: pack.selectedIds,
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error, ATTACHMENT_TOO_LARGE_MESSAGE);
        assert.equal(calls, 0);
        const row = db.prepare(`SELECT id FROM correspondence WHERE subject = ?`).get("Payment request pack too large");
        assert.equal(row, undefined);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("lets a claim with nothing stored be sent as text, and does not invent the missing pack", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    const calls: string[] = [];
    setMailboxFetchForTests(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      if (url.endsWith("/sendMail")) return new Response(null, { status: 202 });
      return new Response("unexpected", { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const before = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ?`).get("c1") as { n: number };
        const pack = paymentRequestPack({
          templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
          claimDocuments: [],
          companyDocuments: listCasInsuranceDocuments(),
        });
        const after = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE claim_id = ?`).get("c1") as { n: number };
        assert.equal(after.n, before.n);
        assert.equal(listCasInsuranceDocuments().length, 0);
        assert.deepEqual(pack.selectedIds, []);
        assert.deepEqual(pack.missing, ALL_MISSING);
        assert.equal(calls.length, 0);
        const result = await sendClaimEmail({
          claimId: "c1",
          actorId: "staff-justin",
          to: "insurer@example.test",
          subject: "Text only payment chase",
          body: "Please update us on payment. No papers are attached.",
          templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
          attachmentIds: [],
        });
        assert.equal(result.ok, true);
        const row = db.prepare(`SELECT sent_status, attachments_json FROM correspondence WHERE subject = ?`).get("Text only payment chase") as {
          sent_status: string;
          attachments_json: string | null;
        };
        assert.equal(row.sent_status, "sent");
        assert.equal(row.attachments_json, null);
        assert.equal(calls.some((call) => call.includes("/sendMail")), true);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("stores CAS's insurance certificate once for the company, ticks the current copy, and will not attach another claim's file", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const files = fs.mkdtempSync(path.join(os.tmpdir(), "cas-ins-"));
    process.env.CAS_FILES_DIR = files;
    const db = seeded();
    const calls: string[] = [];
    setMailboxFetchForTests(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      const method = init?.method || "GET";
      if (method === "POST" && url.endsWith("/messages")) return Response.json({ id: "draft-cas" }, { status: 201 });
      if (method === "POST" && url.endsWith("/attachments")) return Response.json({ id: "att" }, { status: 201 });
      if (method === "POST" && url.endsWith("/send")) return new Response(null, { status: 202 });
      return new Response("unexpected", { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        assert.equal(currentCasInsuranceDocument(), null);
        assert.throws(
          () =>
            storeCasInsuranceCertificate({
              actorId: "staff-driver",
              actorRole: "driver",
              file: { buffer: Buffer.from("%PDF-1.4 not-stored"), filename: "cas.pdf", mimeType: "application/pdf" },
            }),
          /cannot store the company insurance certificate/i,
        );
        assert.equal(listCasInsuranceDocuments().length, 0);
        const first = storeCasInsuranceCertificate({
          actorId: "staff-justin",
          actorRole: "administrator",
          file: { buffer: Buffer.from("%PDF-1.4 earlier"), filename: "earlier.pdf", mimeType: "application/pdf" },
        });
        const second = storeCasInsuranceCertificate({
          actorId: "staff-justin",
          actorRole: "administrator",
          file: { buffer: Buffer.from("%PDF-1.4 current"), filename: "current.pdf", mimeType: "application/pdf" },
        });
        assert.equal(first.version, 1);
        assert.equal(second.version, 2);
        const current = currentCasInsuranceDocument();
        assert.equal(current?.id, second.id);
        const storedClaim = db.prepare(`SELECT claim_id FROM documents WHERE id = ?`).get(second.id) as { claim_id: string | null };
        assert.equal(storedClaim.claim_id, null);
        const companyDocuments = listCasInsuranceDocuments();
        assert.equal(companyDocuments.length, 2);
        const pack = paymentRequestPack({
          templateKey: PAYMENT_REQUEST_EMAIL_TEMPLATE_KEY,
          claimDocuments: [],
          companyDocuments,
        });
        assert.deepEqual(pack.selectedIds, [second.id]);
        assert.equal(pack.missing.includes(PAYMENT_REQUEST_PACK_MISSING.casInsurance), false);
        const listed = attachmentChoices(companyDocuments).map((item) => item.id);
        assert.ok(listed.includes(first.id));
        assert.ok(listed.includes(second.id));
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, body_html, created_at)
           VALUES ('stray-v5c', NULL, 'Other yard V5C', 'file', 'V5C', 1, 0, 0, '<p>not the certificate</p>', '2026-09-01T09:00:00.000Z')`,
        ).run();
        const refused = loadClaimEmailAttachments("c1", ["stray-v5c"]);
        assert.equal(refused.ok, false);
        if (!refused.ok) assert.match(refused.error, /not stored on this claim/i);
        assert.equal(calls.length, 0);
        const result = await sendClaimEmail({
          claimId: "c1",
          actorId: "staff-justin",
          to: "insurer@example.test",
          subject: "Certificate from settings",
          body: "The company certificate is attached.",
          attachmentIds: [second.id],
        });
        assert.equal(result.ok, true);
        const row = db.prepare(`SELECT attachments_json FROM correspondence WHERE subject = ?`).get("Certificate from settings") as {
          attachments_json: string;
        };
        assert.match(row.attachments_json, /CAS's own insurance certificate/);
        const onClaim = db.prepare(`SELECT id FROM documents WHERE claim_id = 'c1' AND document_type = ?`).get(CAS_INSURANCE_DOCUMENT_TYPE);
        assert.equal(onClaim, undefined);
      });
    } finally {
      db.close();
      fs.rmSync(files, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });
});

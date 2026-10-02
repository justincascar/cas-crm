import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabaseAsync } from "../src/lib/db/connection.ts";
import { listClaimEvents, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES,
  MAILBOX_ATTACHMENT_LIMIT_BYTES,
  NO_STORED_DOCUMENTS_MESSAGE,
  attachmentChoices,
  attachmentsExceedMailboxLimit,
} from "../src/lib/email/attachments.ts";
import {
  M365_CLIENT_ID_ENV,
  M365_CLIENT_SECRET_ENV,
  M365_TENANT_ID_ENV,
  setMailboxFetchForTests,
} from "../src/lib/email/microsoft-graph.ts";
import { storeFileCopy } from "../src/lib/storage/files.ts";

const ENV_KEYS = [M365_TENANT_ID_ENV, M365_CLIENT_ID_ENV, M365_CLIENT_SECRET_ENV, "CAS_FILES_DIR"] as const;

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

describe("email attachments", () => {
  it("lists only documents stored on the claim, and leaves them for a person to choose", () => {
    const choices = attachmentChoices([
      {
        id: "hire",
        title: "Hire Agreement TEST-HA-000002",
        template_key: "hire_agreement",
        version: 1,
        created_at: "2026-10-01T09:00:00.000Z",
        body_html: "<p>Signed terms</p>",
      },
      {
        id: "v5c",
        title: "YT18 VJL",
        document_type: "v5c_cas",
        version: 1,
        created_at: "2026-09-15T10:00:00.000Z",
        stored_relpath: "claims/c4/v5c.pdf",
        byte_size: 1200,
      },
      { id: "empty", title: "Placeholder", created_at: "2026-09-01T10:00:00.000Z" },
    ]);
    assert.deepEqual(
      choices.map((item) => item.id),
      ["hire", "v5c"],
    );
    assert.match(choices.find((item) => item.id === "hire")?.label || "", /Hire Agreement TEST-HA-000002 — generated \d{2}\/\d{2}\/\d{4}/);
    assert.match(choices.find((item) => item.id === "v5c")?.label || "", /V5C — CAS vehicle — \d{2}\/\d{2}\/\d{4}/);
    assert.equal(choices.find((item) => item.id === "v5c")?.byteSize, 1200);
    assert.equal(attachmentChoices([]).length, 0);
    assert.match(NO_STORED_DOCUMENTS_MESSAGE, /No documents stored on this claim yet/);
  });

  it("sends the ticked document and records it on the file history", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const files = fs.mkdtempSync(path.join(os.tmpdir(), "cas-attach-"));
    process.env.CAS_FILES_DIR = files;
    const stored = storeFileCopy({
      relDir: "claims/c4",
      originalFilename: "licence.pdf",
      buffer: Buffer.from("%PDF-1.4 licence"),
    });
    const db = seeded();
    const attachmentBodies: string[] = [];
    const calls: string[] = [];
    setMailboxFetchForTests(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      const method = init?.method || "GET";
      calls.push(`${method} ${url}`);
      if (method === "POST" && url.endsWith("/messages")) {
        const payload = JSON.parse(String(init?.body || "")) as { subject?: string; attachments?: unknown };
        assert.equal(payload.subject, "Papers for TEST-0004");
        assert.equal(payload.attachments, undefined);
        return Response.json({ id: "draft-1" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/attachments")) {
        attachmentBodies.push(String(init?.body || ""));
        return Response.json({ id: "att" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/send")) return new Response(null, { status: 202 });
      return new Response("unexpected", { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, body_html, template_key, created_at)
           VALUES ('doc-hire', 'c4', 'Hire Agreement TEST-HA-000002', 'agreement', 'hire_agreement', 1, 0, 1, '<p>Hire agreement body</p>', 'hire_agreement', '2026-10-01T09:00:00.000Z')`,
        ).run();
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, original_filename, stored_relpath, mime_type, byte_size, created_at)
           VALUES ('doc-licence', 'c4', 'Driving licence', 'upload', 'driving_licence', 1, 0, 0, 'licence.pdf', ?, 'application/pdf', ?, '2026-09-20T09:00:00.000Z')`,
        ).run(stored.storedRelpath, stored.byteSize);
        const result = await sendClaimEmail({
          claimId: "c4",
          actorId: "staff-justin",
          to: "dafydd.jones@example.test",
          subject: "Papers for TEST-0004",
          body: "Please find the papers attached.",
          attachmentIds: ["doc-hire", "doc-licence"],
        });
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.status, "sent");
        assert.equal(attachmentBodies.length, 2);
        const parsed = attachmentBodies.map((body) => JSON.parse(body) as { name: string; contentType: string; contentBytes: string });
        const hire = parsed.find((item) => item.contentType === "text/html");
        const licence = parsed.find((item) => item.name === "licence.pdf");
        assert.equal(Buffer.from(hire?.contentBytes || "", "base64").toString("utf8"), "<p>Hire agreement body</p>");
        assert.equal(Buffer.from(licence?.contentBytes || "", "base64").toString("utf8"), "%PDF-1.4 licence");
        assert.equal(calls.some((call) => call.includes("/sendMail")), false);
        assert.equal(calls.some((call) => call.startsWith("DELETE ")), false);
        assert.equal(calls.filter((call) => call.endsWith("/send")).length, 1);
        const row = db.prepare(`SELECT sent_status, attachments_json FROM correspondence WHERE subject = ?`).get("Papers for TEST-0004") as {
          sent_status: string;
          attachments_json: string;
        };
        assert.equal(row.sent_status, "sent");
        assert.match(row.attachments_json, /Hire Agreement TEST-HA-000002/);
        assert.match(row.attachments_json, /Driving licence/);
        const event = listClaimEvents("c4").find((item) => item.event_type === "outgoing_email" && String(item.details).includes("Papers for TEST-0004"));
        assert.match(String(event?.details), /Attached: .*Hire Agreement TEST-HA-000002/);
        assert.match(String(event?.details), /Driving licence/);
      });
    } finally {
      db.close();
      fs.rmSync(files, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  it("refuses an oversized selection before calling Microsoft, and does not mark it sent", async () => {
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
           VALUES ('doc-big', 'c4', 'Large pack', 'agreement', 1, 0, 1, ?, 'hire_agreement', '2026-10-01T09:00:00.000Z')`,
        ).run(html);
        assert.equal(attachmentsExceedMailboxLimit(html.length), true);
        const result = await sendClaimEmail({
          claimId: "c4",
          actorId: "staff-justin",
          to: "dafydd.jones@example.test",
          subject: "Too big for TEST-0004",
          body: "This must not leave.",
          attachmentIds: ["doc-big"],
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error, ATTACHMENT_TOO_LARGE_MESSAGE);
        const row = db.prepare(`SELECT id FROM correspondence WHERE subject = ?`).get("Too big for TEST-0004");
        assert.equal(row, undefined);
        assert.equal(calls, 0);
        const sent = listClaimEvents("c4").filter((item) => item.event_type === "outgoing_email" && String(item.details).includes("Too big"));
        assert.equal(sent.length, 0);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("does not attach a document stored on a different claim", async () => {
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
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, created_at)
           VALUES ('doc-other', 'c3', 'Other file', 'letter', 1, 0, 1, '<p>Not this claim</p>', '2026-10-01T09:00:00.000Z')`,
        ).run();
        const result = await sendClaimEmail({
          claimId: "c4",
          actorId: "staff-justin",
          to: "dafydd.jones@example.test",
          subject: "Wrong file for TEST-0004",
          body: "This must not leave.",
          attachmentIds: ["doc-other"],
        });
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error, /not stored on this claim/i);
        assert.equal(calls, 0);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("removes the draft when the send fails after the documents are attached, and does not mark it sent", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    let deleted = false;
    let sent = false;
    setMailboxFetchForTests(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      const method = init?.method || "GET";
      if (method === "POST" && url.endsWith("/messages")) return Response.json({ id: "draft-half" }, { status: 201 });
      if (method === "POST" && url.endsWith("/attachments")) return Response.json({ id: "att" }, { status: 201 });
      if (method === "POST" && url.endsWith("/send")) {
        sent = true;
        return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
      }
      if (method === "DELETE" && url.endsWith("/messages/draft-half")) {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, version, signed, simulated, body_html, template_key, created_at)
           VALUES ('doc-hire', 'c4', 'Hire Agreement TEST-HA-000002', 'agreement', 1, 0, 1, '<p>Hire agreement body</p>', 'hire_agreement', '2026-10-01T09:00:00.000Z')`,
        ).run();
        const result = await sendClaimEmail({
          claimId: "c4",
          actorId: "staff-justin",
          to: "dafydd.jones@example.test",
          subject: "Half sent for TEST-0004",
          body: "This must not count as sent.",
          attachmentIds: ["doc-hire"],
        });
        assert.equal(sent, true);
        assert.equal(deleted, true);
        assert.equal(result.ok, false);
        const row = db.prepare(`SELECT id, sent_status FROM correspondence WHERE subject = ?`).get("Half sent for TEST-0004") as {
          id: string;
          sent_status: string;
        };
        assert.equal(row.sent_status, "failed");
        const events = listClaimEvents("c4").filter((item) => item.correspondence_id === row.id);
        assert.equal(events.some((item) => item.event_type === "outgoing_email"), false);
        assert.equal(events.some((item) => item.event_type === "email_send_failed"), true);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("uploads a document of 3 MB or more in pieces, then sends the draft", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const files = fs.mkdtempSync(path.join(os.tmpdir(), "cas-attach-large-"));
    process.env.CAS_FILES_DIR = files;
    const payload = Buffer.alloc(GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES, 7);
    const stored = storeFileCopy({ relDir: "claims/c4", originalFilename: "v5c.pdf", buffer: payload });
    const db = seeded();
    const ranges: string[] = [];
    setMailboxFetchForTests(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      const method = init?.method || "GET";
      if (method === "POST" && url.endsWith("/messages")) return Response.json({ id: "draft-large" }, { status: 201 });
      if (method === "POST" && url.endsWith("/createUploadSession")) {
        const body = JSON.parse(String(init?.body || "")) as { AttachmentItem: { size: number; name: string } };
        assert.equal(body.AttachmentItem.name, "v5c.pdf");
        assert.equal(body.AttachmentItem.size, GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES);
        return Response.json({ uploadUrl: "https://outlook.office.com/api/v2.0/attachment-session?authtoken=test" }, { status: 201 });
      }
      if (method === "PUT" && url.startsWith("https://outlook.office.com/")) {
        const headers = init?.headers as Record<string, string>;
        ranges.push(headers["Content-Range"]);
        const start = ranges.length === 1 ? 2 * 1024 * 1024 : GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES;
        if (start >= GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES) return new Response(null, { status: 201 });
        return Response.json({ nextExpectedRanges: [String(start)] });
      }
      if (method === "POST" && url.endsWith("/send")) return new Response(null, { status: 202 });
      return new Response(`unexpected ${method} ${url}`, { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        db.prepare(
          `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, original_filename, stored_relpath, mime_type, byte_size, created_at)
           VALUES ('doc-v5c', 'c4', 'V5C — CAS vehicle', 'file', 'v5c_cas', 1, 0, 0, 'v5c.pdf', ?, 'application/pdf', ?, '2026-10-01T09:00:00.000Z')`,
        ).run(stored.storedRelpath, stored.byteSize);
        const result = await sendClaimEmail({
          claimId: "c4",
          actorId: "staff-justin",
          to: "dafydd.jones@example.test",
          subject: "Large V5C for TEST-0004",
          body: "The logbook is attached in pieces.",
          attachmentIds: ["doc-v5c"],
        });
        assert.equal(result.ok, true);
        assert.deepEqual(ranges, [
          `bytes 0-${2 * 1024 * 1024 - 1}/${GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES}`,
          `bytes ${2 * 1024 * 1024}-${GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES - 1}/${GRAPH_INLINE_ATTACHMENT_LIMIT_BYTES}`,
        ]);
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE subject = ?`).get("Large V5C for TEST-0004") as { sent_status: string };
        assert.equal(row.sent_status, "sent");
      });
    } finally {
      db.close();
      fs.rmSync(files, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });
});

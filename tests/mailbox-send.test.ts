import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";
import { withDatabaseAsync } from "../src/lib/db/connection.ts";
import { instructEngineer, listClaimEvents, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { ENGINEER_INSTRUCTION_MARKED_SENT, ENGINEER_INSTRUCTION_PREPARED, ensureEngineers, SEEDED_ENGINEER } from "../src/lib/db/engineers.ts";
import { sendPreparedCorrespondence } from "../src/lib/db/mailbox-send.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  M365_CLIENT_ID_ENV,
  M365_CLIENT_SECRET_ENV,
  M365_TENANT_ID_ENV,
  mailboxIsConnected,
  setMailboxFetchForTests,
} from "../src/lib/email/microsoft-graph.ts";

const ENV_KEYS = [M365_TENANT_ID_ENV, M365_CLIENT_ID_ENV, M365_CLIENT_SECRET_ENV] as const;
const SECRET = "secret-test-value";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  ensureEngineers(db);
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
  process.env[M365_CLIENT_SECRET_ENV] = SECRET;
}

function clearCredentials() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("Microsoft 365 sending", () => {
  it("keeps today's mailto path when credentials are not configured", async () => {
    const saved = rememberEnv();
    clearCredentials();
    const db = seeded();
    try {
      assert.equal(mailboxIsConnected(), false);
      await withDatabaseAsync(db, async () => {
        const prepared = instructEngineer({ claimId: "c3", engineerId: SEEDED_ENGINEER.id, actorId: "staff-justin" });
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" }),
          /not connected/i,
        );
        const row = db.prepare(`SELECT sent_status, body FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as {
          sent_status: string;
          body: string;
        };
        assert.equal(row.sent_status, ENGINEER_INSTRUCTION_PREPARED);
        assert.equal(row.body, prepared.body);
        const recorded = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "insurer@example.test",
          subject: "Our ref: TEST-0003",
          body: "Dear Sir / Madam\n\nThis is a recorded copy only.",
        });
        assert.equal(recorded.ok, true);
        if (recorded.ok) {
          assert.equal(recorded.status, "simulated_sent");
          assert.match(recorded.warning, /Not sent to a real mailbox/);
        }
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("logs a real send with the recipient, content and time", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    let posted = "";
    setMailboxFetchForTests(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/oauth2/v2.0/token")) {
        assert.equal(init?.method, "POST");
        return Response.json({ access_token: "token-abc" });
      }
      posted = String(init?.body || "");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer token-abc");
      assert.doesNotMatch(posted, new RegExp(SECRET));
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const prepared = instructEngineer({ claimId: "c3", engineerId: SEEDED_ENGINEER.id, actorId: "staff-justin" });
        const before = Date.now();
        await sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" });
        const row = db.prepare(`SELECT sent_status, body, to_address, from_address FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as {
          sent_status: string;
          body: string;
          to_address: string;
          from_address: string;
        };
        assert.equal(row.sent_status, ENGINEER_INSTRUCTION_MARKED_SENT);
        assert.equal(row.to_address, SEEDED_ENGINEER.email);
        assert.equal(row.from_address, CAS_CLAIMS_MAILBOX);
        assert.equal(row.body, prepared.body);
        const payload = JSON.parse(posted) as { message: { subject: string; body: { content: string }; toRecipients: Array<{ emailAddress: { address: string } }> }; saveToSentItems: boolean };
        assert.equal(payload.message.toRecipients[0]?.emailAddress.address, SEEDED_ENGINEER.email);
        assert.equal(payload.message.body.content, prepared.body.trim());
        assert.equal(payload.message.subject, prepared.subject);
        assert.equal(payload.saveToSentItems, true);
        const emailed = listClaimEvents("c3").find(
          (event) => event.correspondence_id === prepared.correspondenceId && event.event_type === "outgoing_email",
        );
        assert.ok(emailed);
        assert.equal(emailed.actor_name, "Justin Roberts");
        assert.match(String(emailed.details), new RegExp(SEEDED_ENGINEER.email.replace(".", "\\.")));
        assert.match(String(emailed.details), /sent to/i);
        assert.match(String(emailed.details), new RegExp(CAS_CLAIMS_MAILBOX.replace(".", "\\.")));
        assert.doesNotMatch(String(emailed.details), /not auto-sent/i);
        const sentAt = Date.parse(String(emailed.occurred_at));
        assert.ok(sentAt >= before - 1000);
        assert.ok(sentAt <= Date.now() + 1000);
        assert.doesNotMatch(String(emailed.details), new RegExp(SECRET));
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("shows a failed send and does not record it as sent", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    setMailboxFetchForTests(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc", error_description: SECRET });
      return new Response(JSON.stringify({ error: { message: SECRET } }), { status: 503 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const prepared = instructEngineer({ claimId: "c3", engineerId: SEEDED_ENGINEER.id, actorId: "staff-justin" });
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" }),
          (error: Error) => {
            assert.match(error.message, /could not be reached/i);
            assert.match(error.message, /Nothing was sent/);
            assert.doesNotMatch(error.message, new RegExp(SECRET));
            return true;
          },
        );
        const row = db.prepare(`SELECT sent_status, body FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as {
          sent_status: string;
          body: string;
        };
        assert.equal(row.sent_status, ENGINEER_INSTRUCTION_PREPARED);
        assert.equal(row.body, prepared.body);
        const events = listClaimEvents("c3").filter((event) => event.correspondence_id === prepared.correspondenceId);
        assert.equal(events.some((event) => event.event_type === "outgoing_email"), false);
        assert.equal(events.some((event) => event.event_type === "engineer_instructed"), false);
        const failed = events.find((event) => event.event_type === "email_send_failed");
        assert.ok(failed);
        assert.match(String(failed.details), /Nothing was sent|Not sent/);
        assert.doesNotMatch(String(failed.details), new RegExp(SECRET));
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("reports invalid credentials as a configuration error and does not keep calling Microsoft", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    let tokenCalls = 0;
    let sendCalls = 0;
    setMailboxFetchForTests(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/oauth2/v2.0/token")) {
        tokenCalls += 1;
        return new Response(JSON.stringify({ error: "invalid_client", error_description: SECRET }), { status: 401 });
      }
      sendCalls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const prepared = instructEngineer({ claimId: "c3", engineerId: SEEDED_ENGINEER.id, actorId: "staff-justin" });
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" }),
          (error: Error) => {
            assert.match(error.message, /rejected the saved credentials/i);
            assert.doesNotMatch(error.message, new RegExp(SECRET));
            return true;
          },
        );
        assert.equal(tokenCalls, 1);
        assert.equal(sendCalls, 0);
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as { sent_status: string };
        assert.equal(row.sent_status, ENGINEER_INSTRUCTION_PREPARED);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("does not send a second copy when Send is clicked twice", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    const db = seeded();
    let sendCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setMailboxFetchForTests(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      sendCalls += 1;
      await gate;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const prepared = instructEngineer({ claimId: "c3", engineerId: SEEDED_ENGINEER.id, actorId: "staff-justin" });
        const first = sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" });
        await new Promise((resolve) => setTimeout(resolve, 30));
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" }),
          /already/i,
        );
        assert.equal(sendCalls, 1);
        release();
        await first;
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get(prepared.correspondenceId) as { sent_status: string };
        assert.equal(row.sent_status, ENGINEER_INSTRUCTION_MARKED_SENT);
        assert.equal(sendCalls, 1);
        await assert.rejects(
          () => sendPreparedCorrespondence({ claimId: "c3", correspondenceId: prepared.correspondenceId, actorId: "staff-justin" }),
          /already been sent/i,
        );
        assert.equal(sendCalls, 1);
      });
    } finally {
      release();
      db.close();
      restoreEnv(saved);
    }
  });
});

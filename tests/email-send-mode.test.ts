import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { CAS_CLAIMS_MAILBOX } from "../src/lib/constants.ts";
import { withDatabaseAsync } from "../src/lib/db/connection.ts";
import { listClaimEvents, sendClaimEmail } from "../src/lib/db/chronology.ts";
import { sendPreparedCorrespondence } from "../src/lib/db/mailbox-send.ts";
import { seed } from "../src/lib/db/seed.ts";
import {
  M365_CLIENT_ID_ENV,
  M365_CLIENT_SECRET_ENV,
  M365_TENANT_ID_ENV,
  setMailboxFetchForTests,
  testMailboxConnection,
} from "../src/lib/email/microsoft-graph.ts";
import { EMAIL_SEND_MODE_ENV, emailSendBanner, emailSendMode } from "../src/lib/email/send-mode.ts";
import { LIVE_EMAIL_BANNER, SIMULATED_EMAIL_BANNER } from "../src/lib/email/send-mode-copy.ts";

const ENV_KEYS = [M365_TENANT_ID_ENV, M365_CLIENT_ID_ENV, M365_CLIENT_SECRET_ENV, EMAIL_SEND_MODE_ENV] as const;

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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function filesContaining(dir: string, needle: string): string[] {
  const hits: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...filesContaining(full, needle));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      if (fs.readFileSync(full, "utf8").includes(needle)) hits.push(path.relative(process.cwd(), full).replaceAll("\\", "/"));
    }
  }
  return hits.sort();
}

describe("EMAIL_SEND_MODE", () => {
  it("treats anything other than the exact value live as simulate", () => {
    const saved = rememberEnv();
    try {
      for (const value of [undefined, "", "simulate", "LIVE", "yes", "true"]) {
        if (value === undefined) delete process.env[EMAIL_SEND_MODE_ENV];
        else process.env[EMAIL_SEND_MODE_ENV] = value;
        assert.equal(emailSendMode(), "simulate");
        assert.equal(emailSendBanner().text, SIMULATED_EMAIL_BANNER);
      }
      process.env[EMAIL_SEND_MODE_ENV] = "live";
      assert.equal(emailSendMode(), "live");
      assert.deepEqual(emailSendBanner(), { mode: "live", text: LIVE_EMAIL_BANNER });
    } finally {
      restoreEnv(saved);
    }
  });

  it("drives the on-screen banner from the same helper, not from credentials", () => {
    const banner = fs.readFileSync(path.join(process.cwd(), "src/components/EmailSendModeBanner.tsx"), "utf8");
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const mode = fs.readFileSync(path.join(process.cwd(), "src/lib/email/send-mode.ts"), "utf8");
    assert.match(banner, /emailSendBanner\(/);
    assert.doesNotMatch(banner, /mailboxIsConnected/);
    assert.match(layout, /emailSendBanner\(/);
    assert.match(mode, /EMAIL_SEND_MODE/);
    assert.doesNotMatch(mode, /CAS_M365_/);
    assert.equal(SIMULATED_EMAIL_BANNER, "Simulated — no real email will be sent");
    assert.equal(LIVE_EMAIL_BANNER, "LIVE SENDING ENABLED — this will send a real email");
  });

  it("keeps the sidebar footer email sentence on emailSendBanner()", () => {
    const shell = fs.readFileSync(path.join(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const aside = shell.slice(shell.indexOf("<aside"), shell.indexOf("</aside>"));
    assert.match(layout, /const emailBanner = emailSendBanner\(\)/);
    assert.match(layout, /emailBannerText=\{emailBanner\.text\}/);
    assert.match(aside, /Prototype — fictional test data/);
    assert.match(aside, /Simulated lookups/);
    assert.match(aside, /\{emailBannerText\}/);
    assert.equal(aside.includes("No live sending"), false);
    assert.equal(aside.includes(SIMULATED_EMAIL_BANNER), false);
    assert.equal(aside.includes(LIVE_EMAIL_BANNER), false);
    assert.equal(emailSendBanner().text, emailSendMode() === "live" ? LIVE_EMAIL_BANNER : SIMULATED_EMAIL_BANNER);
  });

  it("does not call Graph in simulate mode when credentials are set", async () => {
    const saved = rememberEnv();
    const db = seeded();
    try {
      for (const mode of ["unset", "simulate"] as const) {
        useTestCredentials();
        if (mode === "unset") delete process.env[EMAIL_SEND_MODE_ENV];
        else process.env[EMAIL_SEND_MODE_ENV] = "simulate";
        let calls = 0;
        setMailboxFetchForTests(async () => {
          calls += 1;
          return new Response(null, { status: 202 });
        });
        await withDatabaseAsync(db, async () => {
          const result = await sendClaimEmail({
            claimId: "c3",
            actorId: "staff-justin",
            to: "handler@example.test",
            subject: `Simulate ${mode}`,
            body: "This must not leave the mailbox.",
          });
          assert.equal(result.ok, true);
          if (result.ok) {
            assert.equal(result.status, "simulated_sent");
            assert.match(result.warning, /Not sent to a real mailbox/);
          }
          const row = db.prepare(`SELECT sent_status FROM correspondence WHERE subject = ?`).get(`Simulate ${mode}`) as {
            sent_status: string;
          };
          assert.equal(row.sent_status, "simulated_sent");
          const event = listClaimEvents("c3").find((item) => String(item.details).includes(`Simulate ${mode}`));
          assert.match(String(event?.details), /Not sent to a real mailbox/);
          assert.equal(calls, 0);
        });
      }
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("calls Graph only in live mode and records the send time on the file", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    process.env[EMAIL_SEND_MODE_ENV] = "live";
    const db = seeded();
    const calls: string[] = [];
    setMailboxFetchForTests(async (input, init) => {
      const url = requestUrl(input);
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      if (url.endsWith("/sendMail")) return new Response(null, { status: 202 });
      return new Response("unexpected", { status: 500 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const before = Date.now();
        const result = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "handler@example.test",
          subject: "Live mocked send",
          body: "This is the mocked Graph path.",
        });
        assert.equal(result.ok, true);
        if (result.ok) {
          assert.equal(result.status, "sent");
          assert.match(result.warning, new RegExp(CAS_CLAIMS_MAILBOX.replace(".", "\\.")));
        }
        assert.equal(calls.some((call) => call.includes("/sendMail")), true);
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE subject = ?`).get("Live mocked send") as {
          sent_status: string;
        };
        assert.equal(row.sent_status, "sent");
        const event = listClaimEvents("c3").find((item) => item.event_type === "outgoing_email" && String(item.details).includes("Live mocked send"));
        assert.ok(event);
        const sentAt = Date.parse(String(event.occurred_at));
        assert.ok(sentAt >= before - 1000);
        assert.ok(sentAt <= Date.now() + 1000);
        assert.match(String(event.details), /sent to handler@example\.test/);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("fails a live send when Microsoft rejects the credentials, and does not record a simulated success", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    process.env[EMAIL_SEND_MODE_ENV] = "live";
    const db = seeded();
    const calls: string[] = [];
    setMailboxFetchForTests(async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
      }
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const result = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "handler@example.test",
          subject: "Rejected live send",
          body: "This must not count as sent.",
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.status, "failed");
          assert.match(result.error, /rejected the saved credentials/i);
          assert.match(result.error, /Nothing was sent/);
          assert.doesNotMatch(result.error, /simulated/i);
        }
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE subject = ?`).get("Rejected live send") as {
          sent_status: string;
        };
        assert.equal(row.sent_status, "failed");
        assert.notEqual(row.sent_status, "simulated_sent");
        assert.notEqual(row.sent_status, "sent");
        const events = listClaimEvents("c3").filter((item) => item.correspondence_id === result.correspondenceId);
        assert.equal(events.some((item) => item.event_type === "outgoing_email"), false);
        assert.equal(events.some((item) => item.event_type === "email_send_failed"), true);
        assert.equal(calls.some((call) => call.includes("/sendMail")), false);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("fails a live send when credentials are missing, and does not fall back to simulate", async () => {
    const saved = rememberEnv();
    delete process.env[M365_TENANT_ID_ENV];
    delete process.env[M365_CLIENT_ID_ENV];
    delete process.env[M365_CLIENT_SECRET_ENV];
    process.env[EMAIL_SEND_MODE_ENV] = "live";
    const db = seeded();
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    try {
      await withDatabaseAsync(db, async () => {
        const result = await sendClaimEmail({
          claimId: "c3",
          actorId: "staff-justin",
          to: "handler@example.test",
          subject: "Live without credentials",
          body: "This must fail visibly.",
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.match(result.error, /credentials are missing/i);
          assert.match(result.error, /Nothing was sent/);
        }
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE subject = ?`).get("Live without credentials") as {
          sent_status: string;
        };
        assert.equal(row.sent_status, "failed");
        assert.equal(calls, 0);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("sends a chase through the shared function and makes no Graph call in simulate mode", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    process.env[EMAIL_SEND_MODE_ENV] = "simulate";
    const db = seeded();
    let calls = 0;
    setMailboxFetchForTests(async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    });
    const mailbox = fs.readFileSync(path.join(process.cwd(), "src/lib/db/mailbox-send.ts"), "utf8");
    const chronology = fs.readFileSync(path.join(process.cwd(), "src/lib/db/chronology.ts"), "utf8");
    assert.match(mailbox, /sendOutboundEmail/);
    assert.equal(mailbox.includes("sendMailboxMessage"), false);
    assert.match(chronology, /emailGateway\.send/);
    assert.equal(chronology.includes("sendMailboxMessage"), false);
    const callers = filesContaining(path.join(process.cwd(), "src"), "sendMailboxMessage");
    assert.deepEqual(callers, ["src/lib/email/gateway.ts", "src/lib/email/microsoft-graph.ts"]);
    try {
      await withDatabaseAsync(db, async () => {
        db.prepare(
          `INSERT INTO correspondence(id, claim_id, direction, channel, subject, body, to_address, from_address, unread, sent_status, template_key, created_at)
           VALUES ('corr-chase-sim', 'c3', 'outgoing', 'email', 'Repair payment chase', 'Please pay the repair invoice.', 'insurer@example.test', ?, 0, 'prepared_not_sent', 'repair_payment_chase', '2026-10-13T09:00:00.000Z')`,
        ).run(CAS_CLAIMS_MAILBOX);
        const outcome = await sendPreparedCorrespondence({
          claimId: "c3",
          correspondenceId: "corr-chase-sim",
          actorId: "staff-justin",
        });
        assert.equal(outcome.simulated, true);
        const row = db.prepare(`SELECT sent_status FROM correspondence WHERE id = ?`).get("corr-chase-sim") as { sent_status: string };
        assert.equal(row.sent_status, "simulated_sent");
        const event = listClaimEvents("c3").find((item) => item.correspondence_id === "corr-chase-sim");
        assert.match(String(event?.details), /Not sent to a real mailbox/);
        assert.equal(calls, 0);
      });
    } finally {
      db.close();
      restoreEnv(saved);
    }
  });

  it("checks the Microsoft sign-in with a token request and does not send mail", async () => {
    const saved = rememberEnv();
    useTestCredentials();
    process.env[EMAIL_SEND_MODE_ENV] = "simulate";
    const calls: string[] = [];
    setMailboxFetchForTests(async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token-abc" });
      return new Response(null, { status: 202 });
    });
    try {
      const source = fs.readFileSync(path.join(process.cwd(), "src/lib/email/microsoft-graph.ts"), "utf8");
      const start = source.indexOf("export async function testMailboxConnection");
      const body = source.slice(start, source.indexOf("async function accessToken"));
      assert.doesNotMatch(body, /sendMail/);
      const ok = await testMailboxConnection();
      assert.equal(ok.ok, true);
      if (ok.ok) assert.match(ok.message, /No email was sent/);
      assert.equal(calls.length, 1);
      assert.match(calls[0] || "", /\/oauth2\/v2\.0\/token/);
      assert.equal(calls.some((call) => call.includes("/sendMail")), false);

      setMailboxFetchForTests(async (input) => {
        calls.push(requestUrl(input));
        return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
      });
      calls.length = 0;
      const rejected = await testMailboxConnection();
      assert.equal(rejected.ok, false);
      if (!rejected.ok) assert.match(rejected.error, /Nothing was sent/);
      assert.equal(calls.some((call) => call.includes("/sendMail")), false);
    } finally {
      restoreEnv(saved);
    }
  });
});

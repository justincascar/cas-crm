import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  completeChallenge,
  LOCK_AFTER_FAILURES,
  loginLockedUntil,
  passwordProblem,
  readChallenge,
  startChallenge,
  twoStepEnabled,
  twoStepRequired,
} from "../src/lib/auth/login-security.ts";
import { checkStaffLogin, createSession, findValidSession } from "../src/lib/auth/session.ts";
import { base32Encode, totpCode, verifyTotp } from "../src/lib/auth/totp.ts";
import { demoPasswordFor } from "../src/lib/auth/demo-staff.ts";
import { DATA_MAP, NOT_PERSONAL, PERSONAL_NAME_PATTERN } from "../src/lib/data-map.ts";
import { listAudit } from "../src/lib/db/audit-view.ts";
import { listBreaches, recordBreach, updateBreach } from "../src/lib/db/breaches.ts";
import { sendClientLink } from "../src/lib/db/client-form.ts";
import { get, run, withDatabase, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { minimiseConvictionText } from "../src/lib/db/minimisation.ts";
import { erasePerson, erasureBlock, exportPersonData, restrictPerson, searchPeople } from "../src/lib/db/person-data.ts";
import { endorsementCodeList, recordLicenceCheck } from "../src/lib/db/prehire-checks.ts";
import { approveDeletionBatch, computeDueList, listDeletionLog, setLegalHold } from "../src/lib/db/retention.ts";
import { seed } from "../src/lib/db/seed.ts";
import { createStaffAccount } from "../src/lib/db/staff-admin.ts";
import { recordDocumentView } from "../src/lib/db/view-audit.ts";
import { readZip } from "../src/lib/ops/zip.ts";
import { storeFileCopy, storedFileExists } from "../src/lib/storage/files.ts";
import { renderDataMap, schemaColumns } from "../scripts/data-map.ts";

process.env.CAS_FILES_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "cas-j15-"));
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

/** TEST-0003 closed seven years ago, with a stored bank statement. */
function closeOldClaim(): string {
  run(
    `INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, source) VALUES ('ev-old-close', 'c3', 'case_closed', 'Case closed', 'Closed', '2019-03-10T10:00:00.000Z', '2019-03-10T10:00:00.000Z', 'staff')`,
  );
  const stored = storeFileCopy({ relDir: "claims/c3/documents", originalFilename: "old-bank.pdf", buffer: Buffer.from("%PDF-1.4 fictional statement") });
  run(
    `INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, original_filename, stored_relpath, mime_type, byte_size, created_at)
     VALUES ('doc-old-bank', 'c3', 'Bank statement', 'file', 'bank_statements', 1, 0, 0, 'old-bank.pdf', ?, 'application/pdf', 30, '2019-01-01T10:00:00.000Z')`,
    [stored.storedRelpath],
  );
  return stored.storedRelpath;
}

describe("J15 — login security", () => {
  it("locks a username after repeated failed sign-ins, and a correct password does not get through while locked", () => {
    const db = prepared();
    withDatabase(db, () => {
      for (let i = 0; i < LOCK_AFTER_FAILURES; i += 1) assert.equal(checkStaffLogin("tom", "wrong-password").ok, false);
      assert.ok(loginLockedUntil("tom"));
      const locked = checkStaffLogin("tom", demoPasswordFor("tom"));
      assert.equal(locked.ok, false);
      assert.ok(!locked.ok && locked.lockedUntil, "locked even with the right password");
      assert.ok(get(`SELECT id FROM audit_log WHERE action = 'login_locked'`));
      assert.equal(checkStaffLogin("megan", demoPasswordFor("megan")).ok, true, "other people are not affected");
    });
    db.close();
  });

  it("ends a session after the idle period, and keeps a used session alive", () => {
    const db = prepared();
    withDatabase(db, () => {
      const token = createSession("staff-sian");
      assert.equal(findValidSession(token)?.id, "staff-sian");
      run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [new Date(Date.now() - 31 * 60_000).toISOString(), token]);
      assert.equal(findValidSession(token), undefined, "30 minutes without use signs out");
      run(`INSERT INTO settings(key, value) VALUES ('session_idle_minutes', '60') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      assert.equal(findValidSession(token)?.id, "staff-sian", "the Settings period is used");
    });
    db.close();
  });

  it("asks for strong passwords", () => {
    assert.match(String(passwordProblem("short1!")), /12 characters/);
    assert.match(String(passwordProblem("alllowercaseletters")), /three of/);
    assert.match(String(passwordProblem("Password12345!")), /common words/);
    assert.match(String(passwordProblem("Sian.Is.Here.2026", "sian")), /username/);
    assert.equal(passwordProblem("Fictional-Harbour-42"), null);
    const db = prepared();
    withDatabase(db, () => {
      const weak = createStaffAccount({ name: "New Person", username: "newperson", email: "new.person@example.com", password: "password1", role: "staff", actorId: "staff-justin" });
      assert.equal(weak.ok, false);
    });
    db.close();
  });

  it("works out authenticator codes the standard way and needs one for an administrator", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    assert.equal(totpCode(secret, 59_000), "287082", "RFC 6238 test value");
    assert.equal(verifyTotp(secret, "287082", 59_000), true);
    assert.equal(verifyTotp(secret, "287083", 59_000), false);
    assert.equal(twoStepRequired("administrator"), true);
    assert.equal(twoStepRequired("staff"), false);
    const db = prepared();
    withDatabase(db, () => {
      const token = startChallenge({ staffId: "staff-justin", kind: "setup", nextPath: "/" });
      const challenge = readChallenge(token)!;
      assert.equal(challenge.kind, "setup");
      assert.throws(() => completeChallenge(token, "000000"), /not right/);
      const done = completeChallenge(token, totpCode(String(challenge.pendingSecret)));
      assert.equal(done.staffId, "staff-justin");
      assert.equal(twoStepEnabled("staff-justin"), true);
      assert.equal(readChallenge(token), null, "a used step cannot be used again");
      const next = startChallenge({ staffId: "staff-justin", kind: "code", nextPath: "/" });
      const key = String(get<{ totp_secret: string }>(`SELECT totp_secret FROM staff WHERE id = 'staff-justin'`)?.totp_secret);
      assert.equal(completeChallenge(next, totpCode(key)).staffId, "staff-justin");
    });
    db.close();
    const routeFiles = ["src/app/auth-actions.ts"].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"));
    assert.doesNotMatch(routeFiles[0], /createSession/, "no other way in that skips the lockout and the code");
  });
});

describe("J15 — audit of viewing", () => {
  it("logs who opened a bank statement, and shows it in the audit view under Viewed", () => {
    const db = prepared();
    withDatabase(db, () => {
      closeOldClaim();
      recordDocumentView({ actorId: "staff-sian", documentId: "doc-old-bank", how: "downloaded" });
      const viewed = listAudit({ kind: "viewed" });
      assert.ok(viewed.some((row) => row.who === "Sian Evans" && /Downloaded Bank statements/.test(row.detail) && row.reference === "TEST-0003"));
      const before = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'view'`)?.n);
      run(`INSERT INTO documents(id, claim_id, title, kind, document_type, version, signed, simulated, created_at) VALUES ('doc-letter', 'c3', 'Letter', 'letter', 'correspondence', 1, 0, 1, ?)`, [new Date().toISOString()]);
      recordDocumentView({ actorId: "staff-sian", documentId: "doc-letter", how: "opened" });
      assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'view'`)?.n), before, "ordinary letters are not logged as views");
    });
    db.close();
  });
});

describe("J15 — retention and legal hold", () => {
  it("lists what is past its period, deletes only on Justin's approval, keeps the money totals and logs without the data", () => {
    const db = prepared();
    withDatabase(db, () => {
      const relpath = closeOldClaim();
      const due = computeDueList("2026-10-30");
      const kinds = due.filter((item) => item.claimId === "c3").map((item) => item.kind).sort();
      assert.deepEqual(kinds, ["bank", "claim", "financial"]);
      assert.ok(due.some((item) => item.kind === "enquiry" && item.claimId === "c1") === false, "a new enquiry is not yet 12 months old");
      assert.throws(() => approveDeletionBatch({ actorId: "staff-sian", itemIds: due.map((item) => item.id), reason: "" }), /Only Justin/);
      const linesBefore = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = 'c3'`)?.n);
      approveDeletionBatch({ actorId: "staff-justin", itemIds: due.filter((item) => item.kind !== "financial" && item.claimId === "c3").map((item) => item.id), reason: "Past its retention period" });
      const person = get<{ full_name: string; email: string | null }>(`SELECT p.full_name, p.email FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c3'`);
      assert.deepEqual({ ...person }, { full_name: "Removed", email: null });
      assert.equal(storedFileExists(relpath), false, "the bank statement file is gone");
      assert.equal(Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM financial_lines WHERE claim_id = 'c3'`)?.n), linesBefore, "money lines kept for the accounts");
      assert.ok(get(`SELECT anonymised_at FROM claims WHERE id = 'c3' AND anonymised_at IS NOT NULL`));
      const log = listDeletionLog();
      assert.ok(log.some((row) => row.file_reference === "TEST-0003" && row.kind === "claim"));
      assert.ok(!JSON.stringify(log).includes("Ceri"), "the deletion log keeps no personal data");
    });
    db.close();
  });

  it("never lists or deletes a claim on legal hold", () => {
    const db = prepared();
    withDatabase(db, () => {
      closeOldClaim();
      const due = computeDueList("2026-10-30").filter((item) => item.claimId === "c3");
      assert.throws(() => setLegalHold({ claimId: "c3", actorId: "staff-sian", reason: "Dispute" }), /Only Justin/);
      setLegalHold({ claimId: "c3", actorId: "staff-justin", reason: "Insurer dispute pending" });
      assert.equal(computeDueList("2026-10-30").some((item) => item.claimId === "c3"), false);
      approveDeletionBatch({ actorId: "staff-justin", itemIds: due.map((item) => item.id), reason: "Past its retention period" });
      assert.notEqual(get<{ full_name: string }>(`SELECT p.full_name FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = 'c3'`)?.full_name, "Removed");
    });
    db.close();
  });
});

describe("J15 — this person's data", () => {
  it("finds a person across claims, exports everything held, and is Justin only", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.throws(() => searchPeople({ actorId: "staff-sian", query: "Aled" }), /Only Justin/);
      const [aled] = searchPeople({ actorId: "staff-justin", query: "aled morgan" });
      assert.ok(aled.roles.some((role) => role.fileReference === "TEST-0001" && role.role === "Client"));
      const { zip } = exportPersonData({ actorId: "staff-justin", personId: aled.id });
      const files = readZip(zip);
      assert.ok(files.has("README.txt") && files.has("person.csv") && files.has("claims.csv"));
      assert.match(files.get("person.csv")!.toString(), /aled\.morgan@example\.test/);
      assert.match(files.get("README.txt")!.toString(), /Check every file before it is sent/);
      assert.ok(get(`SELECT id FROM audit_log WHERE action = 'view' AND entity = 'person-data' AND details LIKE 'Exported%'`));
    });
    db.close();
  });

  it("refuses erasure while a claim is open, on hold or inside its retention period; restricts with a reason", () => {
    const db = prepared();
    withDatabase(db, () => {
      assert.match(String(erasureBlock("p-aled")), /TEST-0001 is still open/);
      assert.throws(() => erasePerson({ actorId: "staff-justin", personId: "p-aled", reason: "Asked to be forgotten" }), /still open/);
      run(`INSERT INTO claim_events(id, claim_id, event_type, title, details, occurred_at, recorded_at, source) VALUES ('ev-c1-close', 'c1', 'case_closed', 'Case closed', 'Closed', '2025-01-10T10:00:00.000Z', '2025-01-10T10:00:00.000Z', 'staff')`);
      assert.match(String(erasureBlock("p-aled", "2026-10-30")), /must be kept until 10\/01\/2031/);
      run(`UPDATE claim_events SET occurred_at = '2018-01-10T10:00:00.000Z' WHERE id = 'ev-c1-close'`);
      assert.equal(erasureBlock("p-aled", "2026-10-30"), null);
      assert.throws(() => restrictPerson({ actorId: "staff-justin", personId: "p-aled", reason: " " }), /reason/);
      restrictPerson({ actorId: "staff-justin", personId: "p-aled", reason: "Accuracy disputed by the client" });
      assert.ok(get(`SELECT restricted_at FROM people WHERE id = 'p-aled' AND restricted_at IS NOT NULL`));
      erasePerson({ actorId: "staff-justin", personId: "p-aled", reason: "Asked to be forgotten" });
      assert.equal(get<{ full_name: string }>(`SELECT full_name FROM people WHERE id = 'p-aled'`)?.full_name, "Removed");
      assert.ok(get(`SELECT id FROM deletion_log WHERE kind = 'erasure'`));
    });
    db.close();
  });
});

describe("J15 — breach log", () => {
  it("records a breach with a 72-hour clock from discovery until a decision, Justin only", () => {
    const db = prepared();
    withDatabase(db, () => {
      const discovered = new Date(Date.now() - 2 * 3_600_000);
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .format(discovered)
        .replace(", ", "T");
      assert.throws(() => recordBreach({ actorId: "staff-sian", discoveredAt: local, whatHappened: "x", whoseData: "y", actions: "" }), /Only Justin/);
      const id = recordBreach({ actorId: "staff-justin", discoveredAt: local, whatHappened: "Email with a claim summary sent to the wrong fictional address.", whoseData: "TEST-0002 client: name and claim reference", actions: "Asked the recipient to delete it." });
      const [breach] = listBreaches("staff-justin");
      assert.match(breach.clock, /Report to the ICO by .* · (69|70) hours left/);
      assert.equal(listBreaches("staff-justin", Date.now() + 80 * 3_600_000)[0].overdue, true);
      assert.throws(() => updateBreach({ actorId: "staff-justin", breachId: id, decision: "not_report", reason: "", actions: "" }), /why it is not reportable/);
      updateBreach({ actorId: "staff-justin", breachId: id, decision: "not_report", reason: "Recipient confirmed deletion; low risk.", actions: "Recipient confirmed deletion." });
      assert.equal(listBreaches("staff-justin")[0].clock, "Not reportable (reason recorded)");
    });
    db.close();
  });
});

describe("J15 — licence check minimisation and the privacy notice", () => {
  it("keeps only endorsement codes and points, never free-text history", () => {
    assert.deepEqual(endorsementCodeList("sp30, CU80 sp30"), ["SP30", "CU80"]);
    assert.throws(() => endorsementCodeList("Drink driving in 2019"), /not an endorsement code/);
    const db = prepared();
    withDatabase(db, () => {
      run(`INSERT INTO claim_screen_data(claim_id, screen_key, data_json, updated_at) VALUES ('c2', 'client', ?, ?)`, [JSON.stringify({ convictions: "Fictional speeding 2022", email: "x@example.com" }), new Date().toISOString()]);
      minimiseConvictionText(db);
      const data = JSON.parse(String(get<{ data_json: string }>(`SELECT data_json FROM claim_screen_data WHERE claim_id = 'c2' AND screen_key = 'client'`)?.data_json));
      assert.equal(data.convictions, undefined);
      assert.equal(data.convictionsDeclared, "yes");
    });
    db.close();
    assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/prehire/page.tsx"), "utf8"), /name="notes"/);
    assert.equal(typeof recordLicenceCheck, "function");
  });

  it("puts a privacy notice link on the client form and emails, and blocks the client form going live while it is a placeholder", async () => {
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const sent = await sendClientLink({ claimId: "c2", actorId: "staff-sian", to: "fictional.client@example.com", origin: "http://localhost:3000" });
      const body = String(get<{ body: string }>(`SELECT body FROM correspondence WHERE id = ?`, [sent.correspondenceId])?.body);
      assert.match(body, /Privacy notice: http:\/\/localhost:3000\/privacy \(Privacy notice — awaiting approved wording \(J9a\)\.\)/);
      process.env.EMAIL_SEND_MODE = "live";
      try {
        await assert.rejects(() => sendClientLink({ claimId: "c2", actorId: "staff-sian", to: "fictional.client@example.com", origin: "http://localhost:3000" }), /until the privacy notice wording is approved/);
      } finally {
        process.env.EMAIL_SEND_MODE = "simulate";
      }
    });
    db.close();
    assert.match(fs.readFileSync(path.join(process.cwd(), "src/app/c/[token]/page.tsx"), "utf8"), /data-privacy-link/);
    assert.match(fs.readFileSync(path.join(process.cwd(), "src/lib/documents/cas-wording.ts"), "utf8"), /\{\{privacy_notice\}\}/);
  });
});

describe("J15 — data map and security checks", () => {
  it("lists every column that looks personal, and docs/DATA-MAP.md is up to date", () => {
    const listed = new Set(DATA_MAP.flatMap((entry) => entry.columns.map((column) => `${entry.table}.${column}`)));
    const missing: string[] = [];
    for (const [table, columns] of schemaColumns()) {
      for (const column of columns) {
        if (!PERSONAL_NAME_PATTERN.test(column)) continue;
        if (listed.has(`${table}.${column}`) || NOT_PERSONAL[table]?.includes(column)) continue;
        missing.push(`${table}.${column}`);
      }
    }
    assert.deepEqual(missing, [], "add these to src/lib/data-map.ts, then run npm run data-map");
    assert.equal(fs.readFileSync(path.join(process.cwd(), "docs/DATA-MAP.md"), "utf8").replace(/\r\n/g, "\n"), renderDataMap(), "run npm run data-map");
    const map = renderDataMap();
    assert.match(map, /licence_checks \| points_endorsements, penalty_points, notes .*\*\*criminal offence data\*\*/);
    assert.match(map, /\*\*financial data\*\*/);
  });

  it("refuses a post from another site, and the finish routine runs the security checks", () => {
    const proxy = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
    assert.match(proxy, /function crossSitePost/);
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["check:pages"], /security-check\.ts/);
    assert.match(fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8"), /X-Content-Type-Options/);
  });
});

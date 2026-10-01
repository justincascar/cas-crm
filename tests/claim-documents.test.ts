import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { pathAllowedForRole } from "../src/lib/auth/roles.ts";
import {
  claimDocumentGaps,
  listClaimFileDocuments,
  storeClaimDocument,
} from "../src/lib/db/claim-documents.ts";
import { withDatabase } from "../src/lib/db/connection.ts";
import { canReadDocument } from "../src/lib/db/jobs.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { documentListSignedLabel } from "../src/lib/documents/list-display.ts";
import { readStoredFile } from "../src/lib/storage/files.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function withFiles<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-docs-"));
  const previous = process.env.CAS_FILES_DIR;
  process.env.CAS_FILES_DIR = dir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CAS_FILES_DIR;
    else process.env.CAS_FILES_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const pdf = (text: string) => ({
  buffer: Buffer.from(`%PDF-1.4 ${text}`),
  filename: "certificate.pdf",
  mimeType: "application/pdf",
});

describe("claim document storage", () => {
  it("stores a typed document on the claim and lists it", () => {
    const db = prepared();
    withFiles(() => {
      withDatabase(db, () => {
        assert.throws(
          () =>
            storeClaimDocument({
              claimId: "c4",
              actorId: "staff-justin",
              actorRole: "administrator",
              documentType: "",
              file: pdf("one"),
            }),
          /Choose the type of document/,
        );
        assert.throws(
          () =>
            storeClaimDocument({
              claimId: "c4",
              actorId: "staff-justin",
              actorRole: "administrator",
              documentType: "insurance_certificate",
              file: { buffer: Buffer.from("hello"), filename: "notes.txt", mimeType: "text/plain" },
            }),
          /PDF or a photograph/,
        );
        const saved = storeClaimDocument({
          claimId: "c4",
          actorId: "staff-justin",
          actorRole: "administrator",
          documentType: "insurance_certificate",
          file: pdf("one"),
        });
        const listed = listClaimFileDocuments("c4");
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.id, saved.id);
        assert.equal(listed[0]?.typeLabel, "Insurance certificate");
        assert.equal(listed[0]?.version, 1);
        assert.match(listed[0]?.vehicleLabel || "", /CF31 DJO/);
        assert.equal(listClaimFileDocuments("c3").some((item) => item.id === saved.id), false);
        const gaps = claimDocumentGaps("c4");
        const papers = gaps.find((item) => item.id === "client_papers");
        assert.equal(papers?.items.find((item) => item.type === "insurance_certificate")?.onFile, true);
        assert.equal(papers?.items.find((item) => item.type === "driving_licence")?.onFile, false);
        assert.equal(canReadDocument({ id: "staff-justin", role: "administrator" }, saved.id), true);
        assert.equal(canReadDocument({ id: "staff-driver", role: "driver" }, saved.id), false);
        assert.equal(canReadDocument({ id: "staff-mechanic", role: "mechanic" }, saved.id), false);
        assert.throws(
          () =>
            storeClaimDocument({
              claimId: "c4",
              actorId: "staff-driver",
              actorRole: "driver",
              documentType: "driving_licence",
              file: pdf("licence"),
            }),
          /cannot store documents/,
        );
        const event = db
          .prepare(`SELECT event_type, details, occurred_at FROM claim_events WHERE document_id = ?`)
          .get(saved.id) as { event_type: string; details: string; occurred_at: string };
        const stored = db.prepare(`SELECT created_at FROM documents WHERE id = ?`).get(saved.id) as { created_at: string };
        assert.equal(event.event_type, "document_filed");
        assert.match(event.details, /Nothing was attached to an email/);
        assert.ok(Math.abs(new Date(event.occurred_at).getTime() - new Date(stored.created_at).getTime()) < 2000);
      });
    });
  });

  it("keeps the earlier copy when a newer document of the same type is stored", () => {
    const db = prepared();
    withFiles(() => {
      withDatabase(db, () => {
        const first = storeClaimDocument({
          claimId: "c4",
          actorId: "staff-justin",
          actorRole: "administrator",
          documentType: "insurance_certificate",
          file: pdf("original-certificate"),
        });
        const second = storeClaimDocument({
          claimId: "c4",
          actorId: "staff-justin",
          actorRole: "staff",
          documentType: "insurance_certificate",
          replacesDocumentId: first.id,
          file: pdf("renewed-certificate"),
        });
        const listed = listClaimFileDocuments("c4");
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.id, second.id);
        assert.equal(listed[0]?.version, 2);
        assert.equal(listed[0]?.earlier.length, 1);
        assert.equal(listed[0]?.earlier[0]?.id, first.id);
        assert.equal(listed[0]?.earlier[0]?.version, 1);
        const oldPath = db.prepare(`SELECT stored_relpath FROM documents WHERE id = ?`).get(first.id) as { stored_relpath: string };
        const newPath = db.prepare(`SELECT stored_relpath FROM documents WHERE id = ?`).get(second.id) as { stored_relpath: string };
        assert.notEqual(oldPath.stored_relpath, newPath.stored_relpath);
        assert.match(readStoredFile(oldPath.stored_relpath).buffer.toString(), /original-certificate/);
        assert.match(readStoredFile(newPath.stored_relpath).buffer.toString(), /renewed-certificate/);
        assert.equal(
          documentListSignedLabel({ body_html: null, signed: 0, stored_relpath: oldPath.stored_relpath }),
          "Stored file",
        );
      });
    });
  });

  it("does not let a driver open the claim documents page", () => {
    assert.equal(pathAllowedForRole("driver", "/claims/c4/documents"), false);
    assert.equal(pathAllowedForRole("mechanic", "/claims/c4/documents"), false);
    assert.equal(pathAllowedForRole("staff", "/claims/c4/documents"), true);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/claims/[id]/documents/page.tsx"), "utf8");
    assert.match(page, /Nothing on this page is attached to an email/);
    assert.match(page, /method="post"/);
    assert.match(page, /encType="multipart\/form-data"/);
  });
});

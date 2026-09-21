import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import {
  formatHireAgreementNumber,
  generateHireAgreementDocument,
  prepareHireRating,
  renderHireAgreement,
  type HireAgreementView,
} from "../src/lib/db/hire-agreement.ts";
import { saveHirePack } from "../src/lib/db/hire-pack.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seed } from "../src/lib/db/seed.ts";
import { CAS_HIRE_TERMS_HTML } from "../src/lib/documents/cas-hire-terms.ts";
import { standardDailyRatePence } from "../src/lib/documents/gta.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

function baseView(overrides: Partial<HireAgreementView> = {}): HireAgreementView {
  return {
    agreementNumber: "TEST-HA-000001",
    hirerName: "Ceri Walsh",
    hirerAddress: "12 Example Street, Swansea",
    hirerDob: "1984-03-02",
    licenceNumber: "WALSH840302AB9CD",
    licenceIssuedOn: "2012-03-02",
    licenceExpiresOn: "2032-03-02",
    additionalName: "",
    additionalAddress: "",
    additionalDob: "",
    additionalLicence: "",
    additionalLicenceIssuedOn: "",
    additionalLicenceExpiresOn: "",
    deliveryAddress: "12 Example Street, Swansea",
    hireMake: "Volkswagen",
    hireModel: "Golf",
    hireRegistration: "CAS 2",
    hireTransmission: "automatic",
    hireFuel: "diesel",
    suppliedGroup: "S4",
    clientGroup: "S4",
    groupCharged: "S4",
    dateOut: "2026-09-15T09:00:00.000Z",
    dateIn: "",
    dailyRatePence: standardDailyRatePence("S4", 30),
    hireMileage: "",
    hireFuelLevel: "",
    extras: {},
    clientVehiclePresent: true,
    clientMake: "Volkswagen",
    clientModel: "Golf",
    clientRegistration: "SA12 CWA",
    ownMileage: null,
    ownFuel: "",
    ownTyres: "",
    ownDamage: "",
    storageDailyPence: null,
    recoveryPence: null,
    overrideReason: "",
    includeHire: true,
    includeStorageRecovery: true,
    hireReason: "The hire vehicle page is included because a hire vehicle is allocated (Volkswagen Golf CAS 2).",
    storageReason: "The Storage & Recovery page is included because storage is active and recovery is recorded as complete.",
    termsReason: "The terms and the notice of the right to cancel are included with every agreement. They cover hire and storage together.",
    ...overrides,
  };
}

describe("hire agreement rating and the four-page document", () => {
  it("prices the daily rate from the GTA ceiling plus markup, and keeps agreement numbers away from 100773", () => {
    assert.equal(standardDailyRatePence("S4", 30), 7134);
    assert.equal(standardDailyRatePence("S3", 30), 6653);
    assert.equal(formatHireAgreementNumber(1), "TEST-HA-000001");
    assert.equal(formatHireAgreementNumber(1).includes("100773"), false);
    assert.match(CAS_HIRE_TERMS_HTML, /89 days from the date of this agreement/);
    assert.match(CAS_HIRE_TERMS_HTML, /article 3\(1\)\(a\)\(i\)/);
    assert.match(CAS_HIRE_TERMS_HTML, /£50\.00/);
    assert.match(CAS_HIRE_TERMS_HTML, /Health Act 2006/);
  });

  it("generates four pages at the client's group when the supplied vehicle is the same group", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE people SET licence_number = 'WALSH840302AB9CD' WHERE id = 'p-ceri'`).run();
      db.prepare(`UPDATE vehicles SET gta_group = 'S4' WHERE id = 'v-fleet-2'`).run();
      const rating = prepareHireRating({
        claimId: "c3",
        clientGroupRaw: "S4",
        groupChargedRaw: "",
        dailyRateRaw: "",
        overrideReason: "",
        actorId: "staff-tom",
      });
      assert.equal(rating.groupCharged, "S4");
      assert.equal(rating.dailyRatePence, 7134);
      saveHirePack("c3", {
        group_charged: rating.groupCharged,
        daily_rate_pence: rating.dailyRatePence,
        daily_rate_manual: rating.dailyRateManual,
        licence_issued_on: "2012-03-02",
        licence_expires_on: "2032-03-02",
      });
      const result = generateHireAgreementDocument("c3", "staff-tom", rating.dailyRatePence);
      const html = db.prepare(`SELECT body_html, document_type, template_key FROM documents WHERE id = ?`).get(result.documentId) as {
        body_html: string;
        document_type: string;
        template_key: string;
      };
      assert.equal(result.agreementNumber, "TEST-HA-000001");
      assert.equal(html.document_type, "hire_agreement");
      assert.equal(html.template_key, "hire_agreement");
      assert.match(html.body_html, /Hire Agreement — 1 of 4/);
      assert.match(html.body_html, /Hire Agreement — 2 of 4/);
      assert.match(html.body_html, /Hire Agreement — 3 of 4/);
      assert.match(html.body_html, /Hire Agreement — 4 of 4/);
      assert.match(html.body_html, /The hire vehicle page is included because a hire vehicle is allocated/);
      assert.match(html.body_html, /The Storage &amp; Recovery page is included because recovery is recorded as complete and storage is active/);
      assert.match(html.body_html, /The terms and the notice of the right to cancel are included with every agreement/);
      assert.match(html.body_html, /Your Own Vehicle Details/);
      assert.match(html.body_html, /SA12 CWA/);
      assert.match(html.body_html, /WALSH840302AB9CD/);
      assert.match(html.body_html, /£71\.34/);
      assert.equal(html.body_html.includes("higher-group vehicle"), false);
      assert.equal(html.body_html.includes("above normal CAS policy"), false);
      assert.equal(html.body_html.includes("100773"), false);
      assert.match(html.body_html, /89 days from the date of this agreement/);
    });
    db.close();
  });

  it("warns when a higher-group vehicle is supplied but still rates the client's own group", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE people SET licence_number = 'WALSH840302AB9CD' WHERE id = 'p-ceri'`).run();
      db.prepare(`UPDATE vehicles SET gta_group = 'S7' WHERE id = 'v-fleet-2'`).run();
      const rating = prepareHireRating({
        claimId: "c3",
        clientGroupRaw: "S3",
        groupChargedRaw: "",
        dailyRateRaw: "",
        overrideReason: "",
        actorId: "staff-tom",
      });
      assert.equal(rating.groupCharged, "S3");
      assert.equal(rating.dailyRatePence, 6653);
      saveHirePack("c3", { group_charged: "S3", daily_rate_pence: 6653, daily_rate_manual: 0 });
      const result = generateHireAgreementDocument("c3", "staff-tom", 6653);
      const html = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(result.documentId) as { body_html: string }).body_html);
      assert.match(html, /higher-group vehicle is being supplied \(S7\)/);
      assert.match(html, /client's own group \(S3\)/);
      assert.match(html, /£66\.53/);
      assert.equal(html.includes("£112.76"), false);
      assert.equal(html.includes("£113.91"), false);
      assert.equal(html.includes("above normal CAS policy"), false);
    });
    db.close();
  });

  it("warns and records who set Group Charged above the client's group, without blocking it", () => {
    const db = prepared();
    withDatabase(db, () => {
      const rating = prepareHireRating({
        claimId: "c3",
        clientGroupRaw: "S3",
        groupChargedRaw: "S5",
        dailyRateRaw: "",
        overrideReason: "Insurer asked for the higher group on this file",
        actorId: "staff-justin",
      });
      assert.equal(rating.dailyRatePence, standardDailyRatePence("S5", 30));
      saveHirePack("c3", {
        group_charged: "S5",
        daily_rate_pence: rating.dailyRatePence,
        daily_rate_manual: 0,
        group_override_reason: "Insurer asked for the higher group on this file",
      });
      const result = generateHireAgreementDocument("c3", "staff-justin", rating.dailyRatePence);
      const html = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(result.documentId) as { body_html: string }).body_html);
      assert.match(html, /above normal CAS policy/);
      assert.match(html, /Insurer asked for the higher group on this file/);
      const event = db
        .prepare(`SELECT actor_id, details FROM claim_events WHERE claim_id = 'c3' AND event_type = 'hire_group_charged_override'`)
        .get() as { actor_id: string; details: string };
      assert.equal(event.actor_id, "staff-justin");
      assert.match(event.details, /S5/);
      assert.match(event.details, /Insurer asked/);
    });
    db.close();
  });

  it("keeps Storage & Recovery and flags a missing client's own vehicle when storage has been arranged", () => {
    const html = renderHireAgreement(
      baseView({
        licenceNumber: "",
        clientVehiclePresent: false,
        clientMake: "",
        clientModel: "",
        clientRegistration: "",
        clientGroup: null,
        suppliedGroup: null,
        groupCharged: null,
        dailyRatePence: null,
      }),
    );
    assert.match(html, /Hire Agreement — 3 of 4/);
    assert.match(html, /Storage &amp; Recovery Agreement/);
    assert.match(html, /This Storage &amp; Recovery page is incomplete/);
    assert.match(html, /licence number/);
    assert.match(html, /not classified/);
    assert.equal(html.includes("100773"), false);
  });

  it("leaves out Storage & Recovery when none has been arranged, and leaves out hire pages when no vehicle is allocated", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE people SET licence_number = 'DAF000000AB9CD' WHERE id = 'p-daf'`).run();
      const hireOnly = generateHireAgreementDocument("c4", "staff-megan", 0);
      const hireHtml = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(hireOnly.documentId) as { body_html: string }).body_html);
      assert.match(hireHtml, /Hire Agreement — 1 of 3/);
      assert.match(hireHtml, /Hire Agreement — 3 of 3/);
      assert.match(hireHtml, /page 3 of 3/);
      assert.match(hireHtml, /Notice of the Right to Cancel/);
      assert.match(hireHtml, /89 days from the date of this agreement/);
      assert.match(hireHtml, /The Storage &amp; Recovery page is not included/);
      assert.equal(hireHtml.includes("Hire Agreement — 4 of"), false);
      assert.equal(hireHtml.includes("<h2>Storage &amp; Recovery Agreement</h2>"), false);

      db.prepare(`DELETE FROM hire_episodes WHERE claim_id = 'c3'`).run();
      const storageOnly = generateHireAgreementDocument("c3", "staff-tom", null);
      const storageRow = db.prepare(`SELECT title, body_html FROM documents WHERE id = ?`).get(storageOnly.documentId) as {
        title: string;
        body_html: string;
      };
      assert.match(storageRow.title, /Hire Agreement/);
      assert.match(storageRow.body_html, /Hire Agreement — 1 of 3/);
      assert.match(storageRow.body_html, /Hire Agreement — 3 of 3/);
      assert.match(storageRow.body_html, /89 days from the date of this agreement/);
      assert.match(storageRow.body_html, /Notice of the Right to Cancel/);
      assert.match(storageRow.body_html, /<h2>Storage &amp; Recovery Agreement<\/h2>/);
      assert.match(storageRow.body_html, /The hire vehicle page is not included/);
      assert.equal(storageRow.body_html.includes("Driver details"), false);
      assert.equal(storageRow.body_html.includes("Hire Agreement — 4 of"), false);

      const neither = generateHireAgreementDocument("c1", "staff-sian", null);
      const neitherHtml = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(neither.documentId) as { body_html: string }).body_html);
      assert.match(neitherHtml, /Hire Agreement — 1 of 2/);
      assert.match(neitherHtml, /Hire Agreement — 2 of 2/);
      assert.match(neitherHtml, /89 days from the date of this agreement/);
      assert.match(neitherHtml, /Notice of the Right to Cancel/);
      assert.equal(neitherHtml.includes("Driver details"), false);
      assert.equal(neitherHtml.includes("<h2>Storage &amp; Recovery Agreement</h2>"), false);

      const reserved = generateHireAgreementDocument("c2", "staff-sian", null);
      const reservedHtml = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(reserved.documentId) as { body_html: string }).body_html);
      assert.match(reservedHtml, /reserving a vehicle does not allocate it/);
      assert.match(reservedHtml, /Notice of the Right to Cancel/);
      assert.match(reservedHtml, /89 days from the date of this agreement/);
      assert.equal(reservedHtml.includes("Driver details"), false);
    });
    db.close();
  });

  it("does not treat recovery marked required as storage or recovery arranged through CAS", () => {
    const db = prepared();
    withDatabase(db, () => {
      db.prepare(`UPDATE claims SET recovery_status = 'required', storage_status = 'none', storage_started_on = NULL WHERE id = 'c4'`).run();
      const result = generateHireAgreementDocument("c4", "staff-megan", 0);
      const html = String((db.prepare(`SELECT body_html FROM documents WHERE id = ?`).get(result.documentId) as { body_html: string }).body_html);
      assert.match(html, /The Storage &amp; Recovery page is not included/);
      assert.match(html, /marked as required, but it has not been arranged through CAS/);
      assert.match(html, /Notice of the Right to Cancel/);
      assert.match(html, /89 days from the date of this agreement/);
      assert.equal(html.includes("<h2>Storage &amp; Recovery Agreement</h2>"), false);
      assert.match(html, /1 of 3/);
    });
    db.close();
  });

  it("prints the agreement on A4 at full width, without changing the terms", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const shell = fs.readFileSync(path.join(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    assert.match(shell, /app-shell/);
    assert.match(css, /@page\s*\{[^}]*size:\s*A4/s);
    assert.match(css, /\.app-shell\s*\{[^}]*display:\s*block\s*!important/s);
    assert.match(css, /\.hire-agreement section \+ section\s*\{[^}]*break-before:\s*page/s);
    assert.doesNotMatch(css, /\.hire-agreement section\s*\{[^}]*break-inside:\s*avoid/s);

    const html = renderHireAgreement(baseView());
    assert.match(html, /class="letter hire-agreement"/);
    assert.equal(html.includes("style="), false);
    assert.ok(html.includes(CAS_HIRE_TERMS_HTML.trim()));
    assert.match(html, /4\.9 Where We terminate this agreement under clause 4\.8/);
    assert.match(html, /without demand\. unless You have previously arranged/);
    assert.match(html, /Hire Agreement — 1 of 4/);
    assert.match(html, /Hire Agreement — 4 of 4/);
  });
});

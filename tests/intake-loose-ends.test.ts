import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { CLAIM_SCREENS } from "../src/lib/claim-screens.ts";
import { get, withDatabaseAsync } from "../src/lib/db/connection.ts";
import { createClaimFromIntake, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { seedScreenDefaults } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { isoDateFromNow } from "../src/lib/dates.ts";
import { ADDRESS_NEEDED, addressLine } from "../src/lib/domain/address-text.ts";
import { phoneFieldError } from "../src/lib/phone-number.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

describe("intake and loose ends (J8)", () => {
  it("shows a blank address as Address needed, never Unknown, and stores nothing for it", async () => {
    assert.equal(addressLine(null, "", undefined), ADDRESS_NEEDED);
    assert.equal(addressLine("Unknown", null, "UNKNOWN"), ADDRESS_NEEDED);
    assert.equal(addressLine("1 High Street", "Cardiff", "CF10 1AA"), "1 High Street, Cardiff, CF10 1AA");
    assert.equal(addressLine("1 High Street", "Unknown", ""), "1 High Street");
    const db = prepared();
    await withDatabaseAsync(db, async () => {
      const form = new FormData();
      form.set("client_forename", "Bethan");
      form.set("client_surname", "Blank");
      form.set("client_mobile", "07700900222");
      form.set("handlerId", "staff-sian");
      form.set("accidentDate", isoDateFromNow(-1));
      form.set("accidentTime", "09:00");
      form.set("claimType", "non_fault");
      form.set("roadworthiness", "roadworthy");
      const claim = await createClaimFromIntake(intakeFromFormData(form));
      const person = get<{ address_line1: string | null; postcode: string | null }>(
        `SELECT p.address_line1, p.postcode FROM claims c JOIN people p ON p.id = c.client_person_id WHERE c.id = ?`,
        [claim.id],
      );
      assert.equal(person?.address_line1, null);
      assert.equal(person?.postcode, null);
      const defaults = seedScreenDefaults(claim.id, "client");
      assert.ok(!defaults.address);
      assert.ok(!defaults.postcode);
    });
    db.close();
    assert.match(read("src/components/claims/ClaimDetailsBody.tsx"), /addressLine\(claim\.address_line1, claim\.town, claim\.postcode\)/);
  });

  it("checks UK phone numbers: a mobile is 07 and 11 digits, a main number may be a landline", () => {
    assert.equal(phoneFieldError("client_mobile", "07700 900123"), null);
    assert.equal(phoneFieldError("client_mobile", "+44 7700 900123"), null);
    assert.ok(phoneFieldError("client_mobile", "01792 341069"));
    assert.ok(phoneFieldError("client_mobile", "0770090"));
    assert.equal(phoneFieldError("telMain", "01792 341069"), null);
    assert.ok(phoneFieldError("telMain", "12345"));
  });

  it("has a friendly Claim not found page and a one-line explanation after a redirect", () => {
    const notFound = read("src/app/claims/not-found.tsx");
    assert.match(notFound, /Claim not found/);
    assert.match(notFound, /SearchForm/);
    assert.match(read("src/app/claims/[id]/layout.tsx"), /notFound\(\)/);
    assert.match(read("src/app/claims/[id]/layout.tsx"), /redirect\("\/jobs\?notice=office"\)/);
    const jobs = read("src/app/jobs/page.tsx");
    assert.match(jobs, /That page is for the office\. Your jobs are below\./);
  });

  it("offers weather and purpose of journey as dropdowns on the accident screen", () => {
    const fields = CLAIM_SCREENS.flatMap((screen) => screen.sections.flatMap((section) => section.fields));
    const weather = fields.find((field) => field.name === "weather");
    const purpose = fields.find((field) => field.name === "purpose");
    assert.equal(weather?.type, "select");
    assert.equal(purpose?.type, "select");
    assert.ok(weather?.options?.some((option) => option.value === "Raining"));
    assert.ok(purpose?.options?.some((option) => option.value === "Commuting"));
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { intakeFieldErrors, intakeFromFormData } from "../src/lib/db/intake.ts";
import { migrate } from "../src/lib/db/migrate.ts";
import { saveScreenData, screenSaveFieldErrors } from "../src/lib/db/screens.ts";
import { seed } from "../src/lib/db/seed.ts";
import { FieldValidationError, problemsQuery, readProblems } from "../src/lib/form-validation.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function prepared() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

describe("R56 — the server returns every problem at once", () => {
  it("lists every problem on a new claim, not only the first", () => {
    const form = new FormData();
    form.set("client_forename", "Errol");
    form.set("client_surname", "Mistakes");
    form.set("clientRole", "owner_driver");
    form.set("client_mobile", "01792 341069");
    form.set("client_dob", "2031-01-01");
    const problems = intakeFieldErrors(intakeFromFormData(form));
    const fields = problems.map((problem) => problem.field);
    assert.ok(fields.includes("client_mobile"));
    assert.ok(fields.includes("client_dob"));
    assert.ok(problems.length >= 2);
  });

  it("lists every phone and date-of-birth problem on a Details screen and refuses the save with all of them", () => {
    const db = prepared();
    withDatabase(db, () => {
      const values = { forename: "Bethan", surname: "Lewis", telMobile: "01792 341069", dob: "2031-01-01", telMain: "12345" };
      const problems = screenSaveFieldErrors("c2", "client", values);
      assert.deepEqual(problems.map((problem) => problem.field).sort(), ["dob", "telMain", "telMobile"]);
      assert.throws(
        () => saveScreenData("c2", "client", values, "staff-sian"),
        (error: unknown) => error instanceof FieldValidationError && error.problems.length === 3,
      );
    });
    db.close();
  });

  it("carries the problems and the draft to reopen in the address, and reads them back safely", () => {
    const query = problemsQuery(
      [
        { field: "client_email", message: "Enter an email address, or tick No email." },
        { field: "client_dob", message: "A date of birth cannot be in the future." },
      ],
      { draft: "draft_abc" },
    );
    const params = new URLSearchParams(query.slice(1));
    assert.equal(params.get("error"), "2 things to fix before saving.");
    assert.equal(params.get("field"), "client_email");
    assert.equal(params.get("draft"), "draft_abc");
    assert.equal(readProblems(params.get("problems")).length, 2);
    assert.deepEqual(readProblems("not json"), []);
    assert.deepEqual(readProblems(JSON.stringify([{ field: 1 }])), []);
  });
});

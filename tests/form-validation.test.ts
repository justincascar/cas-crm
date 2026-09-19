import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeFieldErrors } from "../src/lib/db/intake.ts";
import {
  constraintMessage,
  errorQuery,
  FieldValidationError,
  firstFieldError,
  namedFieldError,
} from "../src/lib/form-validation.ts";

describe("inline field validation messages", () => {
  it("uses the same required message for an empty field as for a format error", () => {
    assert.equal(constraintMessage({ value: "", required: true }), "This field is required.");
    assert.match(namedFieldError("client_mobile", "07700") || "", /too short/);
    assert.match(namedFieldError("client_mobile", "077009001234") || "", /at most 11 digits/);
    assert.equal(namedFieldError("client_mobile", "07700900123"), null);
  });

  it("points accident-date and date-of-birth errors at those fields", () => {
    const asAt = new Date("2026-09-17T12:00:00.000Z");
    assert.match(namedFieldError("accidentDate", "2099-01-01") || "", /cannot be after today/i);
    assert.equal(namedFieldError("accidentDate", "2026-09-01"), null);
    assert.match(namedFieldError("client_dob", "2012-01-01", { dobKind: "driver" }) || "", /at least 17/);
    assert.equal(asAt.getUTCFullYear(), 2026);
  });

  it("keeps the first invalid field in form reading order when several fail", () => {
    const errors = intakeFieldErrors({
      handlerId: "staff-sian",
      clientRole: "owner_driver",
      client: { forename: "Aled", surname: "Morgan", mobile: "07700" },
      vehicle: {},
      thirdParties: [],
      accidentDate: "2099-01-01",
    });
    assert.equal(errors.length, 2);
    assert.equal(errors[0].field, "client_mobile");
    assert.match(errors[0].message, /too short/);
    assert.equal(errors[1].field, "accidentDate");
    assert.equal(firstFieldError(errors)?.field, "client_mobile");
  });

  it("carries the field name on a server validation error for the redirect", () => {
    const err = new FieldValidationError("startAt", "This field is required.");
    assert.equal(err.field, "startAt");
    assert.match(errorQuery(err.message, err.field), /field=startAt/);
    assert.match(errorQuery(err.message, err.field), /error=This/);
  });
});

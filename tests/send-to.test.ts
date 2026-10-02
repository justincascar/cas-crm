import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySendToChoice, buildSendToOptions, representativeIsRecorded, savedText } from "../src/lib/email/send-to.ts";

const contacts = {
  clientEmail: "ceri.walsh@example.test",
  thirdPartyEmail: "claims@zurich.example.test",
  representativeRecorded: true,
  representativeEmail: "keoghs@example.test",
  engineerInstructed: true,
  engineerEmail: "andy.mont@hotmail.co.uk",
};

describe("Send to picker", () => {
  it("fills each saved role and always leaves Other available", () => {
    const options = buildSendToOptions(contacts);
    assert.deepEqual(
      options.map((option) => option.role),
      ["client", "third_party", "representative", "engineer", "other"],
    );
    for (const role of ["client", "third_party", "representative", "engineer"] as const) {
      const applied = applySendToChoice({
        role,
        options,
        currentAddress: "",
        filledAddress: "",
        confirmed: false,
      });
      assert.equal(applied.needsConfirm, false);
      if (!applied.needsConfirm) {
        assert.equal(applied.address, options.find((option) => option.role === role)?.email);
        assert.equal(applied.missingMessage, null);
      }
    }
    const other = applySendToChoice({
      role: "other",
      options,
      currentAddress: "",
      filledAddress: "",
      confirmed: false,
    });
    assert.equal(other.needsConfirm, false);
    if (!other.needsConfirm) assert.equal(other.address, "");
  });

  it("hides a representative or engineer that is not on the file", () => {
    const options = buildSendToOptions({
      clientEmail: contacts.clientEmail,
      thirdPartyEmail: "",
      representativeRecorded: false,
      engineerInstructed: false,
    });
    assert.deepEqual(
      options.map((option) => option.role),
      ["client", "third_party", "other"],
    );
  });

  it("says when a role has no email and does not invent one", () => {
    const options = buildSendToOptions({
      clientEmail: "Unknown",
      thirdPartyEmail: "  ",
      representativeRecorded: true,
      representativeEmail: "",
      engineerInstructed: true,
      engineerEmail: null,
    });
    for (const role of ["client", "third_party", "representative", "engineer"] as const) {
      const applied = applySendToChoice({
        role,
        options,
        currentAddress: "",
        filledAddress: "",
        confirmed: false,
      });
      assert.equal(applied.needsConfirm, false);
      if (!applied.needsConfirm) {
        assert.equal(applied.address, "");
        assert.match(String(applied.missingMessage), /No email on file/i);
      }
    }
    assert.equal(savedText("Unknown"), "");
    assert.equal(representativeIsRecorded({ representative: "Unknown" }), false);
    assert.equal(representativeIsRecorded({ representative: "Keoghs (nominated)" }), true);
  });

  it("asks before a typed address is replaced, and keeps it when Other is chosen", () => {
    const options = buildSendToOptions(contacts);
    const blocked = applySendToChoice({
      role: "client",
      options,
      currentAddress: "typed@example.test",
      filledAddress: "",
      confirmed: false,
    });
    assert.equal(blocked.needsConfirm, true);

    const replaced = applySendToChoice({
      role: "client",
      options,
      currentAddress: "typed@example.test",
      filledAddress: "",
      confirmed: true,
    });
    assert.equal(replaced.needsConfirm, false);
    if (!replaced.needsConfirm) assert.equal(replaced.address, contacts.clientEmail);

    const kept = applySendToChoice({
      role: "other",
      options,
      currentAddress: "typed@example.test",
      filledAddress: "",
      confirmed: false,
    });
    assert.equal(kept.needsConfirm, false);
    if (!kept.needsConfirm) assert.equal(kept.address, "typed@example.test");

    const cleared = applySendToChoice({
      role: "other",
      options,
      currentAddress: contacts.clientEmail,
      filledAddress: contacts.clientEmail,
      confirmed: false,
    });
    assert.equal(cleared.needsConfirm, false);
    if (!cleared.needsConfirm) assert.equal(cleared.address, "");
  });
});

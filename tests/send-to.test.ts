import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySendToChoice, buildSendToOptions, representativeIsRecorded, savedText } from "../src/lib/email/send-to.ts";
import { emailTemplatesForRole, templateKeyForRole } from "../src/lib/documents/email-templates.ts";

const contacts = {
  clientEmail: "ceri.walsh@example.test",
  ownInsurerEmail: "claims@aviva.example.test",
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
      ["client", "own_insurer", "third_party", "representative", "engineer", "other"],
    );
    for (const role of ["client", "own_insurer", "third_party", "representative", "engineer"] as const) {
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

  it("hides an engineer that has not been instructed, and still lists the representative", () => {
    const options = buildSendToOptions({
      clientEmail: contacts.clientEmail,
      thirdPartyEmail: "",
      representativeRecorded: false,
      engineerInstructed: false,
    });
    assert.deepEqual(
      options.map((option) => option.role),
      ["client", "own_insurer", "third_party", "representative", "other"],
    );
  });

  it("always lists every recipient even when the claim has no contact recorded", () => {
    const options = buildSendToOptions({});
    assert.deepEqual(
      options.map((option) => option.role),
      ["client", "own_insurer", "third_party", "representative", "other"],
    );
    for (const role of ["client", "own_insurer", "third_party", "representative"] as const) {
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
    const representative = options.find((option) => option.role === "representative");
    assert.equal(
      representative?.missingMessage,
      "No email on file for the third party representative — enter one manually, or add it on Third party 1.",
    );

    const recordedWithoutTheFlag = buildSendToOptions({
      representativeRecorded: false,
      representativeEmail: "keoghs@example.test",
    });
    const filled = recordedWithoutTheFlag.find((option) => option.role === "representative");
    assert.equal(filled?.email, "keoghs@example.test");
    assert.equal(filled?.missingMessage, null);
  });

  it("says when a role has no email and does not invent one", () => {
    const options = buildSendToOptions({
      clientEmail: "Unknown",
      ownInsurerEmail: "Unknown",
      thirdPartyEmail: "  ",
      representativeRecorded: true,
      representativeEmail: "",
      engineerInstructed: true,
      engineerEmail: null,
    });
    for (const role of ["client", "own_insurer", "third_party", "representative", "engineer"] as const) {
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

  it("offers only the templates written for the chosen recipient", () => {
    const titles = (role: string) => emailTemplatesForRole(role).map((template) => template.title);
    const client = titles("client");
    assert.ok(client.includes("Client welcome (intake)"));
    assert.ok(client.includes("Client status update"));
    assert.ok(client.includes("Vehicle ready for collection"));
    assert.equal(client.some((title) => /payment chase/i.test(title)), false);

    const insurer = titles("third_party");
    assert.deepEqual(insurer, []);
    assert.equal(insurer.some((title) => /payment chase/i.test(title)), false);
    assert.deepEqual(titles("representative"), insurer);

    assert.deepEqual(titles("engineer"), []);
    assert.deepEqual(titles("own_insurer"), []);
    assert.deepEqual(titles(""), []);
    assert.deepEqual(titles("other"), client);
    assert.ok(titles("other").includes("Client welcome (intake)"));
    assert.equal(titles("other").some((title) => /payment chase/i.test(title)), false);

    assert.equal(templateKeyForRole("client", "payment_chase_1"), "client_welcome");
    assert.equal(templateKeyForRole("client", "client_status_update"), "client_status_update");
    assert.equal(templateKeyForRole("third_party", "client_welcome"), "");
    assert.equal(templateKeyForRole("other", "client_status_update"), "client_status_update");
    assert.equal(templateKeyForRole("engineer", "client_welcome"), "");
    assert.equal(templateKeyForRole("own_insurer", "payment_chase_1"), "");
  });

  it("treats the client's own insurer like the third party insurer", () => {
    const blank = buildSendToOptions({ ownInsurerEmail: "" });
    const missing = applySendToChoice({
      role: "own_insurer",
      options: blank,
      currentAddress: "",
      filledAddress: "",
      confirmed: false,
    });
    assert.equal(missing.needsConfirm, false);
    if (!missing.needsConfirm) {
      assert.equal(missing.address, "");
      assert.equal(
        missing.missingMessage,
        "No email on file for the client's own insurer — enter one manually, or add it on Client insurer.",
      );
    }

    const saved = buildSendToOptions({ ownInsurerEmail: "claims@aviva.example.test" });
    const blocked = applySendToChoice({
      role: "own_insurer",
      options: saved,
      currentAddress: "typed@example.test",
      filledAddress: "",
      confirmed: false,
    });
    assert.equal(blocked.needsConfirm, true);
    const replaced = applySendToChoice({
      role: "own_insurer",
      options: saved,
      currentAddress: "typed@example.test",
      filledAddress: "",
      confirmed: true,
    });
    assert.equal(replaced.needsConfirm, false);
    if (!replaced.needsConfirm) assert.equal(replaced.address, "claims@aviva.example.test");

    assert.deepEqual(emailTemplatesForRole("own_insurer"), []);
    assert.equal(templateKeyForRole("own_insurer", "payment_chase_1"), "");
  });
});

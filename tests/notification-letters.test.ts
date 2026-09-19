import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { withDatabase } from "../src/lib/db/connection.ts";
import { generateClaimDocument, letterPreview, listClaimEvents } from "../src/lib/db/chronology.ts";
import { getClaim, updateClaimAudatexCodes, updateClaimWorkflowStatus } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { suggestedLetterTemplateKey } from "../src/lib/documents/notification-letters.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("notification letters from seeded TEST claims", () => {
  it("offers the fault letter on TEST-0004 and pulls saved claim facts plus courtesy wording", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(suggestedLetterTemplateKey("fault"), "fault_own_insurer");
      const claim = getClaim("c4");
      assert.equal(String(claim?.claim.claim_type), "fault");
      assert.equal(suggestedLetterTemplateKey(String(claim?.claim.claim_type)), "fault_own_insurer");
      const letter = letterPreview("c4", "fault_own_insurer", "2026-09-19");
      assert.match(letter.text, /Aviva/);
      assert.match(letter.text, /Our Reference: TEST-0004\/MP\/Megan Price/);
      assert.match(letter.text, /Policy Number – AV-10028/);
      assert.match(letter.text, /Our Client: Dafydd Jones/);
      assert.match(letter.text, /Insured Vehicle: Vauxhall Astra CF31 DJO/);
      assert.match(letter.text, /Accident Location: A48, Bridgend/);
      assert.match(letter.text, /We act on behalf of your policyholder, Dafydd Jones/);
      assert.match(letter.text, /and to arrange a courtesy vehicle while repairs are carried out/);
      assert.match(letter.text, /and provision of a courtesy vehicle/);
      assert.ok(letter.missing.includes("Client's own insurer address"));
      assert.match(letter.text, /\[not yet on file\]/);
    });
    db.close();
  });

  it("offers the non-fault TPI letter on TEST-0003 and does not add courtesy-vehicle wording", () => {
    const db = seeded();
    withDatabase(db, () => {
      const claim = getClaim("c3");
      assert.equal(String(claim?.claim.claim_type), "non_fault");
      assert.equal(suggestedLetterTemplateKey(String(claim?.claim.claim_type)), "initial_tp_insurer");
      const letter = letterPreview("c3", "initial_tp_insurer", "2026-09-19");
      assert.match(letter.text, /Zurich/);
      assert.match(letter.text, /Our Reference: TEST-0003\/TH\/Tom Hughes/);
      assert.match(letter.text, /Our Client: Ceri Walsh/);
      assert.match(letter.text, /Our Insured's Vehicle: Volkswagen Golf SA12 CWA/);
      assert.match(letter.text, /vehicle repair charges and credit hire charges/);
      assert.doesNotMatch(letter.text, /courtesy vehicle/);
      assert.doesNotMatch(letter.text, /c\/o /);
      assert.ok(letter.missing.includes("Third-party policy number"));
      assert.ok(letter.missing.includes("Third-party registration"));
      assert.match(letter.text, /\[not yet on file\]/);
    });
    db.close();
  });

  it("does not auto-suggest either letter on a Disputed / unclear file", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(suggestedLetterTemplateKey("disputed"), null);
      assert.equal(suggestedLetterTemplateKey(""), null);
      updateClaimWorkflowStatus("c5", { liabilityStatus: "disputed" }, "staff-sian");
      const claim = getClaim("c5");
      assert.equal(String(claim?.claim.claim_type), "disputed");
      assert.equal(suggestedLetterTemplateKey(String(claim?.claim.claim_type)), null);
    });
    db.close();
  });

  it("flags gaps on an incomplete claim instead of producing blank letter fields", () => {
    const db = seeded();
    withDatabase(db, () => {
      const letter = letterPreview("c1", "initial_tp_insurer", "2026-09-19");
      assert.ok(letter.missing.length > 0);
      assert.ok(letter.missing.includes("Third-party insurer"));
      assert.match(letter.text, /\[not yet on file\]/);
      assert.doesNotMatch(letter.text, /Our Client:\s*$/m);
    });
    db.close();
  });

  it("files a generated letter on the claim history as generated, not sent", () => {
    const db = seeded();
    withDatabase(db, () => {
      const result = generateClaimDocument({
        claimId: "c4",
        templateKey: "fault_own_insurer",
        actorId: "staff-megan",
        letterDate: "2026-09-19",
        recordOnFile: false,
      });
      assert.match(result.letter.text, /Dafydd Jones/);
      const events = listClaimEvents("c4");
      const generated = events.filter((event) => event.event_type === "document_generated");
      assert.ok(generated.some((event) => String(event.details).includes("not sent")));
      assert.equal(
        events.some((event) => event.event_type === "initial_letter_own_insurer"),
        false,
      );
    });
    db.close();
  });

  it("records Audatex code changes in file history and leaves them blank until staff enter them", () => {
    const db = seeded();
    withDatabase(db, () => {
      const before = getClaim("c4");
      assert.equal(String(before?.claim.audatex_network_code || ""), "");
      assert.equal(String(before?.claim.audatex_work_provider_code || ""), "");
      updateClaimAudatexCodes("c4", { audatexNetworkCode: "NET-4410" }, "staff-megan");
      updateClaimAudatexCodes("c4", { audatexWorkProviderCode: "WP-882" }, "staff-megan");
      const after = getClaim("c4");
      assert.equal(String(after?.claim.audatex_network_code), "NET-4410");
      assert.equal(String(after?.claim.audatex_work_provider_code), "WP-882");
      const events = listClaimEvents("c4");
      const network = events.find((event) => event.event_type === "audatex_network_code_changed");
      const provider = events.find((event) => event.event_type === "audatex_work_provider_code_changed");
      assert.ok(network);
      assert.match(String(network.details), /NET-4410/);
      assert.equal(network.actor_name, "Megan Price");
      assert.ok(provider);
      assert.match(String(provider.details), /WP-882/);
      updateClaimAudatexCodes("c4", { audatexNetworkCode: "NET-9999" }, "staff-justin");
      const changed = listClaimEvents("c4").filter((event) => event.event_type === "audatex_network_code_changed");
      assert.equal(changed.length, 2);
      assert.match(String(changed[1]?.details), /NET-4410/);
      assert.match(String(changed[1]?.details), /NET-9999/);
      assert.equal(changed[1]?.actor_name, "Justin Roberts");
    });
    db.close();
  });
});

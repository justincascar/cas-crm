import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { run, withDatabase } from "../src/lib/db/connection.ts";
import { getClaim, suggestAudatexCodesForClaim, updateClaimAudatexCodes, updateClaimWorkflowStatus } from "../src/lib/db/queries.ts";
import { seed } from "../src/lib/db/seed.ts";
import { audatexInsurerNameForClaim, displayAudatexCode, exactInsurerName } from "../src/lib/domain/audatex.ts";

function seeded() {
  const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  seed(db);
  return db;
}

describe("Audatex code suggestions from earlier files", () => {
  it("matches Fault to the own insurer and Non-fault to the TPI, and ignores unused names", () => {
    assert.equal(
      audatexInsurerNameForClaim({ liabilityStatus: "fault", ownInsurerName: "Aviva", tpInsurerName: "Zurich" }),
      "Aviva",
    );
    assert.equal(
      audatexInsurerNameForClaim({ liabilityStatus: "non_fault", ownInsurerName: "Aviva", tpInsurerName: "Zurich" }),
      "Zurich",
    );
    assert.equal(
      audatexInsurerNameForClaim({ liabilityStatus: "disputed", ownInsurerName: "Aviva", tpInsurerName: "Zurich" }),
      "",
    );
    assert.equal(
      audatexInsurerNameForClaim({ liabilityStatus: "", ownInsurerName: "Aviva", tpInsurerName: "Zurich" }),
      "",
    );
    assert.equal(exactInsurerName("Unknown"), "");
    assert.equal(exactInsurerName(" Aviva "), "Aviva");
  });

  it("does not let a suggestion replace a code already saved on this file", () => {
    const shown = displayAudatexCode("NET-ON-FILE", {
      value: "NET-SUGGESTED",
      insurerName: "Aviva",
      sourceClaimId: "c4",
      sourceFileReference: "TEST-0004",
    });
    assert.equal(shown.value, "NET-ON-FILE");
    assert.equal(shown.suggestion, null);
  });

  it("pre-fills from the most recently saved codes for the same insurer name", () => {
    const db = seeded();
    withDatabase(db, () => {
      assert.equal(suggestAudatexCodesForClaim("c2").network, null);
      assert.equal(suggestAudatexCodesForClaim("c12").workProvider, null);

      updateClaimAudatexCodes("c4", { audatexNetworkCode: "NET-4410", audatexWorkProviderCode: "WP-882" }, "staff-megan");

      const onC2 = suggestAudatexCodesForClaim("c2");
      assert.equal(onC2.insurerName, "Aviva");
      assert.equal(onC2.network?.value, "NET-4410");
      assert.equal(onC2.network?.sourceFileReference, "TEST-0004");
      assert.equal(onC2.workProvider?.value, "WP-882");

      const onC12 = suggestAudatexCodesForClaim("c12");
      assert.equal(onC12.insurerName, "Aviva");
      assert.equal(onC12.network?.value, "NET-4410");

      updateClaimAudatexCodes("c2", { audatexNetworkCode: "NET-5520", audatexWorkProviderCode: "WP-991" }, "staff-sian");

      const afterChange = suggestAudatexCodesForClaim("c12");
      assert.equal(afterChange.network?.value, "NET-5520");
      assert.equal(afterChange.network?.sourceFileReference, "TEST-0002");
      assert.equal(afterChange.workProvider?.value, "WP-991");

      const c2Saved = getClaim("c2");
      const stillSuggestedFromC4 = suggestAudatexCodesForClaim("c2");
      const c2Display = displayAudatexCode(
        String(c2Saved?.claim.audatex_network_code || ""),
        stillSuggestedFromC4.network,
      );
      assert.equal(c2Display.value, "NET-5520");
      assert.equal(c2Display.suggestion, null);
    });
    db.close();
  });

  it("leaves a brand-new insurer blank and does not match a different spelling", () => {
    const db = seeded();
    withDatabase(db, () => {
      updateClaimAudatexCodes("c4", { audatexNetworkCode: "NET-4410", audatexWorkProviderCode: "WP-882" }, "staff-megan");

      const zurich = suggestAudatexCodesForClaim("c3");
      assert.equal(zurich.insurerName, "Zurich");
      assert.equal(zurich.network, null);
      assert.equal(zurich.workProvider, null);

      run(`UPDATE claim_third_parties SET insurer_name = 'Aviva Insurance' WHERE claim_id = 'c2'`);
      const renamed = suggestAudatexCodesForClaim("c2");
      assert.equal(renamed.insurerName, "Aviva Insurance");
      assert.equal(renamed.network, null);
    });
    db.close();
  });

  it("does not auto-suggest on Disputed / unclear even when an Aviva name is on the file", () => {
    const db = seeded();
    withDatabase(db, () => {
      updateClaimAudatexCodes("c4", { audatexNetworkCode: "NET-4410" }, "staff-megan");
      updateClaimWorkflowStatus("c5", { liabilityStatus: "disputed" }, "staff-sian");
      const disputed = suggestAudatexCodesForClaim("c5");
      assert.equal(disputed.insurerName, "");
      assert.equal(disputed.network, null);
    });
    db.close();
  });
});

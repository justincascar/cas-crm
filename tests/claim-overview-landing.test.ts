import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("opening a claim lands on Overview", () => {
  it("links the Claims list to the claim page and keeps the File screens list off that page", () => {
    const table = fs.readFileSync(path.join(process.cwd(), "src/components/ClaimTable.tsx"), "utf8");
    const frame = fs.readFileSync(path.join(process.cwd(), "src/components/claim-file/ClaimSectionFrame.tsx"), "utf8");
    assert.match(table, /href=\{`\/claims\/\$\{row\.id\}`\}/);
    assert.doesNotMatch(table, /href=\{`\/claims\/\$\{row\.id\}\/work\//);
    assert.match(frame, /const onOverview = pathname === claimPath/);
    assert.match(frame, /hideScreenNav = onOverview \|\| onHandover \|\| onDocuments \|\| onVehicles/);
    assert.match(frame, /href=\{`\$\{claimPath\}\/work\/general`\}/);
    assert.match(frame, />\s*Overview\s*</);
    assert.match(frame, />\s*File screens\s*</);
  });
});

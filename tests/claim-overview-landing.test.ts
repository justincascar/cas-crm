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
    assert.match(frame, /const showScreenNav = current === "details"/);
    assert.match(frame, /Steps/);
    assert.match(frame, /Details/);
    assert.equal((frame.match(/<nav /g) || []).length, 1);
  });
});

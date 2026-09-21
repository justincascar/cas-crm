import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { countPdfPages, PdfPreviewError, PdfPreviewRangeError, renderPdfPage } from "../src/lib/documents/pdf-preview.ts";

const fixture = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/minimal.pdf")));

describe("stored PDF preview", () => {
  it("draws PDF pages as images instead of embedding the raw file in the document screen", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/documents/[id]/page.tsx"), "utf8");
    const fileRoute = fs.readFileSync(path.join(process.cwd(), "src/app/documents/[id]/file/route.ts"), "utf8");
    assert.equal(page.includes("<iframe"), false);
    assert.match(page, /StoredFilePreview/);
    assert.match(fileRoute, /attachment/);
    assert.doesNotMatch(fileRoute, /inline;/);
  });

  it("counts pages and renders a JPEG from a stored PDF", async () => {
    assert.equal(await countPdfPages(fixture), 1);
    const rendered = await renderPdfPage(fixture, 1);
    assert.equal(rendered.mimeType, "image/jpeg");
    assert.equal(rendered.bytes[0], 0xff);
    assert.equal(rendered.bytes[1], 0xd8);
    assert.ok(rendered.bytes.length > 100);
  });

  it("rejects a page that is not in the PDF and a file that is not a PDF", async () => {
    await assert.rejects(() => renderPdfPage(fixture, 2), PdfPreviewRangeError);
    await assert.rejects(() => countPdfPages(new Uint8Array([1, 2, 3, 4, 5])), PdfPreviewError);
  });
});

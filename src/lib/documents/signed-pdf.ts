import { PDFDocument, loadImage } from "@napi-rs/canvas";

/** A4 in PDF points. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LINE = 13;

/** Plain text of the agreement as it was produced, one paragraph per line. Nothing is reworded. */
export function agreementTextLines(html: string): string[] {
  const text = html
    .replace(/<\s*(br|\/p|\/h[1-6]|\/tr|\/li|\/section|\/table)\s*\/?>/gi, "\n")
    .replace(/<\s*(h[1-6])[^>]*>/gi, "\n")
    .replace(/<\s*\/t[dh]\s*>/gi, "   ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type Ctx = ReturnType<PDFDocument["beginPage"]>;

function wrap(ctx: Ctx, text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The signed hire agreement as a PDF: the agreement text exactly as produced, then a signature page with the
 * drawn signature and the audit trail. Built on this computer. Nothing is sent anywhere.
 */
export async function renderSignedAgreementPdf(input: {
  title: string;
  agreementHtml: string;
  signaturePng: Buffer;
  audit: Array<[string, string]>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ title: input.title });
  const width = PAGE_WIDTH - MARGIN * 2;
  let ctx = doc.beginPage(PAGE_WIDTH, PAGE_HEIGHT);
  let y = MARGIN;
  const newPage = () => {
    doc.endPage();
    ctx = doc.beginPage(PAGE_WIDTH, PAGE_HEIGHT);
    y = MARGIN;
  };
  const write = (text: string, font = "9px sans-serif") => {
    ctx.font = font;
    ctx.fillStyle = "#000000";
    for (const line of wrap(ctx, text, width)) {
      if (y > PAGE_HEIGHT - MARGIN) newPage();
      ctx.font = font;
      ctx.fillStyle = "#000000";
      ctx.fillText(line, MARGIN, y);
      y += LINE;
    }
  };
  write(input.title, "bold 13px sans-serif");
  y += 6;
  for (const line of agreementTextLines(input.agreementHtml)) write(line);

  newPage();
  write("Electronic signature", "bold 13px sans-serif");
  y += 6;
  for (const [label, value] of input.audit) write(`${label}: ${value}`, "10px sans-serif");
  y += 10;
  const image = await loadImage(input.signaturePng);
  const drawWidth = Math.min(300, image.width);
  const drawHeight = (image.height * drawWidth) / Math.max(1, image.width);
  ctx.strokeStyle = "#888888";
  ctx.strokeRect(MARGIN, y, drawWidth, drawHeight);
  // The PDF page context is a canvas context, but its type does not list drawImage.
  (ctx as unknown as { drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void }).drawImage(image, MARGIN, y, drawWidth, drawHeight);
  doc.endPage();
  return Buffer.from(doc.close());
}
